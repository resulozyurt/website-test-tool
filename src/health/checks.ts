/**
 * Turns raw PageHealth signals into findings (category + type + severity +
 * message) and an aggregate page status. Deterministic and authoritative; the
 * AI visual result is folded in as advisory (minor) findings that never gate.
 *
 * Severity model mirrors the geo lane: only critical/major gate the page;
 * minor is informational. Aggregate: error > fail > warn > pass.
 */

import type { PageHealth } from "./inspect.js";
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

/**
 * Builds all findings for one inspected page. `expectedCta` is the market's
 * primary CTA (from config); `ai` is the optional AI visual result.
 */
export function buildFindings(
  page: PageHealth,
  expectedCta: ExpectedCta | undefined,
  ai: AiVisualResult | null,
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

  if (page.consoleErrors.length > 0) {
    out.push(
      finding(
        "technical",
        "console_error",
        "major",
        `${page.consoleErrors.length} JS console error(s)`,
        { errors: page.consoleErrors.slice(0, 10) },
      ),
    );
  }

  if (page.networkErrors.length > 0) {
    out.push(
      finding(
        "technical",
        "broken_resource",
        "major",
        `${page.networkErrors.length} failed resource request(s) (4xx/5xx/blocked)`,
        { errors: page.networkErrors.slice(0, 15) },
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