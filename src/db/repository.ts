/**
 * Typed data-access layer (repository) over the Postgres schema defined in
 * migrations/0001_init.sql.
 *
 * Design notes:
 * - SELECT / RETURNING clauses alias snake_case columns to camelCase so the
 *   rest of the codebase stays in a single naming convention.
 * - Every function takes an optional `exec` (the pool by default). Passing a
 *   transaction client (from pool.connect()) runs the query inside that
 *   transaction; this is what the seed and, later, the sweep runner rely on.
 * - JSONB columns are written via JSON.stringify + an explicit ::jsonb cast so
 *   arrays are stored as JSON, not as Postgres array literals.
 */

import type { QueryResult, QueryResultRow } from "pg";
import { pool } from "./client.js";
import type {
  CheckResult,
  CheckStatus,
  CheckType,
  CountryCode,
  EnvironmentConfig,
  EnvironmentKey,
  ExpectationSet,
  LanguageCode,
  MarketConfig,
  PageConfig,
  RunStatus,
  Severity,
  SweepStatus,
  SweepTrigger,
} from "../types.js";

/** Anything that can run a parameterized query: the pool or a transaction client. */
export interface Executor {
  query<R extends QueryResultRow = any>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
}

/** Where an expectation row came from. Manual rows take priority over manifest. */
export type ExpectationSource = "manifest" | "manual";

/* -------------------------------------------------------------------------- */
/* Row types (camelCase mirror of the DB tables)                              */
/* -------------------------------------------------------------------------- */

export interface EnvironmentRow {
  id: number;
  key: EnvironmentKey;
  baseUrl: string;
  isActive: boolean;
  createdAt: Date;
}

export interface MarketRow {
  id: number;
  countryCode: CountryCode;
  language: LanguageCode;
  isActive: boolean;
  createdAt: Date;
}

export interface PageRow {
  id: number;
  pageKey: string;
  pathByLanguage: Partial<Record<LanguageCode, string>>;
  isActive: boolean;
  createdAt: Date;
}

