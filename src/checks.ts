import { createHash } from "node:crypto";
import type { Page, Response } from "playwright";

/** Cache and locale signals read from the main document response headers. */
export interface CacheSignals {
  httpStatus: number | null;
  kinstaCache: string | null;
  cfCacheStatus: string | null;
  contentLanguage: string | null;
  server: string | null;
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

/** Extracts locale-relevant markers from the page DOM. */
export async function extractMarkers(page: Page): Promise<ContentMarkers> {
  const raw = await page.evaluate(() => {
    const bodyText = document.body?.innerText ?? "";
    const htmlLang = document.documentElement.getAttribute("lang") ?? "";
    const firstHeading =
      document.querySelector("h1")?.textContent?.trim() ?? "";

    // Detect call-to-action buttons by their visible text.
    const buttonText = Array.from(
      document.querySelectorAll("a, button"),
    )
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
  const currencySymbols = ["$", "₺", "AED", "€", "£"].filter((sym) =>
    raw.bodyText.includes(sym),
  );

  // Loose phone pattern; combined with explicit tel: links.
  const phoneMatches = raw.bodyText.match(/\+?\d[\d\s().-]{7,}\d/g) ?? [];
  const phoneNumbers = Array.from(
    new Set([...raw.telLinks, ...phoneMatches].map((p) => p.trim())),
  ).slice(0, 10);

  // Turkish-specific characters and a few common Turkish words.
  const turkishDetected =
    /[çğıöşü]/i.test(raw.bodyText) ||
    /\b(ücretsiz|deneme|fiyat|iletişim|başla)\b/i.test(raw.bodyText);

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
