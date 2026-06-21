/**
 * Page discovery CLI.
 *
 * Reads the live site's sitemap, classifies URLs (language + blog/system
 * exclusion), and upserts them into discovered_pages. Read-only against the
 * live site (a GET on the sitemap only); writes only to our own database.
 * Idempotent and transactional.
 *
 * This step does NOT change what the sweep tests yet -- it only builds the page
 * inventory. Turning discovered pages into logical test pages comes later.
 *
 * Usage: npm run discover   (or: npx tsx src/discovery/discover-cli.ts)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { closePool, pool } from "../db/client.js";
import { discover } from "./discover.js";
import { deactivateMissing, upsertDiscoveredPage } from "./store.js";

const OUTPUT_DIR = "discovery-output";

function countBy<T>(items: T[], key: (item: T) => string): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => `${k}:${n}`).join(", ") || "none";
}

async function main(): Promise<void> {
  const { usedSitemap, pages } = await discover();

  if (!usedSitemap || pages.length === 0) {
    console.error(
      "No sitemap reachable or no same-site URLs found. Tried the default candidates.",
    );
    console.error(
      "If your sitemap lives elsewhere, set SITEMAP_URL in .env and retry.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`sitemap: ${usedSitemap}`);
  console.log(`discovered ${pages.length} url(s)\n`);

  const client = await pool.connect();
  let created = 0;
  let updated = 0;
  try {
    await client.query("begin");
    for (const page of pages) {
      const outcome = await upsertDiscoveredPage(page, client);
      if (outcome === "created") {
        created += 1;
      } else {
        updated += 1;
      }
    }
    const deactivated = await deactivateMissing(
      pages.map((p) => p.url),
      client,
    );
    await client.query("commit");

    const testable = pages.filter((p) => !p.isExcluded);
    const excluded = pages.filter((p) => p.isExcluded);

    console.log(
      `testable: ${testable.length}  (${countBy(testable, (p) => p.language)})`,
    );
    console.log(
      `excluded: ${excluded.length}  (${countBy(excluded, (p) => p.excludeReason ?? "?")})`,
    );
    console.log(
      `db: created=${created} updated=${updated} deactivated=${deactivated}`,
    );

    await mkdir(OUTPUT_DIR, { recursive: true });
    const snapshot = {
      generatedAt: new Date().toISOString(),
      sitemap: usedSitemap,
      pages,
    };
    const out = join(OUTPUT_DIR, "pages.json");
    await writeFile(out, JSON.stringify(snapshot, null, 2), "utf8");
    console.log(`\nsnapshot -> ${out}`);
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error("discover failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
