/**
 * Deterministic check engine for the PROD lane (Phase 2, Step 2).
 *
 * Pure functions that turn a CaptureResult + ExpectationSet into CheckResult
 * rows, plus the sweep-level cross-country comparison and the run-status
 * aggregation. Deterministic and authoritative; the AI layer (Phase 4) only
 * advises and never overrides these.
 *
 * CTA correctness is intentionally NOT checked here (Phase 4c decision). The
 * differentiating CTAs ("Start Free Trial", "Book a Demo", etc.) live in the
 * global header, which DOM extraction excludes, so main-content CTA detection
 * is unreliable. CTA/experience correctness is left to the advisory AI verdict
 * and to the scenario engine (Bricks `.brxe-<id>` selectors), not text match.
 * The money-critical rule is still caught deterministically by the price check.
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
import type { CaptureResult, ScenarioObservation } from "./capture.js";

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

/**
 * Runs every applicable per-run check. http_health always runs.
 *
 * Note: there is no deterministic CTA check (Phase 4c). See the file header --
 * CTA correctness is handled by the advisory AI verdict and the scenario
 * engine, not here.
 */
export function runDeterministicChecks(
  capture: CaptureResult,
  expectation: ExpectationSet,
): DeterministicCheck[] {
  const out: DeterministicCheck[] = [httpHealthCheck(capture)];
  const optional = [
    cacheHeaderCheck(capture, expectation),
    languageCheck(capture, expectation),
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
/* Scenario checks (Bricks `.brxe-<id>` presence/absence in the live DOM)     */
/* -------------------------------------------------------------------------- */

/**
 * A single scenario to verify against a run's DOM observations. This is a
 * runner-facing view of a scenarios row; the sweep maps DB rows to this shape
 * so the check layer stays free of database concerns.
 */
export interface RunScenario {
  selector: string;
  expectation: "present" | "absent";
  kind: string;
  label: string | null;
  rule: string;
  isMoneyCritical: boolean;
  gating: boolean;
}

/**
 * Turns matched scenarios + the run's DOM observations into `scenario` checks.
 *
 * Severity: money-critical scenarios gate as `critical`, the rest as `major`.
 *
 * Safety: when a scenario has no matching observation (the probe failed for it),
 * the result is `warn` ("not evaluated") -- never `pass`. This is deliberate:
 * silently passing an `absent` expectation we could not actually verify would
 * mask a real leak (e.g. a price showing where it must not).
 */
export function scenarioChecks(
  scenarios: RunScenario[],
  observations: ScenarioObservation[],
): DeterministicCheck[] {
  if (scenarios.length === 0) {
    return [];
  }
  const bySelector = new Map<string, ScenarioObservation>();
  for (const obs of observations) {
    bySelector.set(obs.selector, obs);
  }

  const out: DeterministicCheck[] = [];
  for (const s of scenarios) {
    const severity: Severity = s.isMoneyCritical ? "critical" : "major";
    const label = s.label || s.selector;
    const expectedText = `${s.expectation} (${s.rule})`;
    const obs = bySelector.get(s.selector);

    if (!obs) {
      out.push(
        check(
          "scenario",
          severity,
          "warn",
          expectedText,
          "(not evaluated)",
          `Could not verify "${label}" [${s.rule}]`,
          {
            selector: s.selector,
            expectation: s.expectation,
            rule: s.rule,
            moneyCritical: s.isMoneyCritical,
          },
        ),
      );
      continue;
    }

    const ok = s.expectation === "present" ? obs.present : !obs.present;
    const observedWord = obs.present ? "present" : "absent";
    const actualText = `${observedWord} (matched ${obs.matched})`;

    out.push(
      check(
        "scenario",
        severity,
        ok ? "pass" : "fail",
        expectedText,
        actualText,
        ok
          ? `"${label}" correctly ${s.expectation} [${s.rule}]`
          : `"${label}" expected ${s.expectation} but was ${observedWord} [${s.rule}]`,
        {
          selector: s.selector,
          expectation: s.expectation,
          rule: s.rule,
          matched: obs.matched,
          present: obs.present,
          moneyCritical: s.isMoneyCritical,
        },
      ),
    );
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

/**
 * Derives the overall run status from its checks.
 *
 * Severity-aware: only `critical` and `major` checks gate the run. `minor`
 * checks (security-header hygiene, cookie flags, info-disclosure headers, cache
 * warming) are informational -- they are still persisted and visible, but they
 * never push a run to warn/fail. The dangerous failure modes are all
 * critical/major (http, geo, language, price, cross_country, scenario, HTTPS,
 * token-leak, heading, phone, interaction), so a clean run stays `pass`.
 */
export function aggregateRunStatus(
  capture: CaptureResult,
  checks: DeterministicCheck[],
): RunStatus {
  if (capture.error) {
    return "error";
  }
  let status: RunStatus = "pass";
  for (const c of checks) {
    if (c.severity === "minor") {
      continue; // informational only
    }
    if (c.status === "fail") {
      return "fail";
    }
    if (c.status === "warn") {
      status = "warn";
    }
  }
  return status;
}