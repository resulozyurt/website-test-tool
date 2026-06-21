/**
 * Read-only domain vocabulary for the dashboard.
 *
 * This is a deliberate, minimal copy of the relevant types in
 * ../../src/types.ts. The dashboard deploys from its own Railway root
 * (root = dashboard/), so it cannot import from the runner's src/. If the
 * runner's vocabulary changes, update this file by hand to match.
 */

export type LanguageCode = "en" | "tr" | "es" | "ar";
export type CountryCode = "US" | "AE" | "TR";
export type EnvironmentKey = "production" | "staging";

export type Severity = "critical" | "major" | "minor";
export type CheckStatus = "pass" | "warn" | "fail";
export type RunStatus = "pass" | "warn" | "fail" | "error";
export type SweepStatus = "running" | "pass" | "warn" | "fail";
export type SweepTrigger = "cron" | "manual";

export type CheckType =
  | "http_health"
  | "geo"
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
