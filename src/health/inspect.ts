/**
 * Inspects ONE page for the health crawl: visits the URL through the country
 * proxy as a read-only visitor, dismisses Bricks popups, scrolls to load lazy
 * content, then collects technical signals (HTTP, console, broken resources,
 * blank, cache bucket, site country), deterministic visual signals (broken
 * images, overflow, fonts), and functional signals (links/CTAs + dead internal
 * link targets), and takes a full-page screenshot.
 *
 * Returns a plain PageHealth object. It does NOT write to the DB and does NOT
 * evaluate findings/severity -- that is the checks phase. It reuses the geo
 * lane's browser/proxy/signals helpers but is separate from capture.ts, whose
 * job (whereami + interaction + token-leak + scenario probe) differs.
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { env } from "../config/env.js";
import type { CountryCode } from "../types.js";
import {
  launchContext,
  type LaunchedContext,
  type ReadOnlyGuard,
} from "../runner/browser.js";
import {
  closeProxyRelay,
  openProxyRelay,
  type ProxyConfig,
} from "../runner/proxy.js";
import {
  getSiteCountry,
  readCacheSignals,
  type CacheSignals,
} from "../runner/signals.js";
import { collectVisualSignals, type VisualSignals } from "./visual.js";
import {
  collectFunctionalSignals,
  probeInternalTargets,
  type DeadLink,
  type FunctionalSignals,
} from "./functional.js";

/** Extra wait after scrolling, to let lazy images/widgets mount and render. */
const LAZY_LOAD_SETTLE_MS = 1500;

export interface ConsoleErrorEntry {
  text: string;
}

export interface NetworkErrorEntry {
  url: string;
  status: number | null;
  failure: string | null;
}

export interface InspectInput {
  url: string;
  country: CountryCode;
  proxy: ProxyConfig;
  screenshotPath: string;
  settleMs: number;
  navTimeoutMs: number;
  /** Max unique internal link targets to reachability-probe (politeness). */
  maxLinkProbes: number;
}

/** Everything one page inspection produces (raw signals; not yet judged). */
export interface PageHealth {
  url: string;
  country: CountryCode;
  httpStatus: number | null;
  finalUrl: string | null;
  cache: CacheSignals | null;
  siteCountry: string | null;
  blank: boolean;
  consoleErrors: ConsoleErrorEntry[];
  networkErrors: NetworkErrorEntry[];
  visual: VisualSignals | null;
  functional: FunctionalSignals | null;
  deadLinks: DeadLink[];
  screenshotPath: string | null;
  error: string | null;
  durationMs: number;
}

/**
 * Hides Bricks popups and unlocks scroll in our browser only. Read-only.
 * The page.evaluate body has NO named functions (keepNames -> __name).
 */
async function dismissBricksPopups(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const popups = document.querySelectorAll(".brx-popup, .brx-popup-content");
      for (const el of Array.from(popups)) {
        (el as HTMLElement).style.setProperty("display", "none", "important");
      }
      const root = document.documentElement;
      root.style.setProperty("overflow", "auto", "important");
      const body = document.body;
      if (body) {
        body.style.setProperty("overflow", "auto", "important");
        if (window.getComputedStyle(body).position === "fixed") {
          body.style.setProperty("position", "static", "important");
          body.style.setProperty("top", "auto", "important");
        }
      }
    });
  } catch {
    // best-effort
  }
}

/** Scrolls top-to-bottom to trigger lazy content, then back to top. Read-only. */
async function autoScrollToLoadLazyContent(page: Page): Promise<void> {
  try {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let ticks = 0;
        const step = Math.max(300, Math.floor(window.innerHeight * 0.85));
        const timer = setInterval(() => {
          window.scrollBy(0, step);
          ticks += 1;
          const atBottom =
            window.innerHeight + window.scrollY >=
            document.body.scrollHeight - 2;
          if (atBottom || ticks > 60) {
            clearInterval(timer);
            resolve();
          }
        }, 120);
      });
    });
  } catch {
    // best-effort
  }
}

async function collectSiteCountry(
  context: BrowserContext,
  url: string,
  result: PageHealth,
): Promise<void> {
  try {
    const origin = new URL(url).origin;
    const siteGeo = await getSiteCountry(
      context.request,
      origin,
      (env.MANIFEST_SECRET ?? "").trim(),
      (env.MONITOR_USER_AGENT ?? "").trim() || undefined,
    );
    result.siteCountry = siteGeo.country;
  } catch {
    result.siteCountry = null;
  }
}

/**
 * Inspects one page. Never throws; failures land in `error`. The proxy is
 * routed through a local relay when it needs auth (same as the geo lane), and
 * the read-only guard is attached (but left inactive: the health crawl never
 * interacts, so only GETs happen anyway).
 */
export async function inspectPage(input: InspectInput): Promise<PageHealth> {
  const startedAt = Date.now();
  const consoleErrors: ConsoleErrorEntry[] = [];
  const networkErrors: NetworkErrorEntry[] = [];
  const guard: ReadOnlyGuard = { active: false, blockedWrites: [] };

  const result: PageHealth = {
    url: input.url,
    country: input.country,
    httpStatus: null,
    finalUrl: null,
    cache: null,
    siteCountry: null,
    blank: false,
    consoleErrors,
    networkErrors,
    visual: null,
    functional: null,
    deadLinks: [],
    screenshotPath: null,
    error: null,
    durationMs: 0,
  };

  let launched: LaunchedContext | null = null;
  let relayUrl: string | null = null;
  try {
    let launchProxy = input.proxy;
    if (input.proxy.username) {
      relayUrl = await openProxyRelay(input.proxy);
      launchProxy = { server: relayUrl };
    }

    launched = await launchContext(launchProxy, guard);
    const { context } = launched;

    await collectSiteCountry(context, input.url, result);

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
      timeout: input.navTimeoutMs,
    });
    await page.waitForTimeout(input.settleMs);

    result.cache = readCacheSignals(response);
    result.httpStatus = response?.status() ?? null;
    result.finalUrl = response?.url() ?? input.url;

    await dismissBricksPopups(page);
    await autoScrollToLoadLazyContent(page);
    await page.waitForTimeout(LAZY_LOAD_SETTLE_MS);
    await dismissBricksPopups(page);
    await page.evaluate(() => window.scrollTo(0, 0));

    result.visual = await collectVisualSignals(page);
    result.blank =
      (result.visual?.textLength ?? 0) < 40 &&
      (result.visual?.scrollHeight ?? 0) < 400;

    // Functional: read links/CTAs, then probe unique internal targets (HEAD,
    // GET fallback) through the same proxy-bound request context.
    result.functional = await collectFunctionalSignals(page);
    if (result.functional.links.length > 0) {
      result.deadLinks = await probeInternalTargets(
        context.request,
        result.functional.links,
        input.maxLinkProbes,
      );
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
    if (relayUrl) {
      try {
        await closeProxyRelay(relayUrl);
      } catch {
        // best-effort
      }
    }
    result.durationMs = Date.now() - startedAt;
  }

  return result;
}