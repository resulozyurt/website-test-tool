/**
 * Read-only data access for the dashboard. Every query is a plain SELECT and
 * goes through readQuery (which rejects non-SELECT statements). Rows are mapped
 * into camelCase view models with numeric coercion, since pg returns count()
 * as a string and numeric columns as strings.
 */

import { readQuery } from "./db";
import type {
  CheckStatus,
  CheckType,
  CountryCode,
  EnvironmentKey,
  LanguageCode,
  RunStatus,
  Severity,
  SweepStatus,
  SweepTrigger,
} from "./types";

/* -------------------------------------------------------------------------- */
/* View models                                                                */
/* -------------------------------------------------------------------------- */

export interface MatrixCell {
  country: CountryCode;
  pageKey: string;
  status: RunStatus;
}

export interface SweepListItem {
  id: number;
  trigger: SweepTrigger;
  status: SweepStatus;
  startedAt: Date;
  finishedAt: Date | null;
  environmentKey: EnvironmentKey;
  runCount: number;
  passCount: number;
  warnCount: number;
  failCount: number;
  cells: MatrixCell[];
}

export interface SweepHeader {
  id: number;
  trigger: SweepTrigger;
  status: SweepStatus;
  startedAt: Date;
  finishedAt: Date | null;
  environmentKey: EnvironmentKey;
}

export interface CheckView {
  id: number;
  runId: number;
  type: CheckType;
  severity: Severity;
  status: CheckStatus;
  expected: string | null;
  actual: string | null;
  message: string;
}

export interface AiVerdictView {
  id: number;
  runId: number;
  model: string;
  verdict: string;
  confidence: number | null;
  costUsd: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface RunView {
  id: number;
  country: CountryCode;
  language: LanguageCode;
  pageKey: string;
  status: RunStatus;
  httpStatus: number | null;
  kinstaCache: string | null;
  cfCacheStatus: string | null;
  exitCountry: string | null;
  exitIp: string | null;
  contentLanguage: string | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/* -------------------------------------------------------------------------- */
/* Internal row shapes                                                        */
/* -------------------------------------------------------------------------- */

interface SweepRow {
  id: number;
  trigger: SweepTrigger;
  status: SweepStatus;
  startedAt: Date;
  finishedAt: Date | null;
  environmentKey: EnvironmentKey;
  runCount: string;
  passCount: string;
  warnCount: string;
  failCount: string;
}

interface CellRow {
  sweepId: number;
  country: CountryCode;
  pageKey: string;
  status: RunStatus;
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isNaN(n) ? 0 : n;
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

/** Most recent sweeps with per-sweep run counts and a country×page matrix. */
export async function listSweeps(
  limit = 50,
  offset = 0,
): Promise<SweepListItem[]> {
  const sweepRows = await readQuery<SweepRow>(
    `select
       s.id,
       s.trigger,
       s.status,
       s.started_at  as "startedAt",
       s.finished_at as "finishedAt",
       e.key         as "environmentKey",
       count(r.id)                                              as "runCount",
       count(*) filter (where r.status = 'pass')                as "passCount",
       count(*) filter (where r.status = 'warn')                as "warnCount",
       count(*) filter (where r.status in ('fail', 'error'))    as "failCount"
     from sweeps s
     join environments e on e.id = s.environment_id
     left join runs r on r.sweep_id = s.id
     group by s.id, e.key
     order by s.started_at desc
     limit $1 offset $2`,
    [limit, offset],
  );

  if (sweepRows.length === 0) return [];

  const ids = sweepRows.map((row) => row.id);
  const cells = await runMatrixCells(ids);
  const byId = new Map<number, MatrixCell[]>();
  for (const c of cells) {
    const list = byId.get(c.sweepId) ?? [];
    list.push({ country: c.country, pageKey: c.pageKey, status: c.status });
    byId.set(c.sweepId, list);
  }

  return sweepRows.map((row) => ({
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    environmentKey: row.environmentKey,
    runCount: toNumber(row.runCount),
    passCount: toNumber(row.passCount),
    warnCount: toNumber(row.warnCount),
    failCount: toNumber(row.failCount),
    cells: byId.get(row.id) ?? [],
  }));
}

/** Flat country×page status cells for a set of sweeps (one query, no N+1). */
async function runMatrixCells(sweepIds: number[]): Promise<CellRow[]> {
  return readQuery<CellRow>(
    `select
       r.sweep_id      as "sweepId",
       m.country_code  as "country",
       p.page_key      as "pageKey",
       r.status        as "status"
     from runs r
     join markets m on m.id = r.market_id
     join pages   p on p.id = r.page_id
     where r.sweep_id = any($1)`,
    [sweepIds],
  );
}

export async function getSweep(id: number): Promise<SweepHeader | null> {
  const rows = await readQuery<SweepHeader>(
    `select
       s.id,
       s.trigger,
       s.status,
       s.started_at  as "startedAt",
       s.finished_at as "finishedAt",
       e.key         as "environmentKey"
     from sweeps s
     join environments e on e.id = s.environment_id
     where s.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getRunsBySweep(sweepId: number): Promise<RunView[]> {
  return readQuery<RunView>(
    `select
       r.id,
       m.country_code   as "country",
       m.language       as "language",
       p.page_key       as "pageKey",
       r.status,
       r.http_status    as "httpStatus",
       r.kinsta_cache   as "kinstaCache",
       r.cf_cache_status as "cfCacheStatus",
       r.exit_country   as "exitCountry",
       r.exit_ip        as "exitIp",
       r.content_language as "contentLanguage",
       r.error,
       r.started_at     as "startedAt",
       r.finished_at    as "finishedAt"
     from runs r
     join markets m on m.id = r.market_id
     join pages   p on p.id = r.page_id
     where r.sweep_id = $1
     order by m.country_code, p.page_key`,
    [sweepId],
  );
}

export async function getChecksForRuns(runIds: number[]): Promise<CheckView[]> {
  if (runIds.length === 0) return [];
  return readQuery<CheckView>(
    `select
       id,
       run_id as "runId",
       type,
       severity,
       status,
       expected,
       actual,
       message
     from checks
     where run_id = any($1)
     order by run_id, id`,
    [runIds],
  );
}

/** Latest AI verdict per run (advisory only; never gates a run). */
export async function getAiVerdictsForRuns(
  runIds: number[],
): Promise<AiVerdictView[]> {
  if (runIds.length === 0) return [];
  return readQuery<AiVerdictView>(
    `select distinct on (run_id)
       id,
       run_id        as "runId",
       model,
       verdict,
       confidence,
       cost_usd      as "costUsd",
       input_tokens  as "inputTokens",
       output_tokens as "outputTokens"
     from ai_verdicts
     where run_id = any($1)
     order by run_id, created_at desc`,
    [runIds],
  );
}
