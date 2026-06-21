/**
 * Persistence for discovered pages. Self-contained (uses the shared pool or a
 * transaction client) so it does not touch the runner's repository layer.
 * Upserts are keyed on url; pages no longer present in the sitemap are flagged
 * inactive rather than deleted, so history is preserved.
 */

import type { QueryResult, QueryResultRow } from "pg";
import { pool } from "../db/client.js";
import type { DiscoveredPage } from "./discover.js";

/** The pool or a transaction client from pool.connect(). */
export interface Executor {
  query<R extends QueryResultRow = any>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
}

export type UpsertOutcome = "created" | "updated";

export async function upsertDiscoveredPage(
  page: DiscoveredPage,
  exec: Executor = pool,
): Promise<UpsertOutcome> {
  const res = await exec.query<{ inserted: boolean }>(
    `insert into discovered_pages
       (url, path, language, slug, source, is_excluded, exclude_reason, is_active, last_seen_at)
     values ($1, $2, $3, $4, $5, $6, $7, true, now())
     on conflict (url) do update set
       path           = excluded.path,
       language       = excluded.language,
       slug           = excluded.slug,
       source         = excluded.source,
       is_excluded    = excluded.is_excluded,
       exclude_reason = excluded.exclude_reason,
       is_active      = true,
       last_seen_at   = now()
     returning (xmax = 0) as inserted`,
    [
      page.url,
      page.path,
      page.language,
      page.slug,
      page.source,
      page.isExcluded,
      page.excludeReason,
    ],
  );
  return res.rows[0]?.inserted ? "created" : "updated";
}

/**
 * Marks any currently-active discovered page whose URL was not seen in this run
 * as inactive. A no-op when the seen list is empty, so a failed/empty discovery
 * never wipes the inventory.
 */
export async function deactivateMissing(
  seenUrls: string[],
  exec: Executor = pool,
): Promise<number> {
  if (seenUrls.length === 0) {
    return 0;
  }
  const res = await exec.query(
    `update discovered_pages
        set is_active = false
      where is_active = true
        and not (url = any($1))`,
    [seenUrls],
  );
  return res.rowCount ?? 0;
}
