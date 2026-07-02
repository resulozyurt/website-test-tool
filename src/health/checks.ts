/**
 * Turns raw PageHealth signals into findings (category + type + severity +
 * message) and an aggregate page status. Deterministic and authoritative; the
 * AI visual result is folded in as advisory (minor) findings that never gate.
 *
 * Severity model mirrors the geo lane: only critical/major gate the page;
 * minor is informational. Aggregate: error > fail > warn > pass.
 *
 * Console errors and failed resource requests are attributed to an origin:
 * first-party failures (fieldpie.com) gate as `major`; third-party or
 * unknown-origin noise (analytics, ad/chat widgets, CORS, aborted/blocked
 * requests) is demoted to a `minor` advisory finding so it stays visible in the
 * panel without failing the page. This keeps real first-party regressions
 * gating while eliminating the observed false failures.
 */

import type {
  ConsoleErrorEntry,
  NetworkErrorEntry,
  PageHealth,
} from "./inspect.js";
import type { AiVisualResult } from "./ai-visual.js";
import {
  findExpectedCta,
  type FunctionalSignals,
} from "./functional.js";
import type { ExpectedCta } from "./functional.js";
import type {
  FindingCategory,
  FindingSeverity,
  FindingSource,
  HealthStatus,
  HealthFindingInput,
} from "./store.js";

function finding(
  category: FindingCategory,
  type: string,
  severity: FindingSeverity,
  message: string,
  detail?: unknown,
  source: FindingSource = "deterministic",
): HealthFindingInput {
  return { category, type, severity, source, message, detail };
}

/** Hostname of a URL, lowercased, or null when it cannot be parsed. */
function hostOf(rawUrl: string | null): string | null {
  if (!rawUrl) {
    return null;
  }
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True when the URL's host is one of the first-party hosts (exact match or a
 * subdomain of it). Unknown/unparseable hosts are NOT first-party -- unknown
 * origin is treated as noise so it cannot gate the page.
 */
function isFirstPartyHost(rawUrl: string | null, firstPartyHosts: string[]): boolean {
  const host = hostOf(rawUrl);
  if (!host) {
    return false;
  }
  return firstPartyHosts.some((h) => {
    const base = h.toLowerCase();
    return host === base || host.endsWith(`.${base}`);
  });
}

/**
 * Network failures that are NOT server (4xx/5xx) faults and must not gate the
 * page. Two groups:
 *  - Aborted/blocked: ad/tracker blocking, client aborts, CSP/CORP responses.
 *  - Transient connection failures: a single dropped/reset/timed-out request
 *    over the residential proxy + Cloudflare edge. These are flaky by nature
 *    (observed once on a Bricks FontAwesome .woff2 that loaded fine on 119/120
 *    pages), so a single occurrence must not fail the page. A resource that is
 *    genuinely gone still surfaces as a real HTTP 4xx/5xx (status >= 400), which
 *    is handled separately and continues to gate. Persistent connection
 *    failures are meant to be escalated later by the scheduler (same target
 *    failing across consecutive runs), not by a single crawl.
 */
const NON_SERVER_FAILURE_RE =
  /ERR_ABORTED|ERR_FAILED|ERR_BLOCKED|BLOCKED_BY_CLIENT|BLOCKED_BY_RESPONSE|NS_BINDING_ABORTED|ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ERR_CONNECTION_REFUSED|ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|ERR_NETWORK_CHANGED|ERR_EMPTY_RESPONSE|ERR_SOCKET_NOT_CONNECTED|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE/i;

function isNonServerFailure(failure: string | null): boolean {
  return failure != null && NON_SERVER_FAILURE_RE.test(failure);
}

/**
 * Console messages that describe resource-load / CORS / network outcomes rather
 * than a JS execution fault. Resource health is owned authoritatively by the
 * network check (`broken_resource`), which has the real request host; the
 * console mirror of it carries no reliable host, so these must never gate on
 * their own. Chrome attributes CORS failures to the PAGE url (first-party),
 * which is exactly why url-only attribution is not enough here.
 */
const RESOURCE_OR_CORS_RE =
  /CORS policy|blocked by CORS|Cross-Origin|Access to (?:script|XMLHttpRequest|fetch|image|font|the script|resource)|Failed to load resource|net::ERR_|ERR_BLOCKED|has been blocked/i;

