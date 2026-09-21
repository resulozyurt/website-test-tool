/**
 * Which problems are worth an email this run.
 *
 * A monitoring system that mails the same unchanged failure every night gets
 * filtered into a folder nobody opens, and then the one new failure is missed
 * too. So each distinct problem is tracked by a fingerprint and reported on a
 * schedule rather than on every run: new problems immediately, unchanged ones
 * at most once per renotify window, and disappearances once.
 *
 * Recovery is only inferred inside the scope that actually ran. A crawl of TR
 * alone says nothing about US problems, and treating "not seen" as "fixed"
 * there would send a false all-clear -- the most damaging message a monitor
 * can send.
 */

import { pool, withRetry } from "../db/client.js";

export type Lane = "health" | "sweep";
export type ProblemSeverity = "critical" | "major";

export interface Problem {
  lane: Lane;
  country: string | null;
  /** Page key or slug; null for a problem about the run as a whole. */
  pageKey: string | null;
  findingType: string;
  severity: ProblemSeverity;
  detail: string;
}

export interface RecoveredProblem {
  fingerprint: string;
  country: string | null;
  pageKey: string | null;
  findingType: string;
  firstSeenAt: Date;
}

export interface ReconcileResult {
  /** Not open before this run: report now. */
  fresh: Problem[];
  /** Still open and past the renotify window: remind. */
  reminders: (Problem & { firstSeenAt: Date })[];
  /** Still open but reported recently: stay quiet. */
  quiet: Problem[];
  /** Was open, gone now: report once. */
  recovered: RecoveredProblem[];
}

export function fingerprintOf(problem: Problem): string {
  return [
    problem.lane,
    problem.country ?? "-",
    problem.pageKey ?? "-",
    problem.findingType,
  ].join(":");
}

interface StateRow {
  fingerprint: string;
  status: string;
  firstSeenAt: Date;
  lastNotifiedAt: Date | null;
  country: string | null;
  pageKey: string | null;
  findingType: string;
}

/**
 * Records what this run saw and classifies each problem. Does not send
 * anything and does not mark anything as notified -- that happens only after
 * the email is actually accepted, so a failed send retries next run instead
 * of being silently swallowed.
 */
export async function reconcileProblems(
  lane: Lane,
  countries: string[],
  problems: Problem[],
  renotifyHours: number,
): Promise<ReconcileResult> {
  const scope = countries.length > 0 ? countries : null;
  const existing = await withRetry(
    () =>
      pool.query<StateRow>(
        `select fingerprint,
                status,
                first_seen_at    as "firstSeenAt",
                last_notified_at as "lastNotifiedAt",
                country,
                page_key         as "pageKey",
                finding_type     as "findingType"
           from alert_state
          where lane = $1
            and ($2::text[] is null or country = any($2))`,
        [lane, scope],
      ),
    "reconcileProblems.load",
  );
  const byFingerprint = new Map(existing.rows.map((row) => [row.fingerprint, row]));

  const result: ReconcileResult = { fresh: [], reminders: [], quiet: [], recovered: [] };
  const seen = new Set<string>();
  const cutoff = Date.now() - renotifyHours * 3600_000;

  for (const problem of problems) {
    const fingerprint = fingerprintOf(problem);
    if (seen.has(fingerprint)) {
      continue; // one page can fail the same way twice in a run
    }
    seen.add(fingerprint);
    const row = byFingerprint.get(fingerprint);

    if (!row || row.status !== "open") {
      result.fresh.push(problem);
    } else if (!row.lastNotifiedAt || row.lastNotifiedAt.getTime() < cutoff) {
      result.reminders.push({ ...problem, firstSeenAt: row.firstSeenAt });
    } else {
      result.quiet.push(problem);
    }

    await withRetry(
      () =>
        pool.query(
          `insert into alert_state
             (fingerprint, lane, country, page_key, finding_type, severity, status, detail)
           values ($1, $2, $3, $4, $5, $6, 'open', $7)
           on conflict (fingerprint) do update set
             severity     = excluded.severity,
             detail       = excluded.detail,
             status       = 'open',
             last_seen_at = now(),
             first_seen_at = case
               when alert_state.status = 'resolved' then now()
               else alert_state.first_seen_at
             end`,
          [
            fingerprint,
            problem.lane,
            problem.country,
            problem.pageKey,
            problem.findingType,
            problem.severity,
            problem.detail.slice(0, 500),
          ],
        ),
      "reconcileProblems.upsert",
    );
  }

  for (const row of existing.rows) {
    if (row.status !== "open" || seen.has(row.fingerprint)) {
      continue;
    }
    result.recovered.push({
      fingerprint: row.fingerprint,
      country: row.country,
      pageKey: row.pageKey,
      findingType: row.findingType,
      firstSeenAt: row.firstSeenAt,
    });
    await withRetry(
      () =>
        pool.query(
          `update alert_state set status = 'resolved', last_seen_at = now()
            where fingerprint = $1`,
          [row.fingerprint],
        ),
      "reconcileProblems.resolve",
    );
  }

  return result;
}

/** Called only after an email was accepted by the SMTP server. */
export async function markNotified(fingerprints: string[]): Promise<void> {
  if (fingerprints.length === 0) {
    return;
  }
  await withRetry(
    () =>
      pool.query(
        `update alert_state
            set last_notified_at = now(), notify_count = notify_count + 1
          where fingerprint = any($1)`,
        [fingerprints],
      ),
    "markNotified",
  );
}
