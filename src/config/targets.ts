import type {
  EnvironmentConfig,
  LanguageCode,
  MarketConfig,
  PageConfig,
} from "../types.js";
import { env } from "./env.js";

/**
 * Test environments. Production is always active; staging activates once its
 * URL is configured. Side-effecting tests (form submissions) target staging.
 */
export const ENVIRONMENTS: EnvironmentConfig[] = [
  { key: "production", baseUrl: env.TARGET_BASE_URL, isActive: true },
  {
    key: "staging",
    baseUrl: env.STAGING_BASE_URL ?? "",
    isActive: Boolean(env.STAGING_BASE_URL),
  },
];

/**
 * Markets under test. Adding a market (e.g. US/Spanish, AE/Arabic) is a single
 * new entry here.
 */
export const MARKETS: MarketConfig[] = [
  { country: "US", language: "en", proxyEnvKey: "PROXY_US", isActive: true },
  { country: "AE", language: "en", proxyEnvKey: "PROXY_AE", isActive: true },
  { country: "TR", language: "tr", proxyEnvKey: "PROXY_TR", isActive: true },
  // Future:
  // { country: "US", language: "es", proxyEnvKey: "PROXY_US", isActive: true },
  // { country: "AE", language: "ar", proxyEnvKey: "PROXY_AE", isActive: true },
];

/**
 * Pages under test. Paths confirmed against the live site (Polylang structure);
 * the Spanish column is ready for when an es market is activated.
 *
 * `isCritical` marks the daily set: the four pages that carry the funnel
 * (home -> pricing -> demo / free trial). The daily cron visits only these, in
 * every active market; the weekly full run still covers the whole site. Adding
 * a page to the daily set is one entry here plus `npm run seed`.
 */
export const PAGES: PageConfig[] = [
  {
    key: "home",
    pathByLanguage: { en: "/", tr: "/tr/", es: "/es/" },
    isActive: true,
    isCritical: true,
  },
  {
    key: "pricing",
    pathByLanguage: {
      en: "/pricing/",
      tr: "/tr/fiyatlandirma/",
      es: "/es/precios/",
    },
    isActive: true,
    isCritical: true,
  },
  {
    key: "demo",
    pathByLanguage: {
      en: "/get-demo/",
      tr: "/tr/demo-talebi/",
      es: "/es/agenda-una-demo/",
    },
    isActive: true,
    isCritical: true,
  },
  {
    // The trial funnel exists in English only -- there is no Polylang
    // translation and no hreflang alternate -- so every market visits the same
    // URL. That is deliberate: TR visitors reaching this page directly is
    // expected behaviour, while the CTAs and links that lead here must stay
    // hidden on TR pages. The page is absent from the sitemap (noindex), so it
    // is kept in the inventory by the fixed-URL list in config/discovery.ts.
    key: "free-trial",
    pathByLanguage: {
      en: "/fieldpie-free-trial/",
      tr: "/fieldpie-free-trial/",
      es: "/fieldpie-free-trial/",
    },
    isActive: true,
    isCritical: true,
  },
  // {
  //   key: "merchandising",
  //   pathByLanguage: { en: "/merchandising/", tr: "/tr/merchandising/" },
  //   isActive: false,
  //   isCritical: false,
  // },
];

/** The page's path in one language, or null when it has none. */
export function pagePath(
  page: PageConfig,
  language: LanguageCode,
): string | null {
  return page.pathByLanguage[language] ?? null;
}
