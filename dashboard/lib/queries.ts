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
  HealthCategory,
  HealthFindingSource,
  HealthPageStatus,
  HealthRunStatus,
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

/* -------------------------------------------------------------------------- */
/* Health crawl lane (migration 0005)                                         */
/* -------------------------------------------------------------------------- */

/** One health run (a full-site crawl for one country), with page counts. */
export interface HealthRunView {
  id: number;
  country: CountryCode;
  trigger: SweepTrigger;
  aiEnabled: boolean;
  status: HealthRunStatus;
  pagesTotal: number;
  pagesOk: number;
  pagesWarn: number;
  pagesFail: number;
  startedAt: Date;
  finishedAt: Date | null;
}

/** The latest health run for a country, for the overview cards. */
export interface CountryHealthView {
  country: CountryCode;
  runId: number;
  status: HealthRunStatus;
  pagesTotal: number;
  pagesOk: number;
  pagesWarn: number;
  pagesFail: number;
  startedAt: Date;
  finishedAt: Date | null;
}

interface HealthRunRow {
  id: number;
  country: CountryCode;
  trigger: SweepTrigger;
  aiEnabled: boolean;
  status: HealthRunStatus;
  pagesTotal: string;
  pagesOk: string;
  pagesWarn: string;
  pagesFail: string;
  startedAt: Date;
  finishedAt: Date | null;
}

