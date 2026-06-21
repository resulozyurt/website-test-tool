import { createHash } from "node:crypto";
import type { APIRequestContext, BrowserContext, Page, Response } from "playwright";

/** Cache and locale signals read from the main document response headers. */
export interface CacheSignals {
  httpStatus: number | null;
  kinstaCache: string | null;
  cfCacheStatus: string | null;
  contentLanguage: string | null;
  server: string | null;
}

/** The IP and country the proxy actually exited from (ip-api view). */
export interface ExitInfo {
  ip: string | null;
  country: string | null;
  error: string | null;
}

/** The country the target site itself detected for the request (whereami). */
export interface SiteGeo {
  country: string | null;
  error: string | null;
}

/** Content markers extracted from the rendered DOM. */
export interface ContentMarkers {
  title: string;
  htmlLang: string;
  firstHeading: string;
  hasStartFreeTrial: boolean;
  hasBookDemo: boolean;
  currencySymbols: string[];
  phoneNumbers: string[];
  /** Most prominent main-content button/link texts, in document order. */
  ctaCandidates: string[];
  /** True when Turkish-specific characters or words are detected in the body. */
  turkishDetected: boolean;
  /** Stable hash of the locale-relevant content, used for cross-country diffing. */
  fingerprint: string;
}

/** Currency tokens we treat as a price signal when adjacent to a digit. */
const CURRENCY_TOKENS = ["$", "TRY", "AED", "EUR", "GBP"];

/** Path of the site's whereami endpoint (server-detected country). */
const WHEREAMI_PATH = "/wp-json/fieldpie-monitor/v1/whereami";

/**
 * A currency token counts as a real price only when it sits next to a number
 * (e.g. "$19", "1.299 TRY"). A lone "$" used as static decoration is ignored.
 */
function currencyVisible(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // \s* (not \s?) so "$" and the number can be separated by whitespace/newlines
  // from sibling DOM nodes; a lone "$" followed by text (no digit) still fails.
  return new RegExp(`(${escaped}\\s*\\d)|(\\d\\s*${escaped})`, "i").test(text);
}

/**
 * Asks an external IP service, through the same proxy context, which IP and
 * country the request exits from. This is the proxy's view, not the target
 * site's geolocation; use getSiteCountry for the authoritative site view.
 */
