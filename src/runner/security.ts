/**
 * Passive security hygiene checks for the PROD lane (Phase 2, Step 3).
 *
 * Read-only inspection of the main response: HTTPS, common security headers,
 * cookie flags, information-disclosure headers, and a canary that the monitor's
 * own identifier never appears in the served HTML. Findings are mostly `warn`
 * (informational hygiene); a non-HTTPS final URL or a reflected monitor token
 * are real failures.
 */

import type { CheckStatus, Severity } from "../types.js";
import type { CaptureResult } from "./capture.js";
import type { DeterministicCheck } from "./checks.js";

function check(
  severity: Severity,
  status: CheckStatus,
  expected: string | null,
  actual: string | null,
  message: string,
  evidence?: unknown,
): DeterministicCheck {
  return { type: "security_passive", severity, status, expected, actual, message, evidence };
}

const EXPECTED_HEADERS: { key: string; label: string }[] = [
  { key: "strict-transport-security", label: "HSTS" },
  { key: "x-content-type-options", label: "X-Content-Type-Options" },
  { key: "content-security-policy", label: "Content-Security-Policy" },
  { key: "referrer-policy", label: "Referrer-Policy" },
];

function frameProtected(headers: Record<string, string>): boolean {
  if (headers["x-frame-options"]) {
    return true;
  }
  const csp = headers["content-security-policy"]?.toLowerCase() ?? "";
  return csp.includes("frame-ancestors");
}

function httpsCheck(capture: CaptureResult): DeterministicCheck {
  const url = capture.finalUrl ?? "";
  return url.startsWith("https://")
    ? check("major", "pass", "https", url, "Served over HTTPS")
    : check("major", "fail", "https", url || "(none)", "Final URL is not HTTPS");
}

function headersCheck(capture: CaptureResult): DeterministicCheck {
  const headers = capture.rawHeaders ?? {};
  const missing: string[] = [];
  for (const expected of EXPECTED_HEADERS) {
    if (!headers[expected.key]) {
      missing.push(expected.label);
    }
  }
  if (!frameProtected(headers)) {
    missing.push("X-Frame-Options/frame-ancestors");
  }
  return missing.length === 0
    ? check("minor", "pass", "security headers present", "all present", "All checked security headers present")
    : check(
        "minor",
        "warn",
        "security headers present",
        `missing: ${missing.join(", ")}`,
        `Missing security headers: ${missing.join(", ")}`,
        { missing },
      );
}

function infoLeakCheck(capture: CaptureResult): DeterministicCheck | null {
  const headers = capture.rawHeaders ?? {};
  const poweredBy = headers["x-powered-by"];
  if (!poweredBy) {
    return null;
  }
  return check(
    "minor",
    "warn",
    "no version disclosure",
    `x-powered-by: ${poweredBy}`,
    "Information-disclosure header present (x-powered-by)",
    { poweredBy },
  );
}

function cookiesCheck(capture: CaptureResult): DeterministicCheck | null {
  if (capture.cookies.length === 0) {
    return null;
  }
  const insecure = capture.cookies
    .filter((c) => !c.secure)
    .map((c) => c.name);
  return insecure.length === 0
    ? check("minor", "pass", "secure cookies", `${capture.cookies.length} cookie(s)`, "All cookies set with Secure flag")
    : check(
        "minor",
        "warn",
        "secure cookies",
        `missing Secure: ${insecure.join(", ")}`,
        `Cookies set without Secure over HTTPS: ${insecure.join(", ")}`,
        { insecure, cookies: capture.cookies },
      );
}

function tokenLeakCheck(capture: CaptureResult): DeterministicCheck | null {
  if (capture.tokenLeak.length === 0) {
    return null;
  }
  return check(
    "major",
    "fail",
    "no monitor token in body",
    capture.tokenLeak.join(", "),
    "Monitor identifier reflected in served HTML (possible cache poisoning / leak)",
    { tokenLeak: capture.tokenLeak },
  );
}

/** Runs all passive security checks. Skipped entirely when there is no response. */
export function runSecurityChecks(capture: CaptureResult): DeterministicCheck[] {
  if (!capture.rawHeaders) {
    return [];
  }
  const out: DeterministicCheck[] = [httpsCheck(capture), headersCheck(capture)];
  for (const c of [infoLeakCheck(capture), cookiesCheck(capture), tokenLeakCheck(capture)]) {
    if (c) {
      out.push(c);
    }
  }
  return out;
}