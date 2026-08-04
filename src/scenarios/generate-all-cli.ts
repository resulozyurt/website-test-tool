/**
 * Bulk scenario generation CLI. Thin wrapper over generateAllScenarios (see
 * scenarios/generate-all.ts), which does the site-wide work and is shared with
 * the autopilot orchestrator. Read-only against the live site; writes only to
 * our own database. Run after `npm run discover`.
 *
 * Usage: npm run scenarios:gen
 */

import { closePool } from "../db/client.js";
import { generateAllScenarios } from "./generate-all.js";

async function main(): Promise<void> {
  const totals = await generateAllScenarios();
  console.log(
    `eligible pages: ${totals.eligible} (run "npm run discover" first if this looks low)\n`,
  );
  console.log(
    `processed=${totals.processed} skipped(no market)=${totals.skipped} ` +
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
