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
import {
  closeProxyRelay,
  openProxyRelay,
  type ProxyConfig,
} from "./proxy.js";
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

/** Cookie metadata only -- values are deliberately not stored. */
export interface CookieInfo {
  name: string;
  domain: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
}

/**
 * Result of probing one Bricks element selector (".brxe-<id>") in the live DOM.
 * `matched` is how many elements the selector matched; `present` is true when at
 * least one of them is actually rendered and visible. Geo conditions remove an
 * element server-side, so a geo-hidden element yields matched=0, present=false.
 */
export interface ScenarioObservation {
  selector: string;
  matched: number;
  present: boolean;
}

export interface CaptureInput {
  url: string;
  country: CountryCode;
  proxy: ProxyConfig;
  /** Local file path to write the full-page screenshot to. */
  screenshotPath: string;
  /** Optional path for a smaller top-of-page screenshot used by AI verification. */
  aiScreenshotPath?: string;
  /** Non-submitting interaction steps to run after load (optional). */
  steps?: InteractionStep[];
  /**
   * Bricks element selectors (".brxe-<id>") to probe for presence/visibility in
   * the live DOM, for scenario verification. Only pages that have scenarios pass
   * these, so pages without scenarios do no extra work.
   */
  scenarioSelectors?: string[];
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
  /** Per-selector DOM observations for scenario verification (empty if none requested). */
  scenarioObservations: ScenarioObservation[];
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
 * Hides Bricks popups in OUR throwaway browser only and unlocks page scrolling.
 *
 * Bricks renders popups as separate overlay templates with the class
 * `.brx-popup` (content inside `.brx-popup-content`); the page's own content is
 * NOT inside these, so hiding them cannot blank the page. This targets ONLY
 * those Bricks-popup classes -- no generic modal/overlay sweep -- and then
 * clears the body scroll-lock Bricks applies while a popup is open, so
 * auto-scroll can load lazy content (the pricing widget, images).
 *
 * Read-only: we hide nodes and clear a scroll lock in our DOM only. We do NOT
 * click, accept/decline anything, or make a request -- no side effect on site.
 *
 * The page.evaluate body contains NO named function/arrow declarations
 * (tsx/esbuild keepNames would inject a browser-undefined `__name`).
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
    // Best-effort: popup handling must never fail the capture.
  }
}

/**
 * Scrolls the page from top to bottom in steps, then back to the top. The site
 * lazy-loads below-the-fold content (images, the pricing widget), so without
 * scrolling the full-page screenshot is blank at the bottom, extractMarkers
 * misses lazy prices ("$"), and lazy `.brxe-<id>` elements never enter the DOM.
 * Read-only: scrolling has no side effects on the site.
 *
 * The page.evaluate body contains NO named function/arrow declarations
 * (tsx/esbuild keepNames would wrap them in a browser-undefined `__name`
 * helper and make the evaluate throw); all callbacks are anonymous and inline.
 */
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
          // Hard cap on ticks so a page that keeps growing cannot loop forever.
          if (atBottom || ticks > 60) {
            clearInterval(timer);
            resolve();
          }
        }, 120);
      });
    });
  } catch {
    // Best-effort: scrolling must never fail the capture.
  }
}

/**
 * Visits one URL through the given proxy as a real user and captures every
 * signal we persist: exit IP/country, the site-detected country (whereami),
 * cache + locale headers, DOM markers, console/network errors, cookies,
 * security inputs, a block-page check, scenario selector observations, a
 * full-page screenshot, and any non-submitting interaction outcomes.
 *
 * Before reading, page scrolling is unlocked and the page is scrolled
 * top-to-bottom, so lazy-loaded content is present. Never throws; failures are
 * returned in `error`.
 *
 * When the proxy needs authentication, the browser is pointed at a local
 * proxy-chain relay instead of the upstream directly. This avoids Chromium's
 * net::ERR_PROXY_AUTH_UNSUPPORTED on authenticated proxies; the relay adds the
 * upstream credentials on the Node side. The whole context (page + the
 * getExitInfo/getSiteCountry API requests) shares this relay, so all signals
 * come from the same exit IP. The relay is always closed in `finally`.
 */