/** Extracts every http(s) host mentioned in free text (URLs may be quoted). */
function hostsInText(text: string): string[] {
  const hosts: string[] = [];
  const matches = text.match(/https?:\/\/[^\s'"()]+/g) ?? [];
  for (const m of matches) {
    const h = hostOf(m);
    if (h) {
      hosts.push(h);
    }
  }
  return hosts;
}

/**
 * Decides whether a console error should gate as first-party or be demoted to
 * advisory noise. A JS execution error whose only referenced hosts are
 * first-party gates (`major`). Anything that looks like a resource/CORS/network
 * message, references any non-first-party host, or has no determinable origin is
 * treated as noise (`minor`) so it cannot cause a false failure.
 */
function isFirstPartyConsoleError(
  entry: ConsoleErrorEntry,
  firstPartyHosts: string[],
): boolean {
  // Resource/CORS/network chatter is owned by the network check, never gates here.
  if (RESOURCE_OR_CORS_RE.test(entry.text)) {
    return false;
  }
  const hosts = hostsInText(entry.text);
  const entryHost = hostOf(entry.url);
  if (entryHost) {
    hosts.push(entryHost);
  }
  if (hosts.length === 0) {
    // No determinable origin -> do not gate (unknown is noise under model B).
    return false;
  }
  // Any non-first-party host present -> treat as third-party noise.
  const anyExternal = hosts.some((h) => !isFirstPartyHost(`https://${h}`, firstPartyHosts));
  if (anyExternal) {
    return false;
  }
  // All referenced hosts are first-party -> a genuine first-party JS error.
  return true;
}

/**
 * Builds all findings for one inspected page. `expectedCta` is the market's
 * primary CTA (from config); `ai` is the optional AI visual result;
 * `firstPartyHosts` is the set of hosts whose failures gate (from config).
 */
export function buildFindings(
  page: PageHealth,
  expectedCta: ExpectedCta | undefined,
  ai: AiVisualResult | null,
  firstPartyHosts: string[],
): HealthFindingInput[] {
  const out: HealthFindingInput[] = [];

  // --- Technical -----------------------------------------------------------
  if (page.error) {
    out.push(
      finding("technical", "load_error", "critical", `Page failed to load: ${page.error}`, {
        error: page.error,
      }),
    );
    // A hard load error means the rest of the signals are unreliable; still
    // return what we have (mostly empty) so the page is recorded as failing.
    return out;
  }

  const http = page.httpStatus;
  if (http === null || http >= 400) {
    out.push(
      finding("technical", "http_status", "critical", `Unhealthy HTTP status: ${http ?? "?"}`, {
        httpStatus: http,
        finalUrl: page.finalUrl,
      }),
    );
  }

  if (page.blank) {
    out.push(
      finding("technical", "blank_page", "critical", "Page rendered blank / almost no content", {
        textLength: page.visual?.textLength ?? 0,
        scrollHeight: page.visual?.scrollHeight ?? 0,
      }),
    );
  }

  // Console errors, split by origin. Chrome reports CORS/resource failures
  // against the page url, so url-only attribution is not enough: we also read
  // the message text (hosts + resource/CORS patterns). Only genuine first-party
  // JS execution errors gate; resource/CORS/third-party/unknown are advisory.
  const firstPartyConsole: ConsoleErrorEntry[] = [];
  const otherConsole: ConsoleErrorEntry[] = [];
  for (const e of page.consoleErrors) {
    if (isFirstPartyConsoleError(e, firstPartyHosts)) {
      firstPartyConsole.push(e);
    } else {
      otherConsole.push(e);
    }
  }
  if (firstPartyConsole.length > 0) {
    out.push(
      finding(
        "technical",
        "console_error",
        "major",
        `${firstPartyConsole.length} first-party JS console error(s)`,
        { errors: firstPartyConsole.slice(0, 10) },
      ),
    );
  }
  if (otherConsole.length > 0) {
    out.push(
      finding(
        "technical",
        "console_error_thirdparty",
        "minor",
        `${otherConsole.length} third-party/unknown console error(s) (ignored)`,
        { errors: otherConsole.slice(0, 10) },
      ),
    );
  }

  // Failed resource requests, split by origin. Only real first-party 4xx/5xx
  // (or a genuine first-party load failure) gates; third-party and
  // aborted/blocked requests are advisory noise.
  const firstPartyBroken: NetworkErrorEntry[] = [];
  const noiseBroken: NetworkErrorEntry[] = [];
  for (const n of page.networkErrors) {
    const isNoise =
      !isFirstPartyHost(n.url, firstPartyHosts) || isNonServerFailure(n.failure);
    if (isNoise) {
      noiseBroken.push(n);
    } else {
      firstPartyBroken.push(n);
    }
  }
  if (firstPartyBroken.length > 0) {
    out.push(
      finding(
        "technical",
        "broken_resource",
        "major",
        `${firstPartyBroken.length} first-party resource request(s) failed (4xx/5xx/blocked)`,
        { errors: firstPartyBroken.slice(0, 15) },
      ),
    );
  }
  if (noiseBroken.length > 0) {
    out.push(
      finding(
        "technical",
        "third_party_noise",
        "minor",
        `${noiseBroken.length} third-party/aborted resource request(s) (ignored)`,
        { errors: noiseBroken.slice(0, 15) },
      ),
    );
  }

  // --- Visual (deterministic) ---------------------------------------------
  const v = page.visual;
  if (v) {
    if (v.brokenImages.length > 0) {
      out.push(
        finding("visual", "broken_image", "major", `${v.brokenImages.length} broken image(s)`, {
          images: v.brokenImages,
        }),
      );
    }
    if (v.horizontalOverflow) {
      out.push(
        finding("visual", "horizontal_overflow", "major", "Page overflows horizontally (layout likely broken)", {
          scrollWidth: v.scrollWidth,
          clientWidth: v.clientWidth,
        }),
      );
    }
    if (v.overflowingElements.length > 0) {
      out.push(
        finding("visual", "overflowing_element", "minor", `${v.overflowingElements.length} element(s) spill past the viewport`, {
          elements: v.overflowingElements,
        }),
      );
    }
    if (v.fontStatus === "loading") {
      out.push(
        finding("visual", "fonts_not_loaded", "minor", "Web fonts had not finished loading", {
          fontStatus: v.fontStatus,
        }),
      );
    }
  }

  // --- Functional ----------------------------------------------------------
  const f: FunctionalSignals | null = page.functional;
  if (f) {
    const brokenHrefs = f.links.filter((l) => l.brokenHref);
    if (brokenHrefs.length > 0) {
      out.push(
        finding("functional", "dead_href", "minor", `${brokenHrefs.length} link(s) with empty/# / javascript href`, {
          links: brokenHrefs.slice(0, 15).map((l) => ({ text: l.text, tag: l.tag })),
        }),
      );
    }
    const unclickable = f.links.filter((l) => !l.clickable && !l.brokenHref);
    if (unclickable.length > 0) {
      out.push(
        finding("functional", "unclickable", "minor", `${unclickable.length} link/button(s) not clickable (hidden/zero-size/covered/disabled)`, {
          links: unclickable.slice(0, 15).map((l) => ({ text: l.text, tag: l.tag })),
        }),
      );
    }
  }

  if (page.deadLinks.length > 0) {
    out.push(
      finding("functional", "dead_link", "major", `${page.deadLinks.length} internal link target(s) not reachable`, {
        links: page.deadLinks,
      }),
    );
  }

  // Expected primary CTA for the market (present + clickable).
  if (expectedCta && f) {
    const cta = findExpectedCta(f, expectedCta);
    if (!cta.present) {
      out.push(
        finding("functional", "cta_missing", "major", `Expected CTA "${expectedCta.text}" not found`, {
          expected: expectedCta.text,
        }),
      );
    } else if (!cta.clickable) {
      out.push(
        finding("functional", "cta_unclickable", "major", `Expected CTA "${expectedCta.text}" present but not clickable`, {
          expected: expectedCta.text,
          href: cta.href,
        }),
      );
    }
    if (expectedCta.hrefContains && cta.href && !cta.href.includes(expectedCta.hrefContains)) {
      out.push(
        finding("functional", "cta_target", "minor", `CTA "${expectedCta.text}" target does not contain "${expectedCta.hrefContains}"`, {
          expected: expectedCta.hrefContains,
          actual: cta.href,
        }),
      );
    }
  }

  // --- AI (advisory, minor) ------------------------------------------------
  if (ai && ai.verdict === "issues" && ai.issues.length > 0) {
    for (const issue of ai.issues) {
      out.push(finding("visual", "ai_visual", "minor", issue, { suggestion: ai.suggestion }, "ai"));
    }
  }

  return out;
}

/** Derives page status from its findings. critical/major gate; minor is info. */
export function aggregatePageStatus(
  page: PageHealth,
  findings: HealthFindingInput[],
): HealthStatus {
  if (page.error) {
    return "error";
  }
  let status: HealthStatus = "pass";
  for (const fnd of findings) {
    if (fnd.severity === "minor") {
      continue;
    }
    if (fnd.severity === "critical") {
      return "fail";
    }
    if (fnd.severity === "major") {
      status = "fail";
    }
  }
  return status;
}