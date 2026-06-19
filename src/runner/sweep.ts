/**
 * PROD lane sweep runner (Phase 2, Step 3 -- phase complete).
 *
 * Two passes: capture every active market x page, then run deterministic +
 * geo + cross-country + passive-security + non-submitting-interaction checks,
 * persist the run and its checks, and derive run/sweep status from the checks.
 *
 * Expectations are loaded once from the DB (manifest/manual rows) and merged
 * over the code baseline by resolveExpectations.
 *
 * Pass 1 logs per-capture progress (it is otherwise silent while the browser
 * visits every page through the proxy, which can take a few minutes).
 *
 * Usage: npm run sweep
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  CountryCode,
  ExpectationSet,
  LanguageCode,
  RunStatus,
  SweepStatus,
} from "../types.js";
import { closePool } from "../db/client.js";
import {
  createRun,
  createSweep,
  finishRun,
  finishSweep,
  getEnvironmentByKey,
  insertCheck,
  listMarkets,
  listPages,
} from "../db/repository.js";
import { loadExpectations, resolveExpectations } from "../config/expectations.js";
import { resolveInteractions } from "../config/interactions.js";
import { capturePage, type CaptureResult } from "./capture.js";
import { proxyEnvKey, resolveProxy } from "./proxy.js";
import {
  aggregateRunStatus,
  crossCountryCheck,
  fingerprintKey,
  geoCheck,
  runDeterministicChecks,
} from "./checks.js";
import { interactionChecks } from "./interaction.js";
import { runSecurityChecks } from "./security.js";

const STATUS_RANK: Record<RunStatus, number> = {
  pass: 0,
  warn: 1,
  fail: 2,
  error: 3,
};

interface CapturedRun {
  runId: number;
  country: CountryCode;
  language: LanguageCode;
  pageKey: string;
  capture: CaptureResult;
  expectation: ExpectationSet;
}

function worse(a: RunStatus, b: RunStatus): RunStatus {
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
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

function isHealthy(capture: CaptureResult): boolean {
  return (
    !capture.error &&
    capture.cache?.httpStatus === 200 &&
    !capture.blockDetected
  );
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

  // DB-sourced expectations (manifest/manual), merged over the baseline by
  // resolveExpectations. Loaded once for the whole sweep.
  const expectationStore = await loadExpectations();

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

  // How many captures Pass 1 will attempt (markets x pages with a path), so the
  // progress log can show "[n/total]".
  const totalCaptures = markets.reduce(
    (sum, market) =>
      sum + pages.filter((page) => page.pathByLanguage[market.language]).length,
    0,
  );
  let captureIndex = 0;

  // --- Pass 1: capture every market x page ---------------------------------
  console.log(`pass 1: capturing ${totalCaptures} page(s) ...`);
  const captured: CapturedRun[] = [];
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

      captureIndex += 1;
      const label = `${market.countryCode}/${market.language}/${page.pageKey}`;

      const url = new URL(path, environment.baseUrl).toString();
      const runRow = await createRun({
        sweepId: sweep.id,
        marketId: market.id,
        pageId: page.id,
        proxyCountry: market.countryCode,
      });

      if (!proxy) {
        const message = `No proxy configured (set ${proxyEnvKey(market.countryCode)}).`;
        await finishRun(runRow.id, { status: "error", error: message });
        await insertCheck(runRow.id, {
          type: "http_health",
          severity: "critical",
          status: "fail",
          expected: "reachable",
          actual: null,
          message,
        });
        console.log(`  [${captureIndex}/${totalCaptures}] ${label} -> error (no proxy)`);
        worstRun = worse(worstRun, "error");
        continue;
      }

      console.log(`  [${captureIndex}/${totalCaptures}] ${label} capturing ${url} ...`);
      const startedAt = Date.now();

      const screenshotPath = join(
        outputDir,
        `${market.countryCode}-${market.language}-${page.pageKey}.png`,
      );
      const capture = await capturePage({
        url,
        country: market.countryCode,
        proxy,
        screenshotPath,
        steps: resolveInteractions(page.pageKey),
      });

      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      const tail = capture.error ? `error=${capture.error}` : "ok";
      console.log(
        `  [${captureIndex}/${totalCaptures}] ${label} -> ` +
          `http=${capture.cache?.httpStatus ?? "?"} exit=${capture.exit.country ?? "?"} ` +
          `site=${capture.siteCountry ?? "?"} lang=${capture.markers?.htmlLang || "?"} (${secs}s, ${tail})`,
      );

      captured.push({
        runId: runRow.id,
        country: market.countryCode,
        language: market.language,
        pageKey: page.pageKey,
        capture,
        expectation: resolveExpectations(
          expectationStore,
          market.id,
          page.id,
          market.countryCode,
          page.pageKey,
        ),
      });
    }
  }

  // Fingerprints from healthy captures only.
  const fingerprints = new Map<string, string>();
  for (const item of captured) {
    const fp = item.capture.markers?.fingerprint;
    if (fp && isHealthy(item.capture)) {
      fingerprints.set(fingerprintKey(item.pageKey, item.country), fp);
    }
  }

  // --- Pass 2: check, persist, derive status -------------------------------
  console.log(`pass 2: checking ${captured.length} capture(s) ...`);
  for (const item of captured) {
    const checks = runDeterministicChecks(item.capture, item.expectation);

    const geo = geoCheck(item.capture, item.country);
    if (geo) {
      checks.push(geo);
    }

    const cross = crossCountryCheck(
      item.country,
      item.pageKey,
      item.expectation,
      fingerprints,
    );
    if (cross) {
      checks.push(cross);
    }

    checks.push(...runSecurityChecks(item.capture));
    checks.push(
      ...interactionChecks(item.capture.interactions, item.capture.blockedWrites),
    );

    const status = aggregateRunStatus(item.capture, checks);
    const { capture } = item;

    await finishRun(item.runId, {
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

    for (const c of checks) {
      await insertCheck(
        item.runId,
        {
          type: c.type,
          severity: c.severity,
          status: c.status,
          expected: c.expected,
          actual: c.actual,
          message: c.message,
        },
        c.evidence ?? null,
      );
    }

    const failed = checks.filter((c) => c.status !== "pass");
    const tail = failed.length
      ? ` [${failed.map((c) => `${c.type}:${c.status}`).join(", ")}]`
      : "";
    console.log(
      `run #${item.runId} ${item.country}/${item.language}/${item.pageKey} -> ${status}` +
        ` (http=${capture.cache?.httpStatus ?? "?"}, exit=${capture.exit.country ?? "?"}, ` +
        `site=${capture.siteCountry ?? "?"}, lang=${capture.markers?.htmlLang || "?"}, ` +
        `kinsta=${capture.cache?.kinstaCache ?? "-"})${tail}`,
    );
    worstRun = worse(worstRun, status);
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