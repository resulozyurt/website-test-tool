/**
 * Maps the WordPress manifest into per market+page ExpectationSet values.
 *
 * Business logic (confirmed with the site owner):
 *   1. Primary gate is TR vs non-TR. TR visitors see "Book a Demo" / quote
 *      buttons ("Fiyat Teklifi Al") and NO self-serve pricing.
 *   2. Inside the non-TR branch, a secondary gate is US vs non-US. Self-serve
 *      pricing (monthly/annual billing) is shown ONLY to US visitors; other
 *      non-TR countries (e.g. AE) see "Request Pricing" / "Book a Meeting".
 *
 * The manifest's geo_rules are flat (nesting is lost), so we re-apply that
 * precedence here instead of evaluating each condition independently: US-axis
 * rules only take effect for non-TR visitors. This keeps TR from being
 * mis-mapped as "sees Request Pricing".
 *
 * Values that the manifest cannot pin (exact prices, phone numbers) are left
 * out on purpose; those come from the rendered-baseline learning step.
 */

import { MARKETS, PAGES } from "../config/targets.js";
import type {
  CountryCode,
  ExpectationSet,
  LanguageCode,
} from "../types.js";
import type { GeoRule, Manifest } from "./schema.js";

export interface MappedExpectation {
  country: CountryCode;
  language: LanguageCode;
  pageKey: string;
  source: "manifest";
  expectation: ExpectationSet;
  evidence: {
    presentCtas: string[];
    forbiddenCtas: string[];
    geoRuleSlug: string | null;
    geoRuleCount: number;
  };
}

/** Recognized CTA button phrases per language. Non-CTA text is ignored. */
const CTA_VOCAB: Record<string, string[]> = {
  en: [
    "Start Free Trial",
    "Get Started",
    "Choose Plan",
    "Book a Demo",
    "Request Pricing",
    "Book a Meeting",
  ],
  es: [
    "Iniciar Prueba Gratuita",
    "Comenzar prueba gratis",
    "Inicia tu Prueba Gratis",
    "Prueba Gratuita",
    "Empezar",
    "Agenda Una Demo",
    "Solicitar Cotización",
    "Reservar una Reunión",
  ],
  tr: ["Fiyat Teklifi Al"],
};

/** TR-only demo CTAs: must NOT appear for non-TR visitors. */
const TR_DEMO_CTAS: Record<string, string[]> = {
  en: ["Book a Demo"],
  es: ["Agenda Una Demo"],
  tr: [],
};

/** Self-serve trial CTAs (English): must NOT appear for TR visitors. */
const TRIAL_CTAS_EN = ["Start Free Trial", "Get Started"];

/** US-only billing-toggle labels: their absence differentiates non-US from US. */
const US_ONLY_LABELS: Record<string, string[]> = {
  en: ["Billed monthly", "Billed annually"],
  es: ["Facturación mensual", "Facturación Anual"],
  tr: [],
};

/**
 * Whether a geo rule's branch is visible to a given visitor country, applying
 * the TR-before-US precedence described in the file header.
 */
function ruleVisibleFor(country: CountryCode, rule: GeoRule): boolean {
  const target = rule.country.toUpperCase();
  if (target === "TR") {
    return rule.op === "==" ? country === "TR" : country !== "TR";
  }
  if (target === "US") {
    // US-axis rules live inside the non-TR block; hidden entirely for TR.
    if (country === "TR") {
      return false;
    }
    return rule.op === "==" ? country === "US" : country !== "US";
  }
  return rule.op === "==" ? country === target : country !== target;
}

/** The page slug used in geo rules for a given page+language, or null for home/global. */
function pageSlug(pageKey: string, language: LanguageCode): string | null {
  const page = PAGES.find((p) => p.key === pageKey);
  const path = page?.pathByLanguage[language];
  if (!path) {
    return null;
  }
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last || last === language) {
    return null; // home or language-root path -> use the global rule set
  }
  return last;
}

function langMatches(rule: GeoRule, language: LanguageCode): boolean {
  return (rule.language ?? "").toLowerCase() === language.toLowerCase();
}

/**
 * Geo rules relevant to a page. For a real page (pricing) we use the rules
 * attached to that page's slug. For home (no slug), CTAs come from site-wide
 * templates, so we use all CTA-bearing rules in that language.
 */
function rulesForPage(
  manifest: Manifest,
  pageKey: string,
  language: LanguageCode,
): { rules: GeoRule[]; slug: string | null } {
  const slug = pageSlug(pageKey, language);
  if (slug) {
    return {
      rules: manifest.geo_rules.filter(
        (r) => r.page === slug && langMatches(r, language),
      ),
      slug,
    };
  }
  const vocab = CTA_VOCAB[language] ?? [];
  return {
    // Home CTAs come from site-wide templates and are TR-vs-non-TR only; the
    // US-vs-non-US split is exclusive to the pricing page, so exclude US-axis
    // rules from the global bucket.
    rules: manifest.geo_rules.filter(
      (r) =>
        langMatches(r, language) &&
        vocab.includes(r.shows) &&
        r.country.toUpperCase() === "TR",
    ),
    slug: null,
  };
}

