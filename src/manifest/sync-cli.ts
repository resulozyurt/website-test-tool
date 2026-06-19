/**
 * Manifest -> expectations sync CLI.
 *
 * Fetches the live manifest, derives expectations, and upserts them into the
 * `expectations` table as source='manifest' (+ checksum). Idempotent: a row is
 * written only when new or changed; manual overrides are never clobbered.
 * Read-only against the live site (manifest endpoint only); writes only to our
 * own database. The whole sync runs inside a single transaction.
 *
 * Prerequisite: run `npm run seed` first so markets/pages exist to resolve
 * against (e.g. the newly activated pricing page).
 *
 * Usage: npm run manifest:sync
 */

import { fetchManifest, manifestUrl, ManifestError } from "./client.js";
import { syncExpectations, type SyncReport } from "./sync.js";
import { closePool, pool } from "../db/client.js";

function printReport(report: SyncReport): void {
  console.log("\n=== manifest -> expectations sync ===\n");
  for (const e of report.entries) {
    const tail = e.reason ? `  (${e.reason})` : ` [${e.checksum}]`;
    console.log(`  ${e.country}/${e.language} ${e.pageKey} -> ${e.outcome}${tail}`);
  }
  console.log(
    `\ncreated=${report.created} updated=${report.updated} ` +
      `unchanged=${report.unchanged} skipped=${report.skipped}`,
  );
  if (report.skipped > 0) {
    console.log(
      "\nnote: skipped rows are either manual overrides (kept on purpose) or " +
        "markets/pages not seeded yet (run `npm run seed`).",
    );
  }
}

async function main(): Promise<void> {
  console.log(`Fetching manifest: ${manifestUrl(true)}`);
  const manifest = await fetchManifest({ fresh: true });

  const client = await pool.connect();
  try {
    await client.query("begin");
    const report = await syncExpectations(manifest, client);
    await client.query("commit");
    printReport(report);
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    if (err instanceof ManifestError) {
      console.error(`\nmanifest error: ${err.message}`);
      if (err.bodySnippet) {
        console.error(`body: ${err.bodySnippet}`);
      }
    } else {
      console.error("sync failed:", err);
    }
    process.exitCode = 1;
  })
  .finally(() => closePool());