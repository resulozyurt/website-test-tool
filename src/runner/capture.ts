import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { env } from "../config/env.js";
import type { CountryCode } from "../types.js";
import { launchContext, type LaunchedContext } from "./browser.js";
import type { ProxyConfig } from "./proxy.js";
import {
  extractMarkers,
  getExitInfo,
  looksLikeBlockPage,
  rawHeaders,
  readCacheSignals,
  type CacheSignals,
  type ContentMarkers,
  type ExitInfo,
} from "./signals.js";

export interface ConsoleErrorEntry {
  text: string;
}

export interface NetworkErrorEntry {
  url: string;
  status: number | null;
  failure: string | null;
}

export interface CaptureInput {
  url: string;
  country: CountryCode;
  proxy: ProxyConfig;
  /** Local file path to write the full-page screenshot to. */
  screenshotPath: string;
  settleMs?: number;
  navTimeoutMs?: number;
}

export interface CaptureResult {
  exit: ExitInfo;
  cache: CacheSignals | null;
  markers: ContentMarkers | null;
  rawHeaders: Record<string, string> | null;
  blockDetected: boolean;
  bodySnippet: string | null;
  consoleErrors: ConsoleErrorEntry[];
  networkErrors: NetworkErrorEntry[];
  screenshotPath: string | null;
  error: string | null;
}

/**
 * Visits one URL through the given proxy as a real user and captures every
 * signal we persist: exit IP/country, cache + locale headers, DOM content
 * markers, console errors, failed/4xx-5xx network requests, a block-page check,
 * and a full-page screenshot. Never throws: failures are returned in `error`.
 */
export async function capturePage(input: CaptureInput): Promise<CaptureResult> {
  const settleMs = input.settleMs ?? env.SETTLE_MS;
  const navTimeoutMs = input.navTimeoutMs ?? env.NAV_TIMEOUT_MS;

  const consoleErrors: ConsoleErrorEntry[] = [];
  const networkErrors: NetworkErrorEntry[] = [];

  const result: CaptureResult = {
    exit: { ip: null, country: null, error: null },
    cache: null,
    markers: null,
    rawHeaders: null,
    blockDetected: false,
    bodySnippet: null,
    // Held by reference; pushes below are reflected even if a later step throws.
    consoleErrors,
    networkErrors,
    screenshotPath: null,
    error: null,
  };

  let launched: LaunchedContext | null = null;
  try {
    launched = await launchContext(input.proxy);
    const { context } = launched;

    // Confirm the real exit IP/country first (does not use the page route).
    result.exit = await getExitInfo(context);

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
    result.markers = await extractMarkers(page);

    const status = response?.status() ?? 0;
    if (status !== 200 && response) {
      const body = await response.text();
      result.blockDetected = looksLikeBlockPage(body);
      result.bodySnippet = body.slice(0, 300).replace(/\s+/g, " ").trim();
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