/**
 * Fully-automatic learning CLI.
 *
 * Captures the live site (read-only), builds proposed expectations, and applies
 * the approved ones straight to the database as source='auto' -- no review file,
 * no manual step. Human 'manual' rows are never overwritten. Money-critical
 * anomalies are flagged in the output for a human to notice.
 *
 * Prerequisite: `npm run seed` (markets/pages must exist to resolve against),
 * and country proxies configured in .env.
 *
 * Usage: npm run learn:auto
 */

import { closePool, pool } from "../db/client.js";
import { ManifestError } from "../manifest/client.js";
import { buildProposals } from "./learn.js";
import { applyProposalsAuto } from "./auto.js";

const OUTPUT_DIR = "learn-output";

async function main(): Promise<void> {
  const file = await buildProposals(OUTPUT_DIR);

  const client = await pool.connect();
  try {
    await client.query("begin");
    const report = await applyProposalsAuto(file, client);
    await client.query("commit");

    console.log("\n=== learn:auto (source='auto') ===\n");
    for (const e of report.entries) {
      const flag = e.moneyFlag ? " [$ money-critical]" : "";
      const tail = e.reason ? `  (${e.reason})` : "";
      console.log(`  ${e.country}/${e.language} ${e.pageKey} -> ${e.outcome}${flag}${tail}`);
    }
    console.log(
      `\napplied=${report.applied} held=${report.held} skipped=${report.skipped} ` +
        `money-flags=${report.moneyFlags}`,
    );
    if (report.held > 0) {
      console.log(
        "\nnote: 'held' pages were not learned (unhealthy capture or wrong geo). " +
          "Fix the proxy/site and re-run; they stay on the manifest baseline until then.",
      );
    }
    if (report.moneyFlags > 0) {
      console.log(
        "warning: money-critical flag(s) present. The price rule was kept from the " +
          "manifest (never auto-flipped); review the flagged page(s) for a real leak.",
      );
    }
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
    } else {
      console.error("learn:auto failed:", err);
    }
    process.exitCode = 1;
  })
  .finally(() => closePool());
