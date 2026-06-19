/**
 * Manifest -> expectations sync.
 *
 * Turns the manifest-derived expectations (src/manifest/map.ts) into rows in
 * the `expectations` table, keyed by market+page, with source='manifest' and a
 * stable checksum. The sync is:
 *   - Idempotent: a row is written only when it is new or its checksum changed.
 *   - Non-destructive to human input: a row whose source is 'manual' is never
 *     overwritten (manual > manifest in priority); it is reported as skipped.
 *   - Read-only against the live site (the manifest endpoint only); the only
 *     writes are to our own database.
 *
 * Rows are resolved to market_id/page_id via the seeded markets/pages, so the
 * DB must be seeded first (`npm run seed`). A market or page that is not seeded
 * yet is reported as skipped rather than failing the whole run.
 */

import type { CountryCode, LanguageCode } from "../types.js";
import { pool } from "../db/client.js";
import {
  getExpectationByMarketPage,
  getMarketByCountryLanguage,
  getPageByKey,
  upsertExpectation,
  type Executor,
} from "../db/repository.js";
import { checksumOf } from "./checksum.js";
import { mapManifestToExpectations } from "./map.js";
import type { Manifest } from "./schema.js";

export type SyncOutcome = "created" | "updated" | "unchanged" | "skipped";

export interface SyncEntry {
  country: CountryCode;
  language: LanguageCode;
  pageKey: string;
  outcome: SyncOutcome;
  checksum: string | null;
  reason: string | null;
}

export interface SyncReport {
  entries: SyncEntry[];
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

/**
 * Derives expectations from the manifest and upserts them. Pass a transaction
 * client as `exec` to make the whole sync atomic (the CLI does this).
 */
export async function syncExpectations(
  manifest: Manifest,
  exec: Executor = pool,
): Promise<SyncReport> {
  const mapped = mapManifestToExpectations(manifest);
  const entries: SyncEntry[] = [];

  for (const m of mapped) {
    const checksum = checksumOf(m.expectation);
    const market = await getMarketByCountryLanguage(m.country, m.language, exec);
    const page = await getPageByKey(m.pageKey, exec);

    if (!market || !page) {
      entries.push({
        country: m.country,
        language: m.language,
        pageKey: m.pageKey,
        outcome: "skipped",
        checksum,
        reason: !market
          ? `market ${m.country}/${m.language} not seeded (run npm run seed)`
          : `page "${m.pageKey}" not seeded (run npm run seed)`,
      });
      continue;
    }

    const existing = await getExpectationByMarketPage(market.id, page.id, exec);

    // Never clobber a human override: manual > manifest.
    if (existing && existing.source === "manual") {
      entries.push({
        country: m.country,
        language: m.language,
        pageKey: m.pageKey,
        outcome: "skipped",
        checksum,
        reason: "manual override present; left untouched",
      });
      continue;
    }

    // Unchanged manifest row: skip the write.
    if (
      existing &&
      existing.source === "manifest" &&
      existing.checksum === checksum
    ) {
      entries.push({
        country: m.country,
        language: m.language,
        pageKey: m.pageKey,
        outcome: "unchanged",
        checksum,
        reason: null,
      });
      continue;
    }

    await upsertExpectation(
      {
        marketId: market.id,
        pageId: page.id,
        source: "manifest",
        payload: m.expectation,
        checksum,
      },
      exec,
    );

    entries.push({
      country: m.country,
      language: m.language,
      pageKey: m.pageKey,
      outcome: existing ? "updated" : "created",
      checksum,
      reason: null,
    });
  }

  const count = (outcome: SyncOutcome): number =>
    entries.filter((e) => e.outcome === outcome).length;

  return {
    entries,
    created: count("created"),
    updated: count("updated"),
    unchanged: count("unchanged"),
    skipped: count("skipped"),
  };
}