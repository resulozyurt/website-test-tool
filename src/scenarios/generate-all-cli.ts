/**
 * Bulk scenario generation. For every eligible discovered page (active,
 * non-blog, with an active market for its language), fetches the page inventory
 * and (re)writes its per-country scenarios. Each page is reconciled, so
 * disappearing scenarios are deactivated.
 *
 * Read-only against the live site (inventory endpoint only); writes only to our
 * own database. Run after `npm run discover`.
 *
 * Usage: npm run scenarios:gen
 */

import { closePool, pool } from "../db/client.js";
import { ManifestError } from "../manifest/client.js";
import { fetchInventory } from "../manifest/inventory.js";
import { countriesForLanguage, generateScenarios } from "./generate.js";
import {
  listEligibleDiscoveredPages,
  markInventoryStatus,
  replacePageScenarios,
  type EligiblePage,
} from "./store.js";

const CONCURRENCY = 4;

interface Totals {
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

async function processPage(page: EligiblePage, totals: Totals): Promise<void> {
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

async function main(): Promise<void> {
  const pages = await listEligibleDiscoveredPages();
  console.log(
    `eligible pages: ${pages.length} (run "npm run discover" first if this looks low)\n`,
  );

  const totals: Totals = {
    processed: 0,
    skipped: 0,
    noBricks: 0,
    failed: 0,
    created: 0,
    updated: 0,
    deactivated: 0,
    errors: [],
  };

  await mapLimit(pages, CONCURRENCY, (p) => processPage(p, totals));

  console.log(
    `\nprocessed=${totals.processed} skipped(no market)=${totals.skipped} ` +
      `no-bricks=${totals.noBricks} failed=${totals.failed}`,
  );
  console.log(
    `scenarios: created=${totals.created} updated=${totals.updated} deactivated=${totals.deactivated}`,
  );
  if (totals.errors.length > 0) {
    console.log(`\nfirst errors:`);
    for (const e of totals.errors.slice(0, 10)) {
      console.log(`  - ${e}`);
    }
  }
}

main()
  .catch((err) => {
    console.error("scenarios:gen failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
