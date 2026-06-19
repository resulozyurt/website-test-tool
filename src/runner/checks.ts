/**
 * Deterministic check engine for the PROD lane (Phase 2, Step 2).
 *
 * Pure functions that turn a CaptureResult + ExpectationSet into CheckResult
 * rows, plus the sweep-level cross-country comparison and the run-status
 * aggregation. Deterministic and authoritative; the AI layer (Phase 4) only
 * advises and never overrides these.
 */

import type {
  CheckResult,
  CheckStatus,
  CheckType,
  CountryCode,
  ExpectationSet,
  RunStatus,
  Severity,
} from "../types.js";
import type { CaptureResult } from "./capture.js";
import type { ContentMarkers } from "./signals.js";

/** A CheckResult plus optional structured evidence persisted to checks.evidence. */
export interface DeterministicCheck extends CheckResult {
  evidence?: unknown;
}

function check(
  type: CheckType,
  severity: Severity,
  status: CheckStatus,
  expected: string | null,
  actual: string | null,
  message: string,
  evidence?: unknown,
): DeterministicCheck {
  return { type, severity, status, expected, actual, message, evidence };
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Returns presence of a known CTA, or null when the CTA cannot be verified. */
function ctaPresent(markers: ContentMarkers, label: string): boolean | null {
  const l = label.trim().toLowerCase();
  if (l === "start free trial") {
    return markers.hasStartFreeTrial;
  }
  if (l === "book a demo") {
    return markers.hasBookDemo;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Per-run checks                                                             */
/* -------------------------------------------------------------------------- */

function httpHealthCheck(capture: CaptureResult): DeterministicCheck {
  if (capture.error) {
    return check(
      "http_health",
      "critical",
      "fail",
      "200",
      null,
      `Navigation failed: ${capture.error}`,
      { error: capture.error },
    );
  }
  const http = capture.cache?.httpStatus ?? null;
  if (http === 200 && !capture.blockDetected) {
    return check("http_health", "critical", "pass", "200", "200", "HTTP 200 OK");
  }
  const reason = capture.blockDetected ? "block page detected" : `HTTP ${http ?? "?"}`;
  return check(
    "http_health",
    "critical",
    "fail",
    "200",
    http === null ? null : String(http),
    `Unhealthy response: ${reason}`,
    { blockDetected: capture.blockDetected, bodySnippet: capture.bodySnippet },
  );
}

/**
 * Verifies the SITE detected the same country we are testing as (whereami).
 * This is the authoritative geo signal: if the site saw a different country,
 * the proxy was not recognized as that country and the whole run is measuring
 * the wrong experience. Skipped when whereami is unavailable.
 */
export function geoCheck(
  capture: CaptureResult,
  country: CountryCode,
): DeterministicCheck | null {
  const detected = capture.siteCountry;
  if (!detected) {
    return null;
  }
  if (detected.toUpperCase() === country.toUpperCase()) {
    return check("geo", "critical", "pass", country, detected, `Site detected ${detected}`);
  }
  return check(
    "geo",
    "critical",
    "fail",
    country,
    detected,
    `Site detected ${detected}, expected ${country} (proxy not recognized as ${country})`,
    { siteCountry: detected, expected: country },
  );
}

function cacheHeaderCheck(
  capture: CaptureResult,
  exp: ExpectationSet,
): DeterministicCheck | null {
  const expected = exp.cachePolicy?.kinstaCache;
  if (!expected) {
    return null;
  }
  const actual = capture.cache?.kinstaCache ?? null;
  if (actual && actual.toUpperCase() === expected.toUpperCase()) {
    return check("cache_header", "minor", "pass", expected, actual, `x-kinsta-cache ${actual}`);
  }
  if (!actual) {
    return check(
      "cache_header",
      "minor",
      "warn",
      expected,
      "(absent)",
      "x-kinsta-cache header absent",
    );
  }
  return check(
    "cache_header",
    "minor",
    "warn",
    expected,
    actual,
    `x-kinsta-cache ${actual} (expected ${expected}); cache may be warming`,
  );
}

function languageCheck(
  capture: CaptureResult,
  exp: ExpectationSet,
): DeterministicCheck | null {
  const markers = capture.markers;
  const lang = exp.language;
  if (!markers || !lang) {
    return null;
  }
  const htmlLang = (markers.htmlLang || "").toLowerCase();

  // Dangerous case first: a language we must NOT be (e.g. silent TR fallback).
  for (const bad of lang.mustNotBe ?? []) {
    const b = bad.toLowerCase();
    const byLang = b.length > 0 && htmlLang.startsWith(b);
    const byText = b === "tr" && markers.turkishDetected;
    if (byLang || byText) {
      return check(
        "language",
        "critical",
        "fail",
        lang.htmlLang ?? `not ${bad}`,
        htmlLang || "(none)",
        `Unexpected language "${bad}"${byText ? " (Turkish text detected)" : ""}`,
        { htmlLang, turkishDetected: markers.turkishDetected },
      );
    }
  }

  if (lang.htmlLang) {
    if (htmlLang.startsWith(lang.htmlLang.toLowerCase())) {
      return check("language", "critical", "pass", lang.htmlLang, htmlLang, `html lang "${htmlLang}"`);
    }
    return check(
      "language",
      "critical",
      "fail",
      lang.htmlLang,
      htmlLang || "(none)",
      `Expected lang "${lang.htmlLang}", got "${htmlLang || "none"}"`,
      { htmlLang },
    );
  }
  return null;
}

function ctaCheck(
  capture: CaptureResult,
  exp: ExpectationSet,
): DeterministicCheck | null {
  const markers = capture.markers;
  if (!markers || !exp.cta) {
    return null;
  }
  const evidence = {
    hasStartFreeTrial: markers.hasStartFreeTrial,
    hasBookDemo: markers.hasBookDemo,
  };

  if (exp.cta.primary) {
    const has = ctaPresent(markers, exp.cta.primary);
    if (has === false) {
      return check(
        "cta",
        "major",
        "fail",
        exp.cta.primary,
        "(absent)",
        `Expected CTA "${exp.cta.primary}" not found`,
        evidence,
      );
    }
  }
  for (const bad of exp.cta.mustNotContain ?? []) {
    if (ctaPresent(markers, bad) === true) {
      return check(
        "cta",
        "major",
        "fail",
        `without "${bad}"`,
        bad,
        `Unexpected CTA "${bad}" present`,
        evidence,
      );
    }
  }
  return check("cta", "major", "pass", exp.cta.primary ?? null, "ok", "CTA expectations met", evidence);
}

function phoneCheck(
  capture: CaptureResult,
  exp: ExpectationSet,
): DeterministicCheck | null {
  const markers = capture.markers;
  if (!markers || !exp.phone?.equals) {
    return null;
  }
  const expected = exp.phone.equals;
  const expTail = onlyDigits(expected).slice(-10);
  const actualList = markers.phoneNumbers.join(", ") || "(none)";
  const found = markers.phoneNumbers.some((p) => {
    const d = onlyDigits(p);
    return d.length >= 7 && d.slice(-10) === expTail;
  });
  return found
    ? check("phone", "major", "pass", expected, actualList, "Expected phone present")
    : check(
        "phone",
        "major",
        "fail",
        expected,
        actualList,
        `Expected phone "${expected}" not found`,
        { phoneNumbers: markers.phoneNumbers },
      );
}

function priceCheck(
  capture: CaptureResult,
  exp: ExpectationSet,
): DeterministicCheck | null {
  const markers = capture.markers;
  if (!markers || !exp.price) {
    return null;
  }
  const symbols = markers.currencySymbols.join(", ") || "(none)";

  // Money-critical: deterministic and authoritative.
  if (exp.price.currency) {
    const present = markers.currencySymbols.includes(exp.price.currency);
    return present
      ? check("price", "critical", "pass", exp.price.currency, symbols, "Expected currency present")
      : check(
          "price",
          "critical",
          "fail",
          exp.price.currency,
          symbols,
          `Expected currency "${exp.price.currency}" not found`,
          { currencySymbols: markers.currencySymbols },
        );
  }
  if (exp.price.visible !== undefined) {
    const anyCurrency = markers.currencySymbols.length > 0;
    if (exp.price.visible) {
      return anyCurrency
        ? check("price", "critical", "pass", "price visible", symbols, "Price/currency visible")
        : check("price", "critical", "fail", "price visible", "(none)", "Expected visible price, none detected");
    }
    return anyCurrency
      ? check("price", "critical", "fail", "price hidden", symbols, "Price unexpectedly visible")
      : check("price", "critical", "pass", "price hidden", "(none)", "No price shown, as expected");
  }
  return null;
}

function headingCheck(
  capture: CaptureResult,
  exp: ExpectationSet,
): DeterministicCheck | null {
  const markers = capture.markers;
  if (!markers || !exp.heading?.contains) {
    return null;
  }
  const needle = exp.heading.contains.trim().toLowerCase();
  const heading = markers.firstHeading.trim();
  return heading.toLowerCase().includes(needle)
    ? check("heading", "major", "pass", exp.heading.contains, heading || "(none)", "Heading contains expected text")
    : check(
        "heading",
        "major",
        "fail",
        exp.heading.contains,
        heading || "(none)",
        `Heading missing "${exp.heading.contains}"`,
        { firstHeading: heading },
      );
}

/** Runs every applicable per-run check. http_health always runs. */
export function runDeterministicChecks(
  capture: CaptureResult,
  expectation: ExpectationSet,
): DeterministicCheck[] {
  const out: DeterministicCheck[] = [httpHealthCheck(capture)];
  const optional = [
    cacheHeaderCheck(capture, expectation),
    languageCheck(capture, expectation),
    ctaCheck(capture, expectation),
    phoneCheck(capture, expectation),
    priceCheck(capture, expectation),
    headingCheck(capture, expectation),
  ];
  for (const c of optional) {
    if (c) {
      out.push(c);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Cross-country (sweep-level)                                                */
/* -------------------------------------------------------------------------- */

/** Map key for a page's fingerprint in a given country. */
export function fingerprintKey(pageKey: string, country: CountryCode): string {
  return `${pageKey}::${country}`;
}

/**
 * Verifies this run's content fingerprint differs from the countries it must
 * differ from (same page). A collision means content is not differentiated --
 * a silent fallback or cache mis-bucketing.
 */
export function crossCountryCheck(
  country: CountryCode,
  pageKey: string,
  exp: ExpectationSet,
  fingerprints: Map<string, string>,
): DeterministicCheck | null {
  const mustDiffer = exp.cachePolicy?.mustDifferFrom ?? [];
  if (mustDiffer.length === 0) {
    return null;
  }
  const mine = fingerprints.get(fingerprintKey(pageKey, country));
  if (!mine) {
    return null; // no healthy capture to compare
  }
  const collisions: CountryCode[] = [];
  for (const other of mustDiffer) {
    const theirs = fingerprints.get(fingerprintKey(pageKey, other));
    if (theirs && theirs === mine) {
      collisions.push(other);
    }
  }
  if (collisions.length === 0) {
    return check(
      "cross_country",
      "major",
      "pass",
      `differs from ${mustDiffer.join(", ")}`,
      mine,
      `Content fingerprint differs from ${mustDiffer.join(", ")}`,
      { fingerprint: mine },
    );
  }
  return check(
    "cross_country",
    "major",
    "fail",
    `differs from ${mustDiffer.join(", ")}`,
    `same as ${collisions.join(", ")}`,
    `Content NOT differentiated: identical fingerprint to ${collisions.join(", ")} (possible silent fallback / cache mis-bucketing)`,
    { fingerprint: mine, collisions },
  );
}

/* -------------------------------------------------------------------------- */
/* Aggregation                                                                */
/* -------------------------------------------------------------------------- */

/** Derives the overall run status from its checks. */
export function aggregateRunStatus(
  capture: CaptureResult,
  checks: DeterministicCheck[],
): RunStatus {
  if (capture.error) {
    return "error";
  }
  let status: RunStatus = "pass";
  for (const c of checks) {
    if (c.status === "fail") {
      if (c.severity === "critical" || c.severity === "major") {
        return "fail";
      }
      status = "warn"; // minor failure
    } else if (c.status === "warn" && status === "pass") {
      status = "warn";
    }
  }
  return status;
}