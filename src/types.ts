/** Shared domain vocabulary used across the whole system. */

export type LanguageCode = "en" | "tr" | "es" | "ar";
export type CountryCode = "US" | "AE" | "TR";
export type EnvironmentKey = "production" | "staging";

/** Severity of a single check; drives whether an alert fires. */
export type Severity = "critical" | "major" | "minor";

/** Outcome of a single check. */
export type CheckStatus = "pass" | "warn" | "fail";

/** Aggregate outcome of a run (one market+page visit) and a sweep. */
export type RunStatus = "pass" | "warn" | "fail" | "error";
export type SweepStatus = "running" | "pass" | "warn" | "fail";

/** Who triggered a sweep. */
export type SweepTrigger = "cron" | "manual";

/** What a single check verifies. */
export type CheckType =
  | "http_health"
  | "cache_header"
  | "cross_country"
  | "language"
  | "cta"
  | "price"
  | "heading"
  | "phone"
  | "interaction"
  | "security_passive"
  | "ai_semantic";

/** A test environment (production or staging). */
export interface EnvironmentConfig {
  key: EnvironmentKey;
  baseUrl: string;
  isActive: boolean;
}

/** A market = a country plus its expected primary language. */
export interface MarketConfig {
  country: CountryCode;
  language: LanguageCode;
  /** Name of the environment variable holding this market's proxy URL. */
  proxyEnvKey: string;
  isActive: boolean;
}

/** A page to test, with its path per language. */
export interface PageConfig {
  key: string;
  /** Path by language code, e.g. { en: "/pricing/", tr: "/tr/fiyatlandirma/" }. */
  pathByLanguage: Partial<Record<LanguageCode, string>>;
  isActive: boolean;
}

/**
 * The expected business rules for a market+page. Later sourced from the
 * WordPress manifest, with a manual override layer for gaps.
 */
export interface ExpectationSet {
  cachePolicy?: { kinstaCache?: string; mustDifferFrom?: CountryCode[] };
  cta?: { primary?: string; mustNotContain?: string[] };
  price?: { visible?: boolean; currency?: string };
  heading?: { contains?: string };
  phone?: { equals?: string };
  language?: { htmlLang?: LanguageCode; mustNotBe?: LanguageCode[] };
  ai?: { checkVisual?: boolean; expectedExperience?: string };
}

/** The result of one check, persisted to the database. */
export interface CheckResult {
  type: CheckType;
  severity: Severity;
  status: CheckStatus;
  expected: string | null;
  actual: string | null;
  message: string;
}