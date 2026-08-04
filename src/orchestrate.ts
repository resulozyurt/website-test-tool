/**
 * Autopilot: one command that runs the whole self-learning pipeline end to end,
 * fully automatically, and applies what it learns without a human approval step.
 *
 *   1. discover      -- read the sitemap, refresh discovered_pages
 *   2. scenarios     -- generate per-country visibility scenarios for EVERY
 *                       eligible page (site-wide geo-leak coverage)
 *   3. reconcile     -- add scenario-bearing pages to the sweep's page list
 *   4. manifest sync -- derive manifest expectations (source='manifest')
 *   5. learn (auto)  -- live-render each key page and upgrade healthy, geo-correct
 *                       pages to source='auto' (manual rows are never touched)
 *
 * Read-only against the live site throughout (sitemap + inventory + manifest +
 * page renders); the only writes are to our own database. Each stage is isolated
 * so a late failure still leaves earlier progress committed. Priority of learned
 * expectations stays manual > auto > manifest.
 *
 * Prerequisites: `npm run migrate` + `npm run seed`, country proxies and the
 * manifest secret in .env.
 *
 * Usage: npm run autopilot
 */

import { closePool, pool } from "./db/client.js";
import { discover } from "./discovery/discover.js";
import { deactivateMissing, upsertDiscoveredPage } from "./discovery/store.js";
import { generateAllScenarios } from "./scenarios/generate-all.js";
import { reconcilePages } from "./scenarios/reconcile.js";
import { fetchManifest, manifestUrl, ManifestError } from "./manifest/client.js";
import { syncExpectations } from "./manifest/sync.js";
import { buildProposals } from "./learn/learn.js";
import { applyProposalsAuto } from "./learn/auto.js";

const LEARN_OUTPUT_DIR = "learn-output";

function banner(step: number, title: string): void {
  console.log(`\n=== [${step}/5] ${title} ===`);
}

/** Runs a stage, logging and swallowing its error so the pipeline continues. */
async function stage(
  label: string,
  fn: () => Promise<void>,
  failures: string[],
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ! ${label} failed: ${msg}`);
    failures.push(`${label}: ${msg}`);
  }
}

async function discoverStage(): Promise<number> {
  const { usedSitemap, pages } = await discover();
  if (!usedSitemap || pages.length === 0) {
    throw new Error("no sitemap reachable or no same-site URLs found");
  }
  const client = await pool.connect();
  let created = 0;
  try {
    await client.query("begin");
    for (const page of pages) {
      if ((await upsertDiscoveredPage(page, client)) === "created") {
        created += 1;
      }
    }
    const deactivated = await deactivateMissing(
      pages.map((p) => p.url),
      client,
    );
    await client.query("commit");
    const testable = pages.filter((p) => !p.isExcluded).length;
    console.log(
      `  sitemap ${usedSitemap}: ${pages.length} url(s), testable=${testable}, ` +
        `created=${created}, deactivated=${deactivated}`,
    );
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
  return pages.length;
}

async function scenariosStage(): Promise<void> {
  const t = await generateAllScenarios();
  console.log(
    `  eligible=${t.eligible} processed=${t.processed} no-bricks=${t.noBricks} ` +
      `failed=${t.failed}`,
  );
  console.log(
    `  scenarios: created=${t.created} updated=${t.updated} deactivated=${t.deactivated}`,
  );
  if (t.errors.length > 0) {
    console.log(`  first error: ${t.errors[0]}`);
  }
}

async function reconcileStage(): Promise<void> {
  const { created, skipped } = await reconcilePages();
  console.log(`  pages: created=${created.length} skipped(already served)=${skipped}`);
  for (const c of created.slice(0, 10)) {
    console.log(`    + ${c}`);
  }
}

async function manifestStage(): Promise<void> {
  console.log(`  fetching ${manifestUrl(true)}`);
  const manifest = await fetchManifest({ fresh: true });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const report = await syncExpectations(manifest, client);
    await client.query("commit");
    console.log(
      `  manifest expectations: created=${report.created} updated=${report.updated} ` +
        `unchanged=${report.unchanged} skipped=${report.skipped}`,
    );
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

async function learnStage(): Promise<void> {
  const file = await buildProposals(LEARN_OUTPUT_DIR);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const report = await applyProposalsAuto(file, client);
    await client.query("commit");
    console.log(
      `  learn(auto): applied=${report.applied} held=${report.held} ` +
        `skipped=${report.skipped} money-flags=${report.moneyFlags}`,
    );
    for (const e of report.entries) {
      if (e.outcome !== "applied" || e.moneyFlag) {
        const flag = e.moneyFlag ? " [$]" : "";
        console.log(`    ${e.country}/${e.language} ${e.pageKey} -> ${e.outcome}${flag}` +
          (e.reason ? ` (${e.reason})` : ""));
      }
    }
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const failures: string[] = [];
  console.log("autopilot: fully-automatic discover -> learn pipeline");

  // Stage 1 is a hard prerequisite: without discovered pages, the rest is moot.
  banner(1, "discover");
  let discovered = 0;
  try {
    discovered = await discoverStage();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ! discover failed: ${msg}`);
    console.error("aborting: nothing to do without a page inventory.");
    process.exitCode = 1;
    return;
  }

  banner(2, "scenarios (site-wide geo-leak)");
  await stage("scenarios", scenariosStage, failures);

  banner(3, "reconcile pages");
  await stage("reconcile", reconcileStage, failures);

  banner(4, "manifest -> expectations");
  await stage("manifest sync", manifestStage, failures);

  banner(5, "learn (auto-apply)");
  await stage("learn(auto)", learnStage, failures);

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n=== autopilot done in ${secs}s (discovered ${discovered} url(s)) ===`);
  if (failures.length > 0) {
    console.log(`completed with ${failures.length} stage failure(s):`);
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
    process.exitCode = 1;
  } else {
    console.log("all stages succeeded.");
  }
}

main()
  .catch((err) => {
    if (err instanceof ManifestError) {
      console.error(`\nmanifest error: ${err.message}`);
    } else {
      console.error("autopilot failed:", err);
    }
    process.exitCode = 1;
  })
  .finally(() => closePool());
