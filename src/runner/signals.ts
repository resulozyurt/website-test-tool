import { createHash } from "node:crypto";
import type { BrowserContext, Page, Response } from "playwright";

/** Cache and locale signals read from the main document response headers. */
export interface CacheSignals {
  httpStatus: number | null;
  kinstaCache: string | null;
  cfCacheStatus: string | null;
  contentLanguage: string | null;
  server: string | null;
}

/** The IP and country the proxy actually exited from. */
export interface ExitInfo {
  ip: string | null;
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
  /** True when Turkish-specific characters or words are detected in the body. */
  turkishDetected: boolean;
  /** Stable hash of the locale-relevant content, used for cross-country diffing. */
  fingerprint: string;
}

/**
 * Asks an external IP service, through the same proxy context, which IP and
 * country the request exits from. Uses the APIRequestContext, which is not
 * affected by the page route, so the monitor token is never sent here.
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

/** Extracts locale-relevant markers from the page DOM. */
export async function extractMarkers(page: Page): Promise<ContentMarkers> {
  const raw = await page.evaluate(() => {
    const bodyText = document.body?.innerText ?? "";
    const htmlLang = document.documentElement.getAttribute("lang") ?? "";
    const firstHeading =
      document.querySelector("h1")?.textContent?.trim() ?? "";

    // Detect call-to-action buttons by their visible text.
    const buttonText = Array.from(document.querySelectorAll("a, button"))
      .map((el) => (el.textContent ?? "").trim().toLowerCase())
      .join(" | ");

    // Collect candidate phone numbers from tel: links and the body text.
    const telLinks = Array.from(
      document.querySelectorAll('a[href^="tel:"]'),
    ).map((el) => el.getAttribute("href")?.replace("tel:", "") ?? "");

    return { bodyText, htmlLang, firstHeading, buttonText, telLinks };
  });

  const hasStartFreeTrial = raw.buttonText.includes("start free trial");
  const hasBookDemo = raw.buttonText.includes("book a demo");

  // Currency symbols that distinguish market pricing.
  const currencySymbols = ["$", "TRY", "AED", "EUR", "GBP"].filter((sym) =>
    raw.bodyText.includes(sym),
  );

  // Loose phone pattern; combined with explicit tel: links.
  const phoneMatches = raw.bodyText.match(/\+?\d[\d\s().-]{7,}\d/g) ?? [];
  const phoneNumbers = Array.from(
    new Set([...raw.telLinks, ...phoneMatches].map((p) => p.trim())),
  ).slice(0, 10);

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
    turkishDetected,
    fingerprint,
  };
}