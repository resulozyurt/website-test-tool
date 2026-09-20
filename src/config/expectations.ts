import { pool } from "../db/client.js";
import { listExpectations, type Executor } from "../db/repository.js";
import { TRIAL_CTAS } from "./cta.js";
import type { CountryCode, ExpectationSet } from "../types.js";

/**
 * Expectation resolution layer.
 *
 * Priority (lowest to highest):
 *   1. BASELINE (below): manual, code-level defaults confirmed in Phase 0.
 *      Used as a gap-filler -- it supplies values the manifest cannot pin
 *      (phone numbers, cache policy / cross-country differentiation).
 *   2. DB rows (source='manifest' or 'manual'), produced by `npm run
 *      manifest:sync` and, later, the live-render learning step. Exactly one
 *      row per market+page (unique constraint); 'manual' rows are never
 *      overwritten by the manifest sync, which is how manual beats manifest.
 *
 * The DB row is deep-merged OVER the baseline at sub-object granularity: the DB
 * value wins on any key it sets, baseline fills the rest. Array fields (e.g.
 * cta.mustNotContain, cachePolicy.mustDifferFrom) are replaced wholesale by the
 * DB value rather than unioned, to keep the result unambiguous.
 *
 * Loading is done once per sweep via loadExpectations(); resolveExpectations()
 * then stays synchronous against the in-memory store.
 */

/*
 * Baseline, verified by hand against the live site through each country's exit
 * IP. These are the rules we are sure of; anything uncertain is deliberately
 * left unset so the manifest/learning layer can fill it rather than having a
 * guess fail a run every night.
 *
 * What was verified from a Turkish IP (x-geoip-caching: tr): no price anywhere,
 * no trial CTA or link on the regular pages, Turkish phone number. From a
 * non-Turkish IP the same Turkish pricing page shows both prices and the trial
 * link, which is the differentiation we are protecting.
 *
 * Two deliberate omissions:
 *   - AE pricing carries no price rule. The Gulf audience may be a
 *     request-pricing one; until that is confirmed through the AE proxy, a
 *     guess here would fire every night.
 *   - The trial funnel page carries only a language rule. It is one English
 *     page shared by every market (no translation, no hreflang alternate), so
 *     it cannot differ across countries and its own trial CTAs are expected --
 *     including for TR visitors, who simply are not linked to it.
 */

const EN_PHONE = "+1 877 494 1538";
const TR_PHONE = "+90 212 483 72 55";

/** Ways forward an English visitor should find; TR is sales-led (see cta.ts). */
const EN_WAYS_FORWARD = ["Start Free Trial", "Get Started", "Book a Demo"];
const TR_WAYS_FORWARD = ["Demo", "Fiyat Teklifi Al", "Satış Ekibiyle Görüş"];

/** Rules shared by the two English markets on a regular page. */
function enMarket(extra: ExpectationSet = {}): ExpectationSet {
  return {
    cachePolicy: { kinstaCache: "HIT", mustDifferFrom: ["TR"] },
    cta: { anyOf: EN_WAYS_FORWARD },
    phone: { equals: EN_PHONE },
    language: { htmlLang: "en", mustNotBe: ["tr"] },
    ...extra,
  };
}

/**
 * Rules shared by the Turkish market on a regular page: no price, no trial
 * funnel, Turkish phone and language, and content that differs from what the
 * English markets are served (the silent-fallback guard).
 */
function trMarket(extra: ExpectationSet = {}): ExpectationSet {
  return {
    cachePolicy: { kinstaCache: "HIT", mustDifferFrom: ["US", "AE"] },
    cta: { anyOf: TR_WAYS_FORWARD, mustNotContain: TRIAL_CTAS },
    price: { visible: false },
    phone: { equals: TR_PHONE },
    language: { htmlLang: "tr" },
    ...extra,
  };
}

/** One shared English page for every market: no geo differentiation to expect. */
const TRIAL_FUNNEL: ExpectationSet = {
  language: { htmlLang: "en" },
};

/** Keyed by `${countryCode}::${pageKey}`. */
const BASELINE: Record<string, ExpectationSet> = {
  "US::home": enMarket(),
  "AE::home": enMarket(),
  "TR::home": trMarket(),

  // Pricing is the money-critical page: the US visitor must see a price, the
  // Turkish visitor must not.
  "US::pricing": enMarket({ price: { visible: true, currency: "$" } }),
  "AE::pricing": enMarket(),
  "TR::pricing": trMarket(),

  "US::demo": enMarket(),
  "AE::demo": enMarket(),
  "TR::demo": trMarket(),

  "US::free-trial": TRIAL_FUNNEL,
  "AE::free-trial": TRIAL_FUNNEL,
  "TR::free-trial": TRIAL_FUNNEL,
};

/** In-memory snapshot of DB expectations, keyed by `${marketId}::${pageId}`. */
export interface ExpectationStore {
  byMarketPage: Map<string, ExpectationSet>;
}

function storeKey(marketId: number, pageId: number): string {
  return `${marketId}::${pageId}`;
}

/** Loads all DB expectation payloads into a store. Call once per sweep. */
export async function loadExpectations(
  exec: Executor = pool,
): Promise<ExpectationStore> {
  const rows = await listExpectations(exec);
  const byMarketPage = new Map<string, ExpectationSet>();
  for (const row of rows) {
    byMarketPage.set(storeKey(row.marketId, row.pageId), row.payload ?? {});
  }
  return { byMarketPage };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merges `over` onto `base` at sub-object granularity; arrays replaced. */
function mergeExpectations(
  base: ExpectationSet,
  over: ExpectationSet,
): ExpectationSet {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, overVal] of Object.entries(over as Record<string, unknown>)) {
    if (overVal === undefined) {
      continue;
    }
    const baseVal = out[key];
    out[key] =
      isPlainObject(baseVal) && isPlainObject(overVal)
        ? { ...baseVal, ...overVal }
        : overVal;
  }
  return out as ExpectationSet;
}

/**
 * Resolves the effective expectation set for a market+page: the DB row (if any)
 * merged over the code baseline. An empty result means "only the always-on
 * http_health check runs".
 */
export function resolveExpectations(
  store: ExpectationStore,
  marketId: number,
  pageId: number,
  country: CountryCode,
  pageKey: string,
): ExpectationSet {
  const baseline = BASELINE[`${country}::${pageKey}`] ?? {};
  const fromDb = store.byMarketPage.get(storeKey(marketId, pageId));
  return fromDb ? mergeExpectations(baseline, fromDb) : baseline;
}