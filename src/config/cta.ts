/**
 * CTA vocabulary and per-market CTA policy.
 *
 * There is no single "primary CTA" on this site: the header offers a demo, the
 * pricing page offers a quote, and some sections offer a call with sales. So a
 * market's contract is written as a set, not a single string:
 *
 *   anyOf     -- at least one of these must be present and clickable, which is
 *                how we notice a page that lost every way forward;
 *   forbidden -- none of these may be visible, which is how we notice the
 *                self-serve trial funnel leaking into the Turkish experience.
 *
 * Matching is case-insensitive "contains", with the Turkish dotted/dotless I
 * folded first, because the site renders CTAs in uppercase ("ÜCRETSİZ
 * DENEYİN") while config stores them in title case.
 *
 * Adding a market is one entry in CTA_POLICY.
 */

import type { CountryCode, LanguageCode } from "../types.js";
import { CRITICAL_PAGES, normalizePath } from "./critical.js";

/**
 * Self-serve trial CTAs, in every language we serve. A TR visitor must never
 * see one of these on a regular page: Turkish customers go through sales.
 */
export const TRIAL_CTAS: string[] = [
  "Start Free Trial",
  "Start Your Free Trial",
  "Get Started",
  "Ücretsiz Deneyin",
  "Ücretsiz Dene",
  "Iniciar Prueba Gratuita",
  "Prueba Gratis",
];

/** Ways forward that count as "the page still works" per language. */
const WAYS_FORWARD: Partial<Record<LanguageCode, string[]>> = {
  en: ["Start Free Trial", "Get Started", "Book a Demo", "Get Demo", "Talk to Sales"],
  tr: ["Demo", "Fiyat Teklifi Al", "Satış Ekibiyle Görüş", "İletişim"],
  es: ["Agenda una Demo", "Solicitar Cotización", "Hablar con Ventas"],
};

/** What a market's CTAs must, and must not, include. */
export interface CtaPolicy {
  /** At least one must be present and clickable. Empty = no requirement. */
  anyOf: string[];
  /** None may be visible. Empty = no restriction. */
  forbidden: string[];
}

/** Keyed by `${country}::${language}`. */
const CTA_POLICY: Record<string, CtaPolicy> = {
  "US::en": { anyOf: WAYS_FORWARD.en ?? [], forbidden: [] },
  "AE::en": { anyOf: WAYS_FORWARD.en ?? [], forbidden: [] },
  // Turkish visitors: sales-led. Any of the sales routes is fine; the trial
  // funnel must not appear -- in either language, since an English fallback
  // leaking into TR is exactly the failure we are hunting.
  "TR::tr": { anyOf: WAYS_FORWARD.tr ?? [], forbidden: TRIAL_CTAS },
  "TR::en": { anyOf: [], forbidden: TRIAL_CTAS },
};

/**
 * Paths of the trial funnel itself. The funnel page legitimately shows trial
 * CTAs to everyone, TR included -- only the links that lead to it are hidden
 * for TR -- so the forbidden list is lifted there.
 */
const TRIAL_FUNNEL_PATHS: Set<string> = new Set(
  (CRITICAL_PAGES.find((p) => p.key === "free-trial")?.pathByLanguage
    ? Object.values(
        CRITICAL_PAGES.find((p) => p.key === "free-trial")!.pathByLanguage,
      )
    : []
  )
    .filter((p): p is string => Boolean(p))
    .map(normalizePath),
);

export function isTrialFunnelPath(path: string): boolean {
  return TRIAL_FUNNEL_PATHS.has(normalizePath(path));
}

/**
 * The CTA policy for a visit, or undefined when the market has none. On the
 * trial funnel page the forbidden list is dropped (see above).
 */
export function ctaPolicyFor(
  country: CountryCode,
  language: LanguageCode,
  path?: string,
): CtaPolicy | undefined {
  const policy = CTA_POLICY[`${country}::${language}`];
  if (!policy) {
    return undefined;
  }
  if (path && isTrialFunnelPath(path)) {
    return { anyOf: [], forbidden: [] };
  }
  return policy;
}

/**
 * Case-folds text for tolerant CTA matching. Turkish is the reason this is not
 * a plain `toLowerCase()`: JS lower-cases the dotted capital "İ" (U+0130) into
 * "i" plus a combining dot, which then fails to equal a plain "i". Both dotted
 * and dotless variants are normalized to ASCII "i" before lowercasing.
 */
export function foldForMatch(value: string): string {
  return value.replace(/[İIı]/g, "i").toLowerCase();
}

/** Whether `haystack` contains `needle`, folded. */
export function ctaMatches(haystack: string, needle: string): boolean {
  return foldForMatch(haystack).includes(foldForMatch(needle));
}
