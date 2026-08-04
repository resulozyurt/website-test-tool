/**
 * Bulk scenario generation (library form).
 *
 * For every eligible discovered page (active, non-blog, with an active market
 * for its language), fetches the page inventory and (re)writes its per-country
 * scenarios; each page is reconciled so disappearing scenarios are deactivated.
 * Read-only against the live site (inventory endpoint only); writes only to our
 * own database.
 *
 * The CLI (generate-all-cli.ts) and the autopilot orchestrator both call
 * `generateAllScenarios`, so the site-wide geo-leak coverage lives in one place.
 */

import { pool } from "../db/client.js";
import { ManifestError } from "../manifest/client.js";
import { fetchInventory } from "../manifest/inventory.js";
import { countriesForLanguage, generateScenarios } from "./generate.js";
import {
  listEligibleDiscoveredPages,
  markInventoryStatus,
  replacePageScenarios,
  type EligiblePage,
} from "./store.js";

const DEFAULT_CONCURRENCY = 4;

export interface ScenarioTotals {
  eligible: number;
  processed: number;
  skipped: number;
  noBricks: number;
  failed: number;
  created: number;
  updated: number;
  deactivated: number;
  errors: string[];
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) {
          break;
        }
        await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
}

async function processPage(
  page: EligiblePage,
  totals: ScenarioTotals,
): Promise<void> {
  if (countriesForLanguage(page.language).length === 0) {
    totals.skipped += 1;
    return;
  }

  let inventory;
  try {
    inventory = await fetchInventory({ url: page.url, fresh: false });
  } catch (err) {
    if (
      err instanceof ManifestError &&
      (err.status === 400 || err.status === 404 || err.status === 422)
    ) {
      // No per-post Bricks content (template-driven CPT or not a single post).
      // Mark it so future runs skip it automatically.
      await markInventoryStatus(page.url, false);
      totals.noBricks += 1;
      return;
    }
    totals.failed += 1;
    totals.errors.push(
      `${page.url}: ${err instanceof ManifestError ? err.message : String(err)}`,
    );
    return;
  }

  const scenarios = generateScenarios(inventory);

  const client = await pool.connect();
  try {
    await client.query("begin");
    const counts = await replacePageScenarios(
      {
        postId: inventory.page.post_id,
        url: inventory.page.url,
        language: inventory.page.language ?? page.language,
        slug: inventory.page.slug,
      },
      scenarios,
      client,
    );
    await markInventoryStatus(page.url, true, client);
    await client.query("commit");
    totals.created += counts.created;
    totals.updated += counts.updated;
    totals.deactivated += counts.deactivated;
    totals.processed += 1;
    if (totals.processed % 20 === 0) {
      console.log(
        `  ... ${totals.processed} pages, ${totals.created + totals.updated} scenarios`,
      );
    }
  } catch (err) {
    await client.query("rollback");
    totals.failed += 1;
    totals.errors.push(`${page.url}: db ${String(err)}`);
  } finally {
    client.release();
  }
}

/**
 * Generates per-country scenarios for every eligible discovered page. Returns
 * the totals; does not close the pool (the caller owns its lifecycle).
 */
export async function generateAllScenarios(
  concurrency = DEFAULT_CONCURRENCY,
): Promise<ScenarioTotals> {
  const pages = await listEligibleDiscoveredPages();
  const totals: ScenarioTotals = {
    eligible: pages.length,
    processed: 0,
    skipped: 0,
    noBricks: 0,
    failed: 0,
    created: 0,
    updated: 0,
    deactivated: 0,
    errors: [],
  };

  await mapLimit(pages, concurrency, (p) => processPage(p, totals));
  return totals;
}
