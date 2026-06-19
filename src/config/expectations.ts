import { pool } from "../db/client.js";
import { listExpectations, type Executor } from "../db/repository.js";
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

/** Baseline kinsta-cache + locale rules for the two English markets. */
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