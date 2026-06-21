/**
 * Reconcile CLI. Adds a `pages` row for every scenario-bearing page that is not
 * already served by an existing row, so the sweep will visit it. Idempotent;
 * writes only to our own database. Run after `npm run scenarios:gen`.
 *
 * Usage: npm run pages:reconcile
 */

import { closePool } from "../db/client.js";
import { reconcilePages } from "./reconcile.js";

async function main(): Promise<void> {
  const { created, skipped } = await reconcilePages();
  console.log(
    `reconcile: created=${created.length} skipped(already served)=${skipped}`,
  );
  for (const c of created) {
    console.log(`  + ${c}`);
  }
}

main()
  .catch((err) => {
    console.error("reconcile failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