export async function capturePage(input: CaptureInput): Promise<CaptureResult> {
  const settleMs = input.settleMs ?? env.SETTLE_MS;
  const navTimeoutMs = input.navTimeoutMs ?? env.NAV_TIMEOUT_MS;
  const steps = input.steps ?? [];
  const scenarioSelectors = input.scenarioSelectors ?? [];

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
    scenarioObservations: [],
    screenshotPath: null,
    error: null,
  };

  let launched: LaunchedContext | null = null;
  let relayUrl: string | null = null;
  try {
    // Authenticated proxies are routed through a local relay (see proxy.ts);
    // no-auth proxies are passed straight to Chromium.
    let launchProxy = input.proxy;
    if (input.proxy.username) {
      relayUrl = await openProxyRelay(input.proxy);
      launchProxy = { server: relayUrl };
    }

    launched = await launchContext(launchProxy, guard);
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

    // Hide Bricks popups + unlock scroll, then scroll to trigger lazy-loaded
    // content, then hide again (a timed popup may appear during the scroll),
    // then return to the top. All read-only; only Bricks popups are hidden.
    await dismissBricksPopups(page);
    await autoScrollToLoadLazyContent(page);
    await page.waitForTimeout(LAZY_LOAD_SETTLE_MS);
    await dismissBricksPopups(page);
    await page.evaluate(() => window.scrollTo(0, 0));

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

    // Scenario selector presence/visibility in the live DOM (read-only). Probed
    // in the page's initial state, BEFORE any interaction, because a billing
    // toggle could hide a price element via CSS and produce a false "absent".
    if (scenarioSelectors.length > 0 && !result.blockDetected) {
      result.scenarioObservations = await probeScenarios(page, scenarioSelectors);
    }

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

    // Smaller top-of-page screenshot for AI verification. A tall full-page shot
    // can exceed the API's image-size limit, so we cap the viewport instead.
    if (input.aiScreenshotPath) {
      try {
        await page.setViewportSize({ width: 1280, height: 2000 });
        await page.screenshot({ path: input.aiScreenshotPath });
      } catch {
        // Best-effort: a failed AI screenshot must not fail the capture.
      }
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    if (launched) {
      await launched.browser.close();
    }
    // Close the relay after the browser, so its connections are gone first. A
    // relay-close failure must not mask the capture result.
    if (relayUrl) {
      try {
        await closeProxyRelay(relayUrl);
      } catch {
        // best-effort
      }
    }
  }

  return result;
}

/**
 * Probes each selector in the live DOM and reports, per selector, how many
 * elements matched and whether any is rendered and visible. Read-only.
 *
 * IMPORTANT: the function passed to page.evaluate must contain NO named inner
 * function (and no variable-assigned arrow). tsx/esbuild runs with keepNames,
 * which wraps such functions in a module-scope `__name(...)` helper; that helper
 * does not exist in the browser, so the evaluate would throw ReferenceError and
 * every probe would silently return nothing. The visibility test is therefore
 * inlined as a loop rather than a helper function.
 *
 * On a total evaluation failure it returns an empty array rather than
 * fabricating present=false for everything. The scenario check treats a missing
 * observation as "not evaluated" (warn), never `pass`, so a probe failure can
 * never turn an `absent` expectation into a false pass that would mask a leak.
 */
async function probeScenarios(
  page: Page,
  selectors: string[],
): Promise<ScenarioObservation[]> {
  if (selectors.length === 0) {
    return [];
  }
  try {
    return await page.evaluate((sels: string[]) => {
      return sels.map((selector) => {
        let nodes: Element[] = [];
        try {
          nodes = Array.from(document.querySelectorAll(selector));
        } catch {
          nodes = [];
        }
        let present = false;
        for (const el of nodes) {
          const style = window.getComputedStyle(el as HTMLElement);
          if (style.display === "none" || style.visibility === "hidden") {
            continue;
          }
          const rect = (el as HTMLElement).getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            present = true;
            break;
          }
        }
        return { selector, matched: nodes.length, present };
      });
    }, selectors);
  } catch {
    // Best-effort: a failed probe must not fail the capture, and must not be
    // reported as present/absent (that is left "not evaluated" downstream).
    return [];
  }
}