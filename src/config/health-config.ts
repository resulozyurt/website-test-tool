/**
 * Configuration for the full-site health crawl (separate from the geo sweep).
 *
 * Extensible in one line: add a country to CRAWL_TARGETS to crawl another
 * market/language. The crawl visits every active, non-excluded discovered page
 * for the target language, through that country's proxy, and records technical
 * + visual + functional + location health.
 */

import type { CountryCode, LanguageCode } from "../types.js";

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
   * Whether the AI visual verdict runs this crawl. The scheduler sets this true
   * once per day (the full daily crawl) and false for the lighter interim
   * crawls, to stay within budget.
   */
  aiEnabled: boolean;
  /** Viewport used for rendering + screenshots. */
  viewport: { width: number; height: number };
  /** Hard cap on pages per country, as a safety valve during development. 0 = no cap. */
  maxPagesPerCountry: number;
}

export const HEALTH_CONFIG: HealthConfig = {
  concurrency: 3,
  politenessDelayMs: 500,
  navTimeoutMs: 45000,
  settleMs: 4000,
  aiEnabled: false,
  viewport: { width: 1440, height: 900 },
  maxPagesPerCountry: 0,
};