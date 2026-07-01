/**
 * Persistence for the health crawl. Self-contained (uses the shared pool or a
 * transaction client), so it does not touch the runner's repository layer or
 * the discovery store. Writes to the 0005 tables only.
 */

import type { QueryResult, QueryResultRow } from "pg";
import { pool } from "../db/client.js";
import type { CountryCode, LanguageCode } from "../types.js";

/** The pool or a transaction client from pool.connect(). */
export interface Executor {
  query<R extends QueryResultRow = any>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
}

export type HealthStatus = "pass" | "warn" | "fail" | "error";
export type HealthRunStatus = "running" | "pass" | "warn" | "fail";
export type FindingCategory = "technical" | "visual" | "functional" | "location";
export type FindingSeverity = "critical" | "major" | "minor";
export type FindingSource = "deterministic" | "ai";

/** A discovered page to crawl (active, not excluded), for one language. */
export interface CrawlPage {
  discoveredPageId: number;
  url: string;
  path: string;
  language: string;
  slug: string | null;
}

/**
 * Active, non-excluded discovered pages for a language, ordered by path so the
 * crawl is deterministic. `has_inventory` is intentionally ignored: template
 * pages still need health/visual/link checks. An optional limit acts as a
 * development safety valve.
 */
export async function listPagesToCrawl(
  language: LanguageCode,
  limit = 0,
  exec: Executor = pool,
): Promise<CrawlPage[]> {
  const params: unknown[] = [language];
  let sql = `select id, url, path, language, slug
               from discovered_pages
              where is_active = true
                and is_excluded = false
                and language = $1
              order by path asc`;
  if (limit > 0) {
    params.push(limit);
    sql += ` limit $2`;
  }
  const res = await exec.query<{
    id: number;
    url: string;
    path: string;
    language: string;
    slug: string | null;
  }>(sql, params);
  return res.rows.map((r) => ({
    discoveredPageId: r.id,
    url: r.url,
    path: r.path,
    language: r.language,
    slug: r.slug,
  }));
}

export interface HealthRunRow {
  id: number;
  country: string;
  status: HealthRunStatus;
}

export async function createHealthRun(
  input: { country: CountryCode; trigger: "manual" | "cron"; aiEnabled: boolean },
  exec: Executor = pool,
): Promise<HealthRunRow> {
  const res = await exec.query<HealthRunRow>(
    `insert into health_runs (country, trigger, ai_enabled, status)
     values ($1, $2, $3, 'running')
     returning id, country, status`,
    [input.country, input.trigger, input.aiEnabled],
  );
  return res.rows[0];
}

export async function finishHealthRun(
  runId: number,
  input: {
    status: HealthRunStatus;
    pagesTotal: number;
    pagesOk: number;
    pagesWarn: number;
    pagesFail: number;
  },
  exec: Executor = pool,
): Promise<void> {
  await exec.query(
    `update health_runs
        set status = $2,
            pages_total = $3,
            pages_ok = $4,
            pages_warn = $5,
            pages_fail = $6,
            finished_at = now()
      where id = $1`,
    [
      runId,
      input.status,
      input.pagesTotal,
      input.pagesOk,
      input.pagesWarn,
      input.pagesFail,
    ],
  );
}

export interface HealthPageInput {
  discoveredPageId: number | null;
  url: string;
  path: string | null;
  language: string | null;
  country: CountryCode;
  httpStatus: number | null;
  finalUrl: string | null;
  blank: boolean;
  cacheBucket: string | null;
  siteCountry: string | null;
  consoleErrors: unknown | null;
  networkErrors: unknown | null;
  brokenImages: unknown | null;
  brokenLinks: unknown | null;
  aiVerdict: string | null;
  aiNotes: string | null;
  aiCostUsd: number | null;
  screenshotKey: string | null;
  status: HealthStatus;
  error: string | null;
  durationMs: number | null;
}

/** Inserts one crawled page result and returns its id (for findings). */
export async function insertHealthPage(
  runId: number,
  input: HealthPageInput,
  exec: Executor = pool,
): Promise<number> {
  const res = await exec.query<{ id: number }>(
    `insert into health_pages
       (run_id, discovered_page_id, url, path, language, country, http_status,
        final_url, blank, cache_bucket, site_country, console_errors,
        network_errors, broken_images, broken_links, ai_verdict, ai_notes,
        ai_cost_usd, screenshot_key, status, error, duration_ms)
     values
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22)
     returning id`,
    [
      runId,
      input.discoveredPageId,
      input.url,
      input.path,
      input.language,
      input.country,
      input.httpStatus,
      input.finalUrl,
      input.blank,
      input.cacheBucket,
      input.siteCountry,
      input.consoleErrors === null ? null : JSON.stringify(input.consoleErrors),
      input.networkErrors === null ? null : JSON.stringify(input.networkErrors),
      input.brokenImages === null ? null : JSON.stringify(input.brokenImages),
      input.brokenLinks === null ? null : JSON.stringify(input.brokenLinks),
      input.aiVerdict,
      input.aiNotes,
      input.aiCostUsd,
      input.screenshotKey,
      input.status,
      input.error,
      input.durationMs,
    ],
  );
  return res.rows[0].id;
}

export interface HealthFindingInput {
  category: FindingCategory;
  type: string;
  severity: FindingSeverity;
  source: FindingSource;
  message: string;
  detail?: unknown;
}

export async function insertHealthFinding(
  pageId: number,
  input: HealthFindingInput,
  exec: Executor = pool,
): Promise<void> {
  await exec.query(
    `insert into health_findings
       (page_id, category, type, severity, source, message, detail)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      pageId,
      input.category,
      input.type,
      input.severity,
      input.source,
      input.message,
      input.detail === undefined || input.detail === null
        ? null
        : JSON.stringify(input.detail),
    ],
  );
}