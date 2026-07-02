/**
 * Configuration for the full-site health crawl (separate from the geo sweep).
 *
 * Extensible in one line: add a country to CRAWL_TARGETS to crawl another
 * market/language. The crawl visits every active, non-excluded discovered page
 * for the target language, through that country's proxy, and records technical
 * + visual + functional + location health.
 */

import type { CountryCode, LanguageCode } from "../types.js";
import type { ExpectedCta } from "../health/functional.js";

/** One market to crawl: a country (=> proxy) and the page language to crawl. */
export interface CrawlTarget {
  country: CountryCode;
  language: LanguageCode;
  /** Primary markets run first; secondary ones (e.g. AE) run after. */
  priority: "primary" | "secondary";
}

/**
 * Markets crawled by the health check. US(en) and TR(tr) are the priority; AE
 * is crawled too but treated as secondary. Add a line here to extend (e.g.
 * `{ country: "US", language: "es", priority: "secondary" }`).
 */
export const CRAWL_TARGETS: CrawlTarget[] = [
  { country: "US", language: "en", priority: "primary" },
  { country: "TR", language: "tr", priority: "primary" },
  { country: "AE", language: "en", priority: "secondary" },
];

/**
 * The primary CTA each market must show, keyed by LANGUAGE (not country): the
 * button text depends on the page language, and multiple countries share a
 * language (US and AE both serve English "Start Free Trial"; TR serves the
 * Turkish "Ücretsiz Deneyin"). Keying by language keeps this correct and
 * one-line extensible: add `es`/`ar` here when those markets launch. The
 * functional check confirms this button is present and clickable.
 */
export const EXPECTED_CTA_BY_LANG: Partial<Record<LanguageCode, ExpectedCta>> = {
  en: { text: "Start Free Trial" },
  tr: { text: "Ücretsiz Deneyin" },
};

export interface HealthConfig {
  /** How many pages to inspect in parallel (per country). Keep small: polite. */
  concurrency: number;
  /** Minimum delay between starting page inspections, ms (politeness). */
  politenessDelayMs: number;
  /** Per-page navigation timeout, ms. */
  navTimeoutMs: number;
  /** Settle wait after load, ms. */
  settleMs: number;
  /**
   * Whether the AI visual review runs this crawl. Default false: AI is
   * on-demand (deterministic checks always run and are free). The scheduler or
   * a manual "review with AI" action sets this true. Keeps cost bounded.
   */
  aiEnabled: boolean;
  /** Viewport used for rendering + screenshots. */
  viewport: { width: number; height: number };
  /** Hard cap on pages per country, as a safety valve during development. 0 = no cap. */
  maxPagesPerCountry: number;
  /** Max unique internal link targets to reachability-probe per page (politeness). */
  maxLinkProbesPerPage: number;
  /** HEAD reachability-probe timeout, ms. */
  probeHeadTimeoutMs: number;
  /** GET fallback reachability-probe timeout, ms (for hosts that reject HEAD). */
  probeGetTimeoutMs: number;
  /**
   * Hosts whose failures gate the page. A console error or failed resource is
   * only counted as a real problem when it comes from one of these (exact host
   * or a subdomain). Everything else -- analytics, ad/chat widgets, CORS,
   * aborted/blocked requests -- is recorded as advisory (minor) noise and does
   * NOT fail the page. Add a host here (one line) to treat it as first-party.
   */
  firstPartyHosts: string[];
  /** Pixel height of each AI slice (kept legible; ~one viewport tall). */
  aiSliceHeight: number;
  /** Max slices per page sent to AI (caps token cost on very long pages). */
  aiMaxSlices: number;
}

export const HEALTH_CONFIG: HealthConfig = {
  concurrency: 3,
  politenessDelayMs: 500,
  navTimeoutMs: 45000,
  settleMs: 2500,
  aiEnabled: false,
  viewport: { width: 1440, height: 900 },
  maxPagesPerCountry: 0,
  maxLinkProbesPerPage: 40,
  probeHeadTimeoutMs: 8000,
  probeGetTimeoutMs: 12000,
  firstPartyHosts: ["fieldpie.com"],
  aiSliceHeight: 2000,
  aiMaxSlices: 6,
};