/** Splits CTA-vocabulary rules into present/absent for a visitor country. */
function splitCtas(
  rules: GeoRule[],
  country: CountryCode,
  language: LanguageCode,
): { present: string[]; absent: string[] } {
  const vocab = CTA_VOCAB[language] ?? [];
  const present = new Set<string>();
  const absent = new Set<string>();
  for (const rule of rules) {
    if (!vocab.includes(rule.shows)) {
      continue;
    }
    if (ruleVisibleFor(country, rule)) {
      present.add(rule.shows);
    } else {
      absent.add(rule.shows);
    }
  }
  for (const shown of present) {
    absent.delete(shown); // a CTA shown by any matching rule counts as present
  }
  return { present: [...present], absent: [...absent] };
}

/** Most common plan-button text for a language (pricing CTA fallback). */
function planButton(manifest: Manifest, language: LanguageCode): string | undefined {
  const counts = new Map<string, number>();
  for (const plan of manifest.plan_catalog) {
    if ((plan.language ?? "").toLowerCase() !== language.toLowerCase()) {
      continue;
    }
    counts.set(plan.button_text, (counts.get(plan.button_text) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [text, count] of counts) {
    if (count > bestCount) {
      best = text;
      bestCount = count;
    }
  }
  return best;
}

/** Picks the most relevant present CTA as the primary, by page and country intent. */
function pickPrimary(
  country: CountryCode,
  language: LanguageCode,
  isPricing: boolean,
  present: string[],
  fallback: string | undefined,
): string | undefined {
  let order: string[];
  if (country === "TR") {
    order = CTA_VOCAB[language] ?? [];
  } else if (!isPricing) {
    // Home: every non-TR audience sees the trial CTA.
    order = [
      "Start Free Trial",
      "Get Started",
      "Choose Plan",
      "Iniciar Prueba Gratuita",
      "Prueba Gratuita",
      "Empezar",
    ];
  } else if (country === "US") {
    // Pricing, US: self-serve.
    order = ["Get Started", "Start Free Trial", "Choose Plan"];
  } else {
    // Pricing, non-US non-TR (e.g. AE): request-pricing audience.
    order = [
      "Request Pricing",
      "Book a Meeting",
      "Solicitar Cotización",
      "Reservar una Reunión",
    ];
  }
  for (const candidate of order) {
    if (present.includes(candidate)) {
      return candidate;
    }
  }
  return present[0] ?? fallback;
}

function buildExpectation(
  manifest: Manifest,
  country: CountryCode,
  language: LanguageCode,
  pageKey: string,
): MappedExpectation {
  const { rules, slug } = rulesForPage(manifest, pageKey, language);
  const { present, absent } = splitCtas(rules, country, language);

  const isPricing = pageKey === "pricing";
  const fallback = isPricing ? planButton(manifest, language) : undefined;
  const primary = pickPrimary(country, language, isPricing, present, fallback);

  // Forbidden CTAs: those hidden in the opposite branch, plus the explicit
  // cross-checks that distinguish the three audiences.
  const forbidden = new Set<string>(absent);
  if (country === "TR") {
    for (const c of TRIAL_CTAS_EN) forbidden.add(c); // catch silent English fallback
    if (isPricing) for (const c of US_ONLY_LABELS[language] ?? []) forbidden.add(c);
  } else if (country === "US") {
    for (const c of TR_DEMO_CTAS[language] ?? []) forbidden.add(c);
  } else {
    // Non-US, non-TR (e.g. AE): no TR demo CTA; on pricing, no US-only billing.
    for (const c of TR_DEMO_CTAS[language] ?? []) forbidden.add(c);
    if (isPricing) for (const c of US_ONLY_LABELS[language] ?? []) forbidden.add(c);
  }
  if (primary) {
    forbidden.delete(primary);
  }
  const forbiddenCtas = [...forbidden];

  // Language: catch a market served in the wrong language (silent fallback).
  const mustNotBe: LanguageCode[] = country === "TR" ? ["en"] : ["tr"];

  const expectation: ExpectationSet = {
    language: { htmlLang: language, mustNotBe },
  };

  const cta: NonNullable<ExpectationSet["cta"]> = {};
  if (primary) cta.primary = primary;
  if (forbiddenCtas.length > 0) cta.mustNotContain = forbiddenCtas;
  if (Object.keys(cta).length > 0) expectation.cta = cta;

  if (isPricing) {
    expectation.price =
      country === "US" ? { visible: true, currency: "$" } : { visible: false };
  }

  if (pageKey === "home") {
    const homePage = manifest.pages.find(
      (p) => p.key === "home" && (p.language ?? "").toLowerCase() === language.toLowerCase(),
    );
    if (homePage?.heading && !homePage.heading.includes("{")) {
      expectation.heading = { contains: homePage.heading };
    }
  }

  return {
    country,
    language,
    pageKey,
    source: "manifest",
    expectation,
    evidence: {
      presentCtas: present,
      forbiddenCtas,
      geoRuleSlug: slug,
      geoRuleCount: rules.length,
    },
  };
}

/**
 * Produces one MappedExpectation per active market x active page, using the
 * static matrix in src/config/targets.ts.
 */
export function mapManifestToExpectations(manifest: Manifest): MappedExpectation[] {
  const out: MappedExpectation[] = [];
  for (const market of MARKETS) {
    if (!market.isActive) continue;
    for (const page of PAGES) {
      if (!page.isActive) continue;
      if (!page.pathByLanguage[market.language]) continue; // no path for this language
      out.push(buildExpectation(manifest, market.country, market.language, page.key));
    }
  }
  return out;
}
