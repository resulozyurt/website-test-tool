/**
 * Non-submitting interaction engine for the PROD lane (Phase 2, Step 3).
 *
 * Executes a short sequence of safe, read-only interactions on an already
 * loaded page (open a popup, assert an element is visible, fill a field
 * locally) and turns the outcome into an `interaction` check. There is
 * deliberately no "submit" step: PROD never causes side effects.
 */

import type { Page } from "playwright";
import type { CheckStatus, Severity } from "../types.js";
import type { DeterministicCheck } from "./checks.js";

export type InteractionStep =
  | { kind: "click"; selector: string; label: string }
  | { kind: "expectVisible"; selector: string; label: string }
  | { kind: "fill"; selector: string; value: string; label: string };

export interface InteractionOutcome {
  label: string;
  kind: InteractionStep["kind"];
  ok: boolean;
  detail: string;
}

export interface BlockedWrite {
  url: string;
  method: string;
}

const STEP_TIMEOUT_MS = 8000;

function check(
  severity: Severity,
  status: CheckStatus,
  expected: string | null,
  actual: string | null,
  message: string,
  evidence?: unknown,
): DeterministicCheck {
  return { type: "interaction", severity, status, expected, actual, message, evidence };
}

/**
 * Runs the steps in order, stopping at the first failure (later steps usually
 * depend on earlier ones). Never throws; failures are captured in the outcome.
 */
export async function runInteractions(
  page: Page,
  steps: InteractionStep[],
): Promise<InteractionOutcome[]> {
  const outcomes: InteractionOutcome[] = [];
  for (const step of steps) {
    try {
      if (step.kind === "click") {
        await page.click(step.selector, { timeout: STEP_TIMEOUT_MS });
        outcomes.push({ label: step.label, kind: step.kind, ok: true, detail: "clicked" });
      } else if (step.kind === "expectVisible") {
        await page.waitForSelector(step.selector, {
          state: "visible",
          timeout: STEP_TIMEOUT_MS,
        });
        outcomes.push({ label: step.label, kind: step.kind, ok: true, detail: "visible" });
      } else {
        // Local fill only; this never triggers a submit.
        await page.fill(step.selector, step.value, { timeout: STEP_TIMEOUT_MS });
        outcomes.push({ label: step.label, kind: step.kind, ok: true, detail: "filled" });
      }
    } catch (err) {
      outcomes.push({
        label: step.label,
        kind: step.kind,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
      break;
    }
  }
  return outcomes;
}

/** Builds the interaction check(s) from the outcomes and the read-only guard. */
export function interactionChecks(
  outcomes: InteractionOutcome[],
  blockedWrites: BlockedWrite[],
): DeterministicCheck[] {
  if (outcomes.length === 0) {
    return [];
  }
  const out: DeterministicCheck[] = [];
  const failed = outcomes.filter((o) => !o.ok);

  if (failed.length === 0) {
    out.push(
      check(
        "major",
        "pass",
        `${outcomes.length} step(s)`,
        "all ok",
        `Interaction passed: ${outcomes.map((o) => o.label).join(" -> ")}`,
        { outcomes },
      ),
    );
  } else {
    out.push(
      check(
        "major",
        "fail",
        `${outcomes.length} step(s)`,
        `${failed.length} failed`,
        `Interaction failed at "${failed[0].label}": ${failed[0].detail}`,
        { outcomes },
      ),
    );
  }

  // Safety canary: a blocked write during interaction means a step tried to
  // mutate the live site -- almost certainly a bad (submitting) spec.
  if (blockedWrites.length > 0) {
    out.push(
      check(
        "major",
        "warn",
        "no write attempts",
        `${blockedWrites.length} blocked`,
        `Read-only guard blocked ${blockedWrites.length} non-GET request(s) during interaction; the interaction spec may include a submitting step`,
        { blockedWrites },
      ),
    );
  }
  return out;
}