export async function getExitInfo(context: BrowserContext): Promise<ExitInfo> {
  try {
    const res = await context.request.get(
      "http://ip-api.com/json/?fields=status,country,countryCode,query",
      { timeout: 20000 },
    );
    const data = (await res.json()) as {
      query?: string;
      countryCode?: string;
    };
    return {
      ip: data.query ?? null,
      country: data.countryCode ?? null,
      error: null,
    };
  } catch (err) {
    return {
      ip: null,
      country: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Asks the target site, through the same proxy, which country IT detected for
 * this request (Kinsta GeoIP via the secret-protected whereami endpoint). This
 * is the authoritative geo signal: it is exactly what the site used to pick the
 * cached experience. Returns country=null (with a reason) when the endpoint is
 * not configured or unreachable, so callers can skip the geo check gracefully.
 */
export async function getSiteCountry(
  request: APIRequestContext,
  origin: string,
  secret: string,
  userAgent?: string,
): Promise<SiteGeo> {
  if (!secret) {
    return { country: null, error: "MANIFEST_SECRET not set" };
  }
  try {
    const url = new URL(WHEREAMI_PATH, origin).toString();
    const headers: Record<string, string> = {
      "X-Monitor-Secret": secret,
      Accept: "application/json",
    };
    if (userAgent) {
      headers["User-Agent"] = userAgent;
    }
    const res = await request.get(url, { headers, timeout: 20000 });
    if (!res.ok()) {
      return { country: null, error: `http ${res.status()}` };
    }
    const data = (await res.json()) as { country?: string | null };
    return { country: data.country ?? null, error: null };
  } catch (err) {
    return {
      country: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Heuristic: does this response body look like a Cloudflare/WAF block page? */
export function looksLikeBlockPage(body: string): boolean {
  const t = body.toLowerCase();
  return (
    t.includes("cloudflare") ||
    t.includes("attention required") ||
    t.includes("you have been blocked") ||
    t.includes("access denied") ||
    t.includes("ray id") ||
    t.includes("error 1020")
  );
}

/** Reads the headers that tell us whether the response was cached and localized. */
export function readCacheSignals(response: Response | null): CacheSignals {
  if (!response) {
    return {
      httpStatus: null,
      kinstaCache: null,
      cfCacheStatus: null,
      contentLanguage: null,
      server: null,
    };
  }
  const headers = response.headers();
  return {
    httpStatus: response.status(),
    kinstaCache: headers["x-kinsta-cache"] ?? null,
    cfCacheStatus: headers["cf-cache-status"] ?? null,
    contentLanguage: headers["content-language"] ?? null,
    server: headers["server"] ?? null,
  };
}

/** All response headers as a flat record, for persistence/inspection. */
export function rawHeaders(
  response: Response | null,
): Record<string, string> | null {
  return response ? response.headers() : null;
}

/**
 * Extracts locale-relevant markers from the page DOM.
 *
 * Note: the page.evaluate() body must contain NO named function/arrow
 * declarations. tsx/esbuild ("keepNames") rewrites named functions with a
 * __name(...) helper that does not exist in the browser, which throws
 * "ReferenceError: __name is not defined" when the body is serialized and run
 * in the page. Keep all callbacks anonymous and inline.
 */
export async function extractMarkers(page: Page): Promise<ContentMarkers> {
  const raw = await page.evaluate(() => {
    const bodyText = document.body?.innerText ?? "";
    const htmlLang = document.documentElement.getAttribute("lang") ?? "";
    const firstHeading =
      document.querySelector("h1")?.textContent?.trim() ?? "";

    // Main content root, excluding global chrome (header/nav/footer) and the
    // cookie-consent dialog, so persistent header CTAs and consent buttons do
    // not pollute CTA detection.
    const EXCLUDE = [
      "header",
      "footer",
      "nav",
      "[role='banner']",
      "[role='navigation']",
      "[role='contentinfo']",
      "[id*='cmplz']",
      "[class*='cmplz']",
      "[id*='cookie']",
      "[class*='cookie']",
      "[aria-label*='onsent']",
    ].join(", ");
    const root = document.querySelector("main") ?? document.body;

    // inline closest() filter (no named function -- see note above)
    const ctaEls = Array.from(root.querySelectorAll("a, button")).filter(
      (el) => el.closest(EXCLUDE) == null,
    );
    const buttonText = ctaEls
      .map((el) => (el.textContent ?? "").trim().toLowerCase())
      .join(" | ");
    const ctaTexts = ctaEls
      .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter((t) => t.length > 1 && t.length <= 40);

    // Main-content text only, for currency/price detection.
    const mainText = (root as HTMLElement).innerText ?? bodyText;

    const telLinks = Array.from(
      document.querySelectorAll('a[href^="tel:"]'),
    ).map((el) => el.getAttribute("href")?.replace("tel:", "") ?? "");

    return { bodyText, mainText, htmlLang, firstHeading, buttonText, ctaTexts, telLinks };
  });

  const hasStartFreeTrial = raw.buttonText.includes("start free trial");
  const hasBookDemo = raw.buttonText.includes("book a demo");

  // Currency symbols that are actually next to a number (a real price).
  const currencySymbols = CURRENCY_TOKENS.filter((token) =>
    currencyVisible(raw.mainText, token),
  );

  // Loose phone pattern; combined with explicit tel: links.
  const phoneMatches = raw.bodyText.match(/\+?\d[\d\s().-]{7,}\d/g) ?? [];
  const phoneNumbers = Array.from(
    new Set([...raw.telLinks, ...phoneMatches].map((p) => p.trim())),
  ).slice(0, 10);

  // Distinct main-content CTA candidates in document order.
  const ctaCandidates = Array.from(new Set(raw.ctaTexts)).slice(0, 15);

  // Turkish-specific characters and a few common Turkish words.
  const turkishDetected =
    /[\u00e7\u011f\u0131\u00f6\u015f\u00fc]/i.test(raw.bodyText) ||
    /\b(ucretsiz|deneme|fiyat|iletisim|basla)\b/i.test(raw.bodyText);

  const fingerprintSource = [
    raw.htmlLang,
    raw.firstHeading,
    hasStartFreeTrial ? "trial" : "",
    hasBookDemo ? "demo" : "",
    currencySymbols.join(","),
  ].join("::");

  const fingerprint = createHash("sha256")
    .update(fingerprintSource)
    .digest("hex")
    .slice(0, 16);

  return {
    title: await page.title(),
    htmlLang: raw.htmlLang,
    firstHeading: raw.firstHeading,
    hasStartFreeTrial,
    hasBookDemo,
    currencySymbols,
    phoneNumbers,
    ctaCandidates,
    turkishDetected,
    fingerprint,
  };
}