import type { CountryCode, ExpectationSet, LanguageCode } from "../types.js";

/**
 * Baseline (manual) expectations, used until the WordPress manifest reader
 * (Phase 3) populates the `expectations` table. Only rules confirmed during
 * Phase 0 are asserted here, to avoid false positives:
 *   - English markets (US, AE): English page, "Start Free Trial" CTA, US phone.
 *   - TR market: Turkish page, TR phone.
 * US/AE sameness is intentionally NOT asserted (still an open product question),
 * and the TR market does not assert absence of the English CTAs.
 */
const EN_MARKET_HOME: ExpectationSet = {
  cachePolicy: { kinstaCache: "HIT", mustDifferFrom: ["TR"] },
  cta: { primary: "Start Free Trial" },
  phone: { equals: "+1 877 494 1538" },
  language: { htmlLang: "en", mustNotBe: ["tr"] },
};

const TR_MARKET_HOME: ExpectationSet = {
  cachePolicy: { kinstaCache: "HIT", mustDifferFrom: ["US", "AE"] },
  phone: { equals: "+90 212 483 72 55" },
  language: { htmlLang: "tr" },
};

/** Keyed by `${countryCode}::${pageKey}`. */
const BASELINE: Record<string, ExpectationSet> = {
  "US::home": EN_MARKET_HOME,
  "AE::home": EN_MARKET_HOME,
  "TR::home": TR_MARKET_HOME,
};

/**
 * Resolves the expectation set for a market+page. This is the single seam where
 * Phase 3's DB-sourced (manifest/manual) expectations will later be preferred
 * over this baseline. An empty set means "only the always-on http_health check
 * runs".
 */
export function resolveExpectations(
  country: CountryCode,
  _language: LanguageCode,
  pageKey: string,
): ExpectationSet {
  return BASELINE[`${country}::${pageKey}`] ?? {};
}