function toRunView(row: HealthRunRow): HealthRunView {
  return {
    id: row.id,
    country: row.country,
    trigger: row.trigger,
    aiEnabled: row.aiEnabled,
    status: row.status,
    pagesTotal: toNumber(row.pagesTotal),
    pagesOk: toNumber(row.pagesOk),
    pagesWarn: toNumber(row.pagesWarn),
    pagesFail: toNumber(row.pagesFail),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

/** Most recent health runs across all countries. */
export async function listHealthRuns(limit = 25): Promise<HealthRunView[]> {
  const rows = await readQuery<HealthRunRow>(
    `select
       id,
       country,
       trigger,
       ai_enabled   as "aiEnabled",
       status,
       pages_total  as "pagesTotal",
       pages_ok     as "pagesOk",
       pages_warn   as "pagesWarn",
       pages_fail   as "pagesFail",
       started_at   as "startedAt",
       finished_at  as "finishedAt"
     from health_runs
     order by started_at desc
     limit $1`,
    [limit],
  );
  return rows.map(toRunView);
}

/**
 * The latest *completed* run per country (for the overview cards).
 *
 * Runs still in 'running' are excluded on purpose: a crashed crawl stays in
 * 'running' with zero page counts, and a card fed that row would render a
 * healthy-looking "0/0 pass". The cards must always show the last run that
 * actually produced a result.
 */
export async function latestHealthByCountry(): Promise<CountryHealthView[]> {
  const rows = await readQuery<HealthRunRow>(
    `select distinct on (country)
       id,
       country,
       trigger,
       ai_enabled   as "aiEnabled",
       status,
       pages_total  as "pagesTotal",
       pages_ok     as "pagesOk",
       pages_warn   as "pagesWarn",
       pages_fail   as "pagesFail",
       started_at   as "startedAt",
       finished_at  as "finishedAt"
     from health_runs
     where status <> 'running'
     order by country, started_at desc`,
  );
  return rows.map((row) => {
    const v = toRunView(row);
    return {
      country: v.country,
      runId: v.id,
      status: v.status,
      pagesTotal: v.pagesTotal,
      pagesOk: v.pagesOk,
      pagesWarn: v.pagesWarn,
      pagesFail: v.pagesFail,
      startedAt: v.startedAt,
      finishedAt: v.finishedAt,
    };
  });
}

/** A single page inspected within a health run. */
export interface HealthPageView {
  id: number;
  runId: number;
  url: string;
  path: string | null;
  language: string | null;
  country: CountryCode;
  httpStatus: number | null;
  blank: boolean;
  cacheBucket: string | null;
  siteCountry: string | null;
  status: HealthPageStatus;
  durationMs: number | null;
}

/** One health run header by id (null when it does not exist). */
export async function getHealthRun(id: number): Promise<HealthRunView | null> {
  const rows = await readQuery<HealthRunRow>(
    `select
       id,
       country,
       trigger,
       ai_enabled   as "aiEnabled",
       status,
       pages_total  as "pagesTotal",
       pages_ok     as "pagesOk",
       pages_warn   as "pagesWarn",
       pages_fail   as "pagesFail",
       started_at   as "startedAt",
       finished_at  as "finishedAt"
     from health_runs
     where id = $1`,
    [id],
  );
  return rows[0] ? toRunView(rows[0]) : null;
}

/** All pages for a health run, worst-status first. */
export async function getHealthPages(runId: number): Promise<HealthPageView[]> {
  return readQuery<HealthPageView>(
    `select
       id,
       run_id       as "runId",
       url,
       path,
       language,
       country,
       http_status  as "httpStatus",
       blank,
       cache_bucket as "cacheBucket",
       site_country as "siteCountry",
       status,
       duration_ms  as "durationMs"
     from health_pages
     where run_id = $1
     order by
       case status
         when 'error' then 0
         when 'fail'  then 1
         when 'warn'  then 2
         else 3
       end,
       path`,
    [runId],
  );
}

/* -------------------------------------------------------------------------- */
/* Health crawl lane — H6.2 additions (findings, trend, distribution)         */
/*                                                                            */
/* All read-only SELECTs, same as everything above: they go through           */
/* readQuery, coerce count() to a number, and alias snake_case to camelCase.  */
/* No schema changes; these only read migration-0005 tables.                  */
/* -------------------------------------------------------------------------- */

/**
 * One deterministic/AI finding attached to a page inside a health run.
 * `detail` is the raw jsonb column (already parsed by pg into a JS value);
 * the UI renders it inside a collapsed <details> block, so we keep it opaque.
 */
export interface HealthFindingView {
  id: number;
  pageId: number;
  path: string | null;
  category: HealthCategory;
  type: string;
  severity: Severity;
  source: HealthFindingSource;
  message: string;
  detail: unknown;
}

/** A single point on the pass-rate trend: one finished health run. */
export interface HealthTrendPoint {
  runId: number;
  country: CountryCode;
  startedAt: Date;
  pagesTotal: number;
  pagesOk: number;
  /** Whole-percent pass rate (0..100), or null when the run had no pages. */
  passRate: number | null;
}

/** Aggregated finding count, grouped by severity + category + type. */
export interface HealthDistributionRow {
  severity: Severity;
  category: HealthCategory;
  type: string;
  count: number;
}

interface HealthFindingRow {
  id: number;
  pageId: number;
  path: string | null;
  category: HealthCategory;
  type: string;
  severity: Severity;
  source: HealthFindingSource;
  message: string;
  detail: unknown;
}

interface HealthTrendRow {
  runId: number;
  country: CountryCode;
  startedAt: Date;
  pagesTotal: string;
  pagesOk: string;
}

interface HealthDistributionQueryRow {
  severity: Severity;
  category: HealthCategory;
  type: string;
  count: string;
}

/**
 * All findings for a health run, joined to their page for path/ordering.
 * Ordered by page path, then worst severity first, so the detail page can
 * group by page and keep gating findings (critical/major) above minor ones.
 */
export async function getHealthFindings(
  runId: number,
): Promise<HealthFindingView[]> {
  const rows = await readQuery<HealthFindingRow>(
    `select
       f.id,
       f.page_id   as "pageId",
       hp.path,
       f.category,
       f.type,
       f.severity,
       f.source,
       f.message,
       f.detail
     from health_findings f
     join health_pages hp on hp.id = f.page_id
     where hp.run_id = $1
     order by
       hp.path nulls first,
       case f.severity
         when 'critical' then 0
         when 'major'    then 1
         else 2
       end,
       f.id`,
    [runId],
  );
  return rows.map((row) => ({
    id: row.id,
    pageId: row.pageId,
    path: row.path,
    category: row.category,
    type: row.type,
    severity: row.severity,
    source: row.source,
    message: row.message,
    detail: row.detail,
  }));
}

/**
 * Pass-rate trend for the last `limit` finished health runs, returned in
 * chronological (oldest-first) order so a time axis reads left-to-right.
 * Running crawls are excluded because their page counts are still moving and
 * would show a misleading dip.
 */
export async function healthRunTrend(limit = 12): Promise<HealthTrendPoint[]> {
  const rows = await readQuery<HealthTrendRow>(
    `select
       id           as "runId",
       country,
       started_at   as "startedAt",
       pages_total  as "pagesTotal",
       pages_ok     as "pagesOk"
     from health_runs
     where status <> 'running'
     order by started_at desc
     limit $1`,
    [limit],
  );

  return rows
    .map((row) => {
      const pagesTotal = toNumber(row.pagesTotal);
      const pagesOk = toNumber(row.pagesOk);
      const passRate =
        pagesTotal > 0 ? Math.round((pagesOk / pagesTotal) * 100) : null;
      return {
        runId: row.runId,
        country: row.country,
        startedAt: row.startedAt,
        pagesTotal,
        pagesOk,
        passRate,
      };
    })
    .reverse();
}

/**
 * Finding counts across a set of health runs, grouped by severity, category,
 * and type. Used for the overview distribution chart (typically fed the latest
 * run id per country). Returns [] for an empty id list without hitting the DB.
 */
export async function healthFindingDistribution(
  runIds: number[],
): Promise<HealthDistributionRow[]> {
  if (runIds.length === 0) return [];
  const rows = await readQuery<HealthDistributionQueryRow>(
    `select
       f.severity,
       f.category,
       f.type,
       count(*) as "count"
     from health_findings f
     join health_pages hp on hp.id = f.page_id
     where hp.run_id = any($1)
     group by f.severity, f.category, f.type
     order by count(*) desc, f.severity, f.type`,
    [runIds],
  );
  return rows.map((row) => ({
    severity: row.severity,
    category: row.category,
    type: row.type,
    count: toNumber(row.count),
  }));
}