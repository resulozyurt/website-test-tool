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
 * The primary CTA each market must show, and (optionally) a substring its target
 * should contain. Used by the functional checks to confirm the right button is
 * present and clickable for that country. One line per country to extend.
 */
export const EXPECTED_CTA: Partial<Record<CountryCode, ExpectedCta>> = {
  US: { text: "Start Free Trial" },
  TR: { text: "Book a Demo" },
  AE: { text: "Book a Meeting" },
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
  /** Pixel height of each AI slice (kept legible; ~one viewport tall). */
  aiSliceHeight: number;
  /** Max slices per page sent to AI (caps token cost on very long pages). */
  aiMaxSlices: number;
}

export const HEALTH_CONFIG: HealthConfig = {
  concurrency: 3,
  politenessDelayMs: 500,
  navTimeoutMs: 45000,
  settleMs: 4000,
  aiEnabled: false,
  viewport: { width: 1440, height: 900 },
  maxPagesPerCountry: 0,
  maxLinkProbesPerPage: 40,
  aiSliceHeight: 2000,
  aiMaxSlices: 6,
};