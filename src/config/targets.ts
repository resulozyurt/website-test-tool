import type {
  EnvironmentConfig,
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
 * Pages under test. Real paths are confirmed against the live site during
 * setup; disabled placeholders are enabled as we map the site.
 */
export const PAGES: PageConfig[] = [
  {
    key: "home",
    pathByLanguage: { en: "/", tr: "/tr/" },
    isActive: true,
  },
  // {
  //   key: "pricing",
  //   pathByLanguage: { en: "/pricing/", tr: "/tr/fiyatlandirma/" },
  //   isActive: false,
  // },
  // {
  //   key: "merchandising",
  //   pathByLanguage: { en: "/merchandising/", tr: "/tr/merchandising/" },
  //   isActive: false,
  // },
];