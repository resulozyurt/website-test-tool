/**
 * Market matrix for the Phase 0 verification harness.
 *
 * Each market maps a target country to the proxy that exits from that country,
 * the expected primary language, and the page path to visit. Adding a future
 * market (for example US/Spanish or AE/Arabic) is a single new entry here.
 */
export interface Market {
  /** ISO country code the visitor should appear to come from. */
  readonly country: string;
  /** Expected primary language for this market (ISO 639-1). */
  readonly expectedLanguage: string;
  /** Path appended to TARGET_BASE_URL (Polylang language path). */
  readonly path: string;
  /** Name of the environment variable holding this market's proxy URL. */
  readonly proxyEnvKey: string;
}

export const MARKETS: readonly Market[] = [
  { country: "US", expectedLanguage: "en", path: "/", proxyEnvKey: "PROXY_US" },
  { country: "AE", expectedLanguage: "en", path: "/", proxyEnvKey: "PROXY_AE" },
  // The Turkish path is assumed to be "/tr/"; Phase 0 confirms the real
  // Polylang structure against the live site.
  { country: "TR", expectedLanguage: "tr", path: "/tr/", proxyEnvKey: "PROXY_TR" },
];
