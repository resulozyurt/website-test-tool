/**
 * Persistence for generated scenarios. Self-contained (pool or transaction
 * client). Each page is reconciled on write: scenarios that no longer appear in
 * the freshly generated set for that page are marked inactive (kept for
 * history), never deleted.
 */

import type { QueryResult, QueryResultRow } from "pg";
import { pool } from "../db/client.js";
import { checksumOf } from "../manifest/checksum.js";
import type { Scenario } from "./generate.js";

export interface Executor {
  query<R extends QueryResultRow = any>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
}

export interface EligiblePage {
  url: string;
  language: string;
  slug: string | null;
}

/**
 * Active, non-blog discovered pages that are not already known to lack Bricks
 * content (has_inventory IS NOT false). Ordered for stable progress output.
 */
export async function listEligibleDiscoveredPages(
  exec: Executor = pool,
): Promise<EligiblePage[]> {
  const res = await exec.query<EligiblePage>(
    `select url, language, slug
       from discovered_pages
      where is_active = true
        and is_excluded = false
        and has_inventory is distinct from false
      order by language, url`,
  );
  return res.rows;
}

/** Records whether a discovered page has its own Bricks content. */
export async function markInventoryStatus(
  url: string,
  hasInventory: boolean,
  exec: Executor = pool,
): Promise<void> {
  await exec.query(
    `update discovered_pages set has_inventory = $2 where url = $1`,
    [url, hasInventory],
  );
}

export interface PageMeta {
  postId: number;
  url: string;
  language: string;
  slug: string | null;
}

export interface ReplaceCounts {
  created: number;
  updated: number;
  deactivated: number;
}

/** Upserts a page's scenarios and deactivates the ones that disappeared. */
export async function replacePageScenarios(
  page: PageMeta,
  scenarios: Scenario[],
  exec: Executor = pool,
): Promise<ReplaceCounts> {
  let created = 0;
  let updated = 0;

  for (const s of scenarios) {
    const checksum = checksumOf({
      selector: s.selector,
      expectation: s.expectation,
      rule: s.rule,
      kind: s.kind,
      label: s.label,
      inherited: s.inherited,
      moneyCritical: s.moneyCritical,
    });
    const res = await exec.query<{ inserted: boolean }>(
      `insert into scenarios
         (page_post_id, page_url, language, page_slug, country, element_id, selector,
          kind, label, expectation, rule, inherited, is_money_critical, gating, active, checksum, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, true, $14, now())
       on conflict (page_post_id, country, element_id, expectation) do update set
         page_url          = excluded.page_url,
         language          = excluded.language,
         page_slug         = excluded.page_slug,
         selector          = excluded.selector,
         kind              = excluded.kind,
         label             = excluded.label,
         rule              = excluded.rule,
         inherited         = excluded.inherited,
         is_money_critical = excluded.is_money_critical,
         gating            = excluded.gating,
         active            = true,
         checksum          = excluded.checksum,
         updated_at        = now()
       returning (xmax = 0) as inserted`,
      [
        page.postId,
        page.url,
        page.language,
        page.slug,
        s.country,
        s.elementId,
        s.selector,
        s.kind,
        s.label,
        s.expectation,
        s.rule,
        s.inherited,
        s.moneyCritical,
        checksum,
      ],
    );
    if (res.rows[0]?.inserted) {
      created += 1;
    } else {
      updated += 1;
    }
  }

  const keys = scenarios.map(
    (s) => `${s.country}|${s.elementId}|${s.expectation}`,
  );
  const del = await exec.query(
    `update scenarios set active = false, updated_at = now()
      where page_post_id = $1 and active = true
        and (country || '|' || element_id || '|' || expectation) <> all($2::text[])`,
    [page.postId, keys],
  );

  return { created, updated, deactivated: del.rowCount ?? 0 };
}

/* -------------------------------------------------------------------------- */
/* Read helpers for reconciliation and the runner                             */
/* -------------------------------------------------------------------------- */

export interface ScenarioPageRow {
  pagePostId: number;
  pageUrl: string;
  language: string;
  pageSlug: string | null;
}

/** Distinct pages that currently have at least one active scenario. */
export async function listScenarioPages(
  exec: Executor = pool,
): Promise<ScenarioPageRow[]> {
  const res = await exec.query<ScenarioPageRow>(
    `select distinct
       page_post_id as "pagePostId",
       page_url     as "pageUrl",
       language,
       page_slug    as "pageSlug"
     from scenarios
     where active = true
     order by page_url`,
  );
  return res.rows;
}

export interface ScenarioRow {
  country: string;
  pageUrl: string;
  elementId: string;
  selector: string;
  kind: string;
  label: string | null;
  expectation: string; // 'present' | 'absent'
  rule: string;
  isMoneyCritical: boolean;
  gating: boolean;
}

/** All active scenarios, for the runner to verify in the live DOM. */
export async function listActiveScenarios(
  exec: Executor = pool,
): Promise<ScenarioRow[]> {
  const res = await exec.query<ScenarioRow>(
    `select
       country,
       page_url          as "pageUrl",
       element_id        as "elementId",
       selector,
       kind,
       label,
       expectation,
       rule,
       is_money_critical as "isMoneyCritical",
       gating
     from scenarios
     where active = true`,
  );
  return res.rows;
}
