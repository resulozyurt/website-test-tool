import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { env } from "../config/env.js";
import type { CountryCode } from "../types.js";
import {
  launchContext,
  MONITOR_TOKENS,
  type LaunchedContext,
  type ReadOnlyGuard,
} from "./browser.js";
import {
  runInteractions,
  type BlockedWrite,
  type InteractionOutcome,
  type InteractionStep,
} from "./interaction.js";
import type { ProxyConfig } from "./proxy.js";
import {
  extractMarkers,
  getExitInfo,
  getSiteCountry,
  looksLikeBlockPage,
  rawHeaders,
  readCacheSignals,
  type CacheSignals,
  type ContentMarkers,
  type ExitInfo,
} from "./signals.js";
import type { BrowserContext, Page } from "playwright";

export interface ConsoleErrorEntry {
  text: string;
}

export interface NetworkErrorEntry {
  url: string;
  status: number | null;
  failure: string | null;
}

/** Cookie metadata only -- values are deliberately not stored. */
export interface CookieInfo {
  name: string;
  domain: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
}

export interface CaptureInput {
  url: string;
  country: CountryCode;
  proxy: ProxyConfig;
  /** Local file path to write the full-page screenshot to. */
  screenshotPath: string;
  /** Non-submitting interaction steps to run after load (optional). */
  steps?: InteractionStep[];
  settleMs?: number;
  navTimeoutMs?: number;
}

export interface CaptureResult {
  exit: ExitInfo;
  /** Country the target site itself detected for this request (whereami), or null. */
  siteCountry: string | null;
  cache: CacheSignals | null;
  markers: ContentMarkers | null;
  rawHeaders: Record<string, string> | null;
  finalUrl: string | null;
  blockDetected: boolean;
  bodySnippet: string | null;
  consoleErrors: ConsoleErrorEntry[];
  networkErrors: NetworkErrorEntry[];
  cookies: CookieInfo[];
  tokenLeak: string[];
  interactions: InteractionOutcome[];
  blockedWrites: BlockedWrite[];
  screenshotPath: string | null;
  error: string | null;
}

async function collectCookies(
  context: BrowserContext,
  url: string,
): Promise<CookieInfo[]> {
  try {
    const cookies = await context.cookies(url);
    return cookies.map((c) => ({
      name: c.name,
      domain: c.domain,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: String(c.sameSite ?? ""),
    }));
  } catch {
    return [];
  }
}

async function scanTokenLeak(page: Page): Promise<string[]> {
  if (MONITOR_TOKENS.length === 0) {
    return [];
  }
  try {
    const html = await page.content();
    return MONITOR_TOKENS.filter((token) => html.includes(token));
  } catch {
    return [];
  }
}

/**
 * Visits one URL through the given proxy as a real user and captures every
 * signal we persist: exit IP/country, the site-detected country (whereami),
 * cache + locale headers, DOM markers, console/network errors, cookies,
 * security inputs, a block-page check, a full-page screenshot, and any
 * non-submitting interaction outcomes. Never throws; failures are returned in
 * `error`.
 */
export async function capturePage(input: CaptureInput): Promise<CaptureResult> {
  const settleMs = input.settleMs ?? env.SETTLE_MS;
  const navTimeoutMs = input.navTimeoutMs ?? env.NAV_TIMEOUT_MS;
  const steps = input.steps ?? [];

  const consoleErrors: ConsoleErrorEntry[] = [];
  const networkErrors: NetworkErrorEntry[] = [];
  const guard: ReadOnlyGuard = { active: false, blockedWrites: [] };

  const result: CaptureResult = {
    exit: { ip: null, country: null, error: null },
    siteCountry: null,
    cache: null,
    markers: null,
    rawHeaders: null,
    finalUrl: null,
    blockDetected: false,
    bodySnippet: null,
    consoleErrors,
    networkErrors,
    cookies: [],
    tokenLeak: [],
    interactions: [],
    blockedWrites: guard.blockedWrites,
    screenshotPath: null,
    error: null,
  };

  let launched: LaunchedContext | null = null;
  try {
    launched = await launchContext(input.proxy, guard);
    const { context } = launched;

    // Confirm the real exit IP/country first (does not use the page route).
    result.exit = await getExitInfo(context);

    // Ask the site which country IT detected for this proxy (authoritative).
    const origin = new URL(input.url).origin;
    const siteGeo = await getSiteCountry(
      context.request,
      origin,
      (env.MANIFEST_SECRET ?? "").trim(),
      (env.MONITOR_USER_AGENT ?? "").trim() || undefined,
    );
    result.siteCountry = siteGeo.country;

    const page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push({ text: msg.text() });
      }
    });
    page.on("pageerror", (err) => {
      consoleErrors.push({ text: err.message });
    });
    page.on("requestfailed", (request) => {
      networkErrors.push({
        url: request.url(),
        status: null,
        failure: request.failure()?.errorText ?? null,
      });
    });
    page.on("response", (response) => {
      const status = response.status();
      if (status >= 400) {
        networkErrors.push({ url: response.url(), status, failure: null });
      }
    });

    const response = await page.goto(input.url, {
      waitUntil: "domcontentloaded",
      timeout: navTimeoutMs,
    });
    await page.waitForTimeout(settleMs);

    result.cache = readCacheSignals(response);
    result.rawHeaders = rawHeaders(response);
    result.finalUrl = response?.url() ?? input.url;
    result.markers = await extractMarkers(page);

    const status = response?.status() ?? 0;
    if (status !== 200 && response) {
      const body = await response.text();
      result.blockDetected = looksLikeBlockPage(body);
      result.bodySnippet = body.slice(0, 300).replace(/\s+/g, " ").trim();
    }

    // Security inputs (read from the served page, before any interaction).
    result.cookies = await collectCookies(context, result.finalUrl);
    result.tokenLeak = await scanTokenLeak(page);

    // Non-submitting interaction, guarded so no write can reach the site.
    if (steps.length > 0 && !result.blockDetected) {
      guard.active = true;
      try {
        result.interactions = await runInteractions(page, steps);
      } finally {
        guard.active = false;
      }
    }

    await mkdir(dirname(input.screenshotPath), { recursive: true });
    await page.screenshot({ path: input.screenshotPath, fullPage: true });
    result.screenshotPath = input.screenshotPath;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    if (launched) {
      await launched.browser.close();
    }
  }

  return result;
}