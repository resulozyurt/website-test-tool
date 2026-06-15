/**
 * PROD lane sweep runner core (Phase 2, Step 1).
 *
 * Drives the seeded test matrix (active markets x active pages) against the
 * production environment, captures real signals through each country proxy, and
 * persists one `runs` row per market+page visit under a single `sweeps` row.
 *
 * The per-run status here is PROVISIONAL (http 200 and not a block page ->
 * pass; otherwise fail/error). Step 2 replaces this with a status aggregated
 * from deterministic `checks`. Runs are persisted independently (no outer
 * transaction) so a crash on one market still leaves the others recorded.
 *
 * Usage: npm run sweep
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RunStatus, SweepStatus } from "../types.js";
import { closePool } from "../db/client.js";
import {
  createRun,
  createSweep,
  finishRun,
  finishSweep,
  getEnvironmentByKey,
  listMarkets,
  listPages,
} from "../db/repository.js";
import { capturePage, type CaptureResult } from "./capture.js";
import { proxyEnvKey, resolveProxy } from "./proxy.js";

const STATUS_RANK: Record<RunStatus, number> = {
  pass: 0,
  warn: 1,
  fail: 2,
  error: 3,
};

/** Returns the worse (higher-severity) of two run statuses. */
function worse(a: RunStatus, b: RunStatus): RunStatus {
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

/** Provisional run status until the Step 2 check engine takes over. */
function provisionalStatus(capture: CaptureResult): RunStatus {
  if (capture.error) {
    return "error";
  }
  const http = capture.cache?.httpStatus ?? 0;
  if (http !== 200 || capture.blockDetected) {
    return "fail";
  }
  return "pass";
}

function rollUp(worstRun: RunStatus): SweepStatus {
  if (worstRun === "error" || worstRun === "fail") {
    return "fail";
  }
  if (worstRun === "warn") {
    return "warn";
  }
  return "pass";
}

async function main(): Promise<void> {
  const environment = await getEnvironmentByKey("production");
  if (!environment || !environment.isActive) {
    throw new Error(
      "Production environment is not seeded or not active. Run `npm run seed` first.",
    );
  }

  const markets = await listMarkets(true);
  const pages = await listPages(true);

  const sweep = await createSweep({
    environmentId: environment.id,
    trigger: "manual",
  });
  console.log(
    `sweep #${sweep.id} started (env=${environment.key}, base=${environment.baseUrl})`,
  );

  const outputDir = join("runner-output", `sweep-${sweep.id}`);
  await mkdir(outputDir, { recursive: true });

  let worstRun: RunStatus = "pass";

  for (const market of markets) {
    const proxy = resolveProxy(market.countryCode);

    for (const page of pages) {
      const path = page.pathByLanguage[market.language];
      if (!path) {
        console.warn(
          `skip ${market.countryCode}/${market.language} ${page.pageKey}: no path for language`,
        );
        continue;
      }

      const url = new URL(path, environment.baseUrl).toString();
      const runRow = await createRun({
        sweepId: sweep.id,
        marketId: market.id,
        pageId: page.id,
        proxyCountry: market.countryCode,
      });

      if (!proxy) {
        await finishRun(runRow.id, {
          status: "error",
          error: `No proxy configured (set ${proxyEnvKey(market.countryCode)}).`,
        });
        console.log(
          `run #${runRow.id} ${market.countryCode}/${page.pageKey} -> error (no proxy)`,
        );
        worstRun = worse(worstRun, "error");
        continue;
      }

      const screenshotPath = join(
        outputDir,
        `${market.countryCode}-${market.language}-${page.pageKey}.png`,
      );

      const capture = await capturePage({
        url,
        country: market.countryCode,
        proxy,
        screenshotPath,
      });

      const status = provisionalStatus(capture);
      await finishRun(runRow.id, {
        status,
        exitIp: capture.exit.ip,
        exitCountry: capture.exit.country,
        httpStatus: capture.cache?.httpStatus ?? null,
        kinstaCache: capture.cache?.kinstaCache ?? null,
        cfCacheStatus: capture.cache?.cfCacheStatus ?? null,
        contentLanguage: capture.cache?.contentLanguage ?? null,
        screenshotKey: capture.screenshotPath,
        rawHeaders: capture.rawHeaders,
        consoleErrors:
          capture.consoleErrors.length > 0 ? capture.consoleErrors : null,
        networkErrors:
          capture.networkErrors.length > 0 ? capture.networkErrors : null,
        error: capture.error,
      });

      console.log(
        `run #${runRow.id} ${market.countryCode}/${market.language}/${page.pageKey} -> ${status} ` +
          `(http=${capture.cache?.httpStatus ?? "?"}, exit=${capture.exit.country ?? "?"}, ` +
          `lang=${capture.markers?.htmlLang || "?"}, kinsta=${capture.cache?.kinstaCache ?? "-"})`,
      );
      worstRun = worse(worstRun, status);
    }
  }

  const sweepStatus = rollUp(worstRun);
  await finishSweep(sweep.id, sweepStatus);
  console.log(`sweep #${sweep.id} finished -> ${sweepStatus}`);
  console.log(`screenshots: ${outputDir}`);
}

main()
  .catch((err) => {
    console.error("sweep failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());