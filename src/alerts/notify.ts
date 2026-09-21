/**
 * Turns one run's problems into (at most) one email.
 *
 * One digest per run, never one mail per finding: a bad deploy can break the
 * same thing on every page in every market, and forty emails about it convey
 * less than one. The severity floor, the renotify window and the recipients
 * all come from settings, so the volume can be tuned without a deploy.
 */

import { sendAlert } from "./mailer.js";
import { getAlertSettings } from "./settings.js";
import {
  fingerprintOf,
  markNotified,
  reconcileProblems,
  type Lane,
  type Problem,
} from "./state.js";

export interface NotifyInput {
  lane: Lane;
  /** Countries this run actually covered, so recovery is only inferred there. */
  countries: string[];
  /** Human label for the subject line, e.g. "health run #42 TR/tr". */
  runLabel: string;
  /** One line of context for the body, e.g. page counts. */
  summary: string;
  problems: Problem[];
  runId?: number | null;
  sweepId?: number | null;
}

function line(problem: { country: string | null; pageKey: string | null; findingType: string; severity: string; detail: string }): string {
  const where = [problem.country ?? "-", problem.pageKey ?? "-"].join(" ");
  return `  [${problem.severity}] ${where} ${problem.findingType} — ${problem.detail}`;
}

function formatDate(value: Date): string {
  return value.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export async function notifyRun(input: NotifyInput): Promise<void> {
  const settings = await getAlertSettings();
  if (!settings.enabled) {
    return;
  }

  const problems =
    settings.minSeverity === "critical"
      ? input.problems.filter((p) => p.severity === "critical")
      : input.problems;

  const result = await reconcileProblems(
    input.lane,
    input.countries,
    problems,
    settings.renotifyHours,
  );

  const reportable =
    result.fresh.length + result.reminders.length + result.recovered.length;
  if (reportable === 0) {
    // Everything is either healthy or already reported recently.
    if (result.quiet.length > 0) {
      console.log(
        `alerts: ${result.quiet.length} known problem(s) still open, not re-sent`,
      );
    }
    return;
  }

  const criticals = [...result.fresh, ...result.reminders].filter(
    (p) => p.severity === "critical",
  ).length;
  const majors =
    result.fresh.length + result.reminders.length - criticals;

  const counts: string[] = [];
  if (criticals > 0) counts.push(`${criticals} critical`);
  if (majors > 0) counts.push(`${majors} major`);
  if (counts.length === 0) counts.push(`${result.recovered.length} recovered`);

  const subject = `[FieldPie Monitor] ${input.runLabel} — ${counts.join(", ")}`;

  const body: string[] = [input.summary, ""];

  if (result.fresh.length > 0) {
    body.push(`NEW (${result.fresh.length})`);
    body.push(...result.fresh.map(line), "");
  }
  if (result.reminders.length > 0) {
    body.push(`STILL FAILING (${result.reminders.length})`);
    body.push(
      ...result.reminders.map(
        (p) => `${line(p)}  [since ${formatDate(p.firstSeenAt)}]`,
      ),
      "",
    );
  }
  if (result.recovered.length > 0) {
    body.push(`RECOVERED (${result.recovered.length})`);
    body.push(
      ...result.recovered.map(
        (r) =>
          `  ${r.country ?? "-"} ${r.pageKey ?? "-"} ${r.findingType} — fixed (open since ${formatDate(r.firstSeenAt)})`,
      ),
      "",
    );
  }
  if (result.quiet.length > 0) {
    body.push(
      `${result.quiet.length} other known problem(s) still open; already reported within the last ${settings.renotifyHours}h.`,
      "",
    );
  }

  const dashboard = process.env.DASHBOARD_URL?.trim();
  if (dashboard) {
    body.push(`Dashboard: ${dashboard}`);
  }

  const sent = await sendAlert({
    subject,
    text: body.join("\n"),
    severity: criticals > 0 ? "critical" : majors > 0 ? "major" : "info",
    runId: input.runId ?? null,
    sweepId: input.sweepId ?? null,
  });

  if (sent.ok) {
    // Only now: a failed send must be retried on the next run, not forgotten.
    await markNotified([
      ...result.fresh.map(fingerprintOf),
      ...result.reminders.map((p) => fingerprintOf(p)),
    ]);
    console.log(`alerts: emailed ${sent.recipients.join(", ")} — ${subject}`);
  } else {
    console.warn(`alerts: not sent (${sent.error})`);
  }
}
