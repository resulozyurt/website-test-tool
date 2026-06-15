/**
 * PROD lane sweep runner (Phase 2, Step 2).
 *
 * Two passes:
 *   1. Capture every active market x page through its country proxy.
 *   2. Run deterministic checks (incl. sweep-level cross-country), persist a
 *      run + its checks, and derive the run/sweep status from the checks.
 *
 * Runs are persisted independently so a crash on one market still leaves the
 * others recorded.
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
import { resolveExpectations } from "../config/expectations.js";
import { capturePage, type CaptureResult } from "./capture.js";
import { proxyEnvKey, resolveProxy } from "./proxy.js";
import {
  aggregateRunStatus,
  crossCountryCheck,
  fingerprintKey,
  runDeterministicChecks,
} from "./checks.js";

const STATUS_RANK: Record<RunStatus, number> = {
  pass: 0,
  warn: 1,
  fail: 2,
  error: 3,
};

/** A captured run held in memory between pass 1 and pass 2. */
interface CapturedRun {
  runId: number;
  country: CountryCode;
  language: LanguageCode;
  pageKey: string;
  capture: CaptureResult;
  expectation: ExpectationSet;
}

/** Returns the worse (higher-severity) of two run statuses. */
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

  // --- Pass 1: capture every market x page ---------------------------------
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
        console.log(`run #${runRow.id} ${market.countryCode}/${page.pageKey} -> error (no proxy)`);
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

      captured.push({
        runId: runRow.id,
        country: market.countryCode,
        language: market.language,
        pageKey: page.pageKey,
        capture,
        expectation: resolveExpectations(
          market.countryCode,
          market.language,
          page.pageKey,
        ),
      });
    }
  }

  // Fingerprints from healthy captures only (don't compare against error pages).
  const fingerprints = new Map<string, string>();
  for (const item of captured) {
    const fp = item.capture.markers?.fingerprint;
    if (fp && isHealthy(item.capture)) {
      fingerprints.set(fingerprintKey(item.pageKey, item.country), fp);
    }
  }

  // --- Pass 2: check, persist, and derive status ---------------------------
  for (const item of captured) {
    const checks = runDeterministicChecks(item.capture, item.expectation);
    const cross = crossCountryCheck(
      item.country,
      item.pageKey,
      item.expectation,
      fingerprints,
    );
    if (cross) {
      checks.push(cross);
    }

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
        `lang=${capture.markers?.htmlLang || "?"}, kinsta=${capture.cache?.kinstaCache ?? "-"})${tail}`,
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