export interface SweepRow {
  id: number;
  environmentId: number;
  trigger: SweepTrigger;
  status: SweepStatus;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface RunRow {
  id: number;
  sweepId: number;
  marketId: number;
  pageId: number;
  proxyCountry: string | null;
  exitIp: string | null;
  exitCountry: string | null;
  httpStatus: number | null;
  kinstaCache: string | null;
  cfCacheStatus: string | null;
  contentLanguage: string | null;
  status: RunStatus;
  screenshotKey: string | null;
  htmlKey: string | null;
  rawHeaders: unknown | null;
  consoleErrors: unknown | null;
  networkErrors: unknown | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface CheckRow {
  id: number;
  runId: number;
  type: CheckType;
  severity: Severity;
  status: CheckStatus;
  expected: string | null;
  actual: string | null;
  message: string;
  evidence: unknown | null;
  createdAt: Date;
}

export interface ExpectationRow {
  id: number;
  marketId: number;
  pageId: number;
  source: ExpectationSource;
  payload: ExpectationSet;
  checksum: string | null;
  updatedAt: Date;
}

/** The fields captured when a run (one market+page visit) finishes. */
export interface RunResultPatch {
  exitIp?: string | null;
  exitCountry?: string | null;
  httpStatus?: number | null;
  kinstaCache?: string | null;
  cfCacheStatus?: string | null;
  contentLanguage?: string | null;
  status: RunStatus;
  screenshotKey?: string | null;
  htmlKey?: string | null;
  rawHeaders?: unknown;
  consoleErrors?: unknown;
  networkErrors?: unknown;
  error?: string | null;
}

export interface CreateSweepInput {
  environmentId: number;
  trigger?: SweepTrigger;
  status?: SweepStatus;
}

export interface CreateRunInput {
  sweepId: number;
  marketId: number;
  pageId: number;
  proxyCountry?: string | null;
}

export interface UpsertExpectationInput {
  marketId: number;
  pageId: number;
  source: ExpectationSource;
  payload: ExpectationSet;
  checksum: string;
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* -------------------------------------------------------------------------- */

async function run<T>(
  exec: Executor,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await exec.query(text, params);
  return result.rows as T[];
}

async function runOne<T>(
  exec: Executor,
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await run<T>(exec, text, params);
  return rows[0] ?? null;
}

/** Serializes a value for a JSONB column, or returns null. */
function toJsonParam(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/* -------------------------------------------------------------------------- */
/* Column projections (snake_case -> camelCase)                               */
/* -------------------------------------------------------------------------- */

const ENV_COLS =
  'id, key, base_url as "baseUrl", is_active as "isActive", created_at as "createdAt"';

const MARKET_COLS =
  'id, country_code as "countryCode", language, is_active as "isActive", created_at as "createdAt"';

const PAGE_COLS =
  'id, page_key as "pageKey", path_by_language as "pathByLanguage", is_active as "isActive", created_at as "createdAt"';

const SWEEP_COLS =
  'id, environment_id as "environmentId", trigger, status, started_at as "startedAt", finished_at as "finishedAt"';

const RUN_COLS = [
  "id",
  'sweep_id as "sweepId"',
  'market_id as "marketId"',
  'page_id as "pageId"',
  'proxy_country as "proxyCountry"',
  'exit_ip as "exitIp"',
  'exit_country as "exitCountry"',
  'http_status as "httpStatus"',
  'kinsta_cache as "kinstaCache"',
  'cf_cache_status as "cfCacheStatus"',
  'content_language as "contentLanguage"',
  "status",
  'screenshot_key as "screenshotKey"',
  'html_key as "htmlKey"',
  'raw_headers as "rawHeaders"',
  'console_errors as "consoleErrors"',
  'network_errors as "networkErrors"',
  "error",
  'started_at as "startedAt"',
  'finished_at as "finishedAt"',
].join(", ");

const CHECK_COLS =
  'id, run_id as "runId", type, severity, status, expected, actual, message, evidence, created_at as "createdAt"';

const EXPECTATION_COLS =
  'id, market_id as "marketId", page_id as "pageId", source, payload, checksum, updated_at as "updatedAt"';

/* -------------------------------------------------------------------------- */
/* Environments                                                               */
/* -------------------------------------------------------------------------- */

export async function upsertEnvironment(
  input: EnvironmentConfig,
  exec: Executor = pool,
): Promise<EnvironmentRow> {
  const rows = await run<EnvironmentRow>(
    exec,
    `insert into environments (key, base_url, is_active)
     values ($1, $2, $3)
     on conflict (key) do update set
       base_url = excluded.base_url,
       is_active = excluded.is_active
     returning ${ENV_COLS}`,
    [input.key, input.baseUrl, input.isActive],
  );
  return rows[0];
}

export async function listEnvironments(
  activeOnly = false,
  exec: Executor = pool,
): Promise<EnvironmentRow[]> {
  return run<EnvironmentRow>(
    exec,
    `select ${ENV_COLS} from environments
     ${activeOnly ? "where is_active = true" : ""}
     order by id`,
  );
}

export async function getEnvironmentByKey(
  key: EnvironmentKey,
  exec: Executor = pool,
): Promise<EnvironmentRow | null> {
  return runOne<EnvironmentRow>(
    exec,
    `select ${ENV_COLS} from environments where key = $1`,
    [key],
  );
}

/* -------------------------------------------------------------------------- */
/* Markets                                                                    */
/* -------------------------------------------------------------------------- */

export async function upsertMarket(
  input: MarketConfig,
  exec: Executor = pool,
): Promise<MarketRow> {
  // Note: MarketConfig.proxyEnvKey is runtime-only and has no column here; it
  // is intentionally not persisted.
  const rows = await run<MarketRow>(
    exec,
    `insert into markets (country_code, language, is_active)
     values ($1, $2, $3)
     on conflict (country_code, language) do update set
       is_active = excluded.is_active
     returning ${MARKET_COLS}`,
    [input.country, input.language, input.isActive],
  );
  return rows[0];
}

export async function listMarkets(
  activeOnly = false,
  exec: Executor = pool,
): Promise<MarketRow[]> {
  return run<MarketRow>(
    exec,
    `select ${MARKET_COLS} from markets
     ${activeOnly ? "where is_active = true" : ""}
     order by id`,
  );
}

export async function getMarketByCountryLanguage(
  country: CountryCode,
  language: LanguageCode,
  exec: Executor = pool,
): Promise<MarketRow | null> {
  return runOne<MarketRow>(
    exec,
    `select ${MARKET_COLS} from markets
     where country_code = $1 and language = $2`,
    [country, language],
  );
}

/* -------------------------------------------------------------------------- */
/* Pages                                                                      */
/* -------------------------------------------------------------------------- */

export async function upsertPage(
  input: PageConfig,
  exec: Executor = pool,
): Promise<PageRow> {
  const rows = await run<PageRow>(
    exec,
    `insert into pages (page_key, path_by_language, is_active)
     values ($1, $2::jsonb, $3)
     on conflict (page_key) do update set
       path_by_language = excluded.path_by_language,
       is_active = excluded.is_active
     returning ${PAGE_COLS}`,
    [input.key, toJsonParam(input.pathByLanguage), input.isActive],
  );
  return rows[0];
}

export async function listPages(
  activeOnly = false,
  exec: Executor = pool,
): Promise<PageRow[]> {
  return run<PageRow>(
    exec,
    `select ${PAGE_COLS} from pages
     ${activeOnly ? "where is_active = true" : ""}
     order by id`,
  );
}

export async function getPageByKey(
  pageKey: string,
  exec: Executor = pool,
): Promise<PageRow | null> {
  return runOne<PageRow>(
    exec,
    `select ${PAGE_COLS} from pages where page_key = $1`,
    [pageKey],
  );
}

/* -------------------------------------------------------------------------- */
/* Sweeps                                                                     */
/* -------------------------------------------------------------------------- */

export async function createSweep(
  input: CreateSweepInput,
  exec: Executor = pool,
): Promise<SweepRow> {
  const rows = await run<SweepRow>(
    exec,
    `insert into sweeps (environment_id, trigger, status)
     values ($1, coalesce($2, 'cron'), coalesce($3, 'running'))
     returning ${SWEEP_COLS}`,
    [input.environmentId, input.trigger ?? null, input.status ?? null],
  );
  return rows[0];
}

export async function finishSweep(
  id: number,
  status: SweepStatus,
  exec: Executor = pool,
): Promise<SweepRow | null> {
  return runOne<SweepRow>(
    exec,
    `update sweeps set status = $2, finished_at = now()
     where id = $1
     returning ${SWEEP_COLS}`,
    [id, status],
  );
}

export async function getSweepById(
  id: number,
  exec: Executor = pool,
): Promise<SweepRow | null> {
  return runOne<SweepRow>(
    exec,
    `select ${SWEEP_COLS} from sweeps where id = $1`,
    [id],
  );
}

/* -------------------------------------------------------------------------- */
/* Runs                                                                       */
/* -------------------------------------------------------------------------- */

export async function createRun(
  input: CreateRunInput,
  exec: Executor = pool,
): Promise<RunRow> {
  // status defaults to 'error' in the schema, so a run that crashes before
  // finishRun() is reached stays marked as an error rather than a false pass.
  const rows = await run<RunRow>(
    exec,
    `insert into runs (sweep_id, market_id, page_id, proxy_country)
     values ($1, $2, $3, $4)
     returning ${RUN_COLS}`,
    [input.sweepId, input.marketId, input.pageId, input.proxyCountry ?? null],
  );
  return rows[0];
}

export async function finishRun(
  id: number,
  patch: RunResultPatch,
  exec: Executor = pool,
): Promise<RunRow | null> {
  return runOne<RunRow>(
    exec,
    `update runs set
       exit_ip = $2,
       exit_country = $3,
       http_status = $4,
       kinsta_cache = $5,
       cf_cache_status = $6,
       content_language = $7,
       status = $8,
       screenshot_key = $9,
       html_key = $10,
       raw_headers = $11::jsonb,
       console_errors = $12::jsonb,
       network_errors = $13::jsonb,
       error = $14,
       finished_at = now()
     where id = $1
     returning ${RUN_COLS}`,
    [
      id,
      patch.exitIp ?? null,
      patch.exitCountry ?? null,
      patch.httpStatus ?? null,
      patch.kinstaCache ?? null,
      patch.cfCacheStatus ?? null,
      patch.contentLanguage ?? null,
      patch.status,
      patch.screenshotKey ?? null,
      patch.htmlKey ?? null,
      toJsonParam(patch.rawHeaders),
      toJsonParam(patch.consoleErrors),
      toJsonParam(patch.networkErrors),
      patch.error ?? null,
    ],
  );
}

export async function listRunsBySweep(
  sweepId: number,
  exec: Executor = pool,
): Promise<RunRow[]> {
  return run<RunRow>(
    exec,
    `select ${RUN_COLS} from runs where sweep_id = $1 order by id`,
    [sweepId],
  );
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

export async function insertCheck(
  runId: number,
  result: CheckResult,
  evidence: unknown = null,
  exec: Executor = pool,
): Promise<CheckRow> {
  const rows = await run<CheckRow>(
    exec,
    `insert into checks
       (run_id, type, severity, status, expected, actual, message, evidence)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     returning ${CHECK_COLS}`,
    [
      runId,
      result.type,
      result.severity,
      result.status,
      result.expected,
      result.actual,
      result.message,
      toJsonParam(evidence),
    ],
  );
  return rows[0];
}

export async function insertChecks(
  runId: number,
  results: CheckResult[],
  exec: Executor = pool,
): Promise<CheckRow[]> {
  const out: CheckRow[] = [];
  for (const result of results) {
    out.push(await insertCheck(runId, result, null, exec));
  }
  return out;
}

export async function listChecksByRun(
  runId: number,
  exec: Executor = pool,
): Promise<CheckRow[]> {
  return run<CheckRow>(
    exec,
    `select ${CHECK_COLS} from checks where run_id = $1 order by id`,
    [runId],
  );
}

/* -------------------------------------------------------------------------- */
/* Expectations                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Upserts the expectation for a market+page (unique key). The `source` column
 * records the origin ('manifest' | 'manual'); callers are responsible for the
 * priority policy (the manifest sync never overwrites a 'manual' row).
 */
export async function upsertExpectation(
  input: UpsertExpectationInput,
  exec: Executor = pool,
): Promise<ExpectationRow> {
  const rows = await run<ExpectationRow>(
    exec,
    `insert into expectations (market_id, page_id, source, payload, checksum)
     values ($1, $2, $3, $4::jsonb, $5)
     on conflict (market_id, page_id) do update set
       source = excluded.source,
       payload = excluded.payload,
       checksum = excluded.checksum,
       updated_at = now()
     returning ${EXPECTATION_COLS}`,
    [
      input.marketId,
      input.pageId,
      input.source,
      toJsonParam(input.payload),
      input.checksum,
    ],
  );
  return rows[0];
}

export async function listExpectations(
  exec: Executor = pool,
): Promise<ExpectationRow[]> {
  return run<ExpectationRow>(
    exec,
    `select ${EXPECTATION_COLS} from expectations order by id`,
  );
}

export async function getExpectationByMarketPage(
  marketId: number,
  pageId: number,
  exec: Executor = pool,
): Promise<ExpectationRow | null> {
  return runOne<ExpectationRow>(
    exec,
    `select ${EXPECTATION_COLS} from expectations
     where market_id = $1 and page_id = $2`,
    [marketId, pageId],
  );
}