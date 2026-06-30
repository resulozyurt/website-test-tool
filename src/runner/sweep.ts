/**
 * PROD lane sweep runner.
 *
 * Two passes: capture every active market x page, then run deterministic + geo
 * + cross-country + scenario + passive-security + non-submitting-interaction
 * checks, persist the run and its checks, optionally add an advisory AI visual
 * verdict, and derive run/sweep status from the deterministic checks (AI never
 * gates).
 *
 * Expectations are loaded once from the DB (manifest/manual rows) and merged
 * over the code baseline by resolveExpectations. Active scenarios (Bricks
 * selector visibility rules) are also loaded once and indexed by page+country;
 * only pages that have scenarios are probed in the DOM, so the rest do no extra
 * work.
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
  insertAiVerdict,
  insertCheck,
  listMarkets,
  listPages,
} from "../db/repository.js";
import { loadExpectations, resolveExpectations } from "../config/expectations.js";
import { resolveInteractions } from "../config/interactions.js";
import { listActiveScenarios } from "../scenarios/store.js";
import { verifyExperience } from "../ai/verify.js";
import { capturePage, type CaptureResult } from "./capture.js";
import { proxyEnvKey, resolveProxy } from "./proxy.js";
import {
  aggregateRunStatus,
  crossCountryCheck,
  fingerprintKey,
  geoCheck,
  runDeterministicChecks,
  scenarioChecks,
  type RunScenario,
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
  scenarios: RunScenario[];
  aiScreenshotPath: string;
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

/**
 * Canonical form of a URL for matching a scenario's page_url to a run's url.
 * Drops a leading `www.`, lower-cases host + path, and ensures a trailing slash,
 * so `https://www.fieldpie.com/pricing` and `https://fieldpie.com/pricing/`
 * collapse to the same key.
 */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    let path = u.pathname.toLowerCase();
    if (!path.endsWith("/")) {
      path += "/";
    }
    return `${host}${path}`;
  } catch {
    return raw.toLowerCase();
  }
}

function scenarioKey(url: string, country: string): string {
  return `${normalizeUrl(url)}::${country.toUpperCase()}`;
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

  // Active scenarios (Bricks selector visibility rules), loaded once and indexed
  // by (normalized url + country). Each run pulls only the scenarios for the
  // exact page+country it is visiting; only those pages are probed in the DOM.
  const scenarioRows = await listActiveScenarios();
  const scenariosByKey = new Map<string, RunScenario[]>();
  const selectorsByKey = new Map<string, string[]>();
  for (const row of scenarioRows) {
    const key = scenarioKey(row.pageUrl, row.country);
    const list = scenariosByKey.get(key) ?? [];
    list.push({
      selector: row.selector,
      expectation: row.expectation === "present" ? "present" : "absent",
      kind: row.kind,
      label: row.label,
      rule: row.rule,
      isMoneyCritical: row.isMoneyCritical,
      gating: row.gating,
    });
    scenariosByKey.set(key, list);
  }
  for (const [key, list] of scenariosByKey) {
    selectorsByKey.set(key, [...new Set(list.map((s) => s.selector))]);
  }
  console.log(
    `loaded ${scenarioRows.length} active scenario(s) across ` +
      `${scenariosByKey.size} page/country combo(s)`,
  );

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
  let aiCostUsd = 0;

  // How many captures Pass 1 will attempt (markets x pages with a path).
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

      // Scenarios for this exact page+country (empty for pages without any).
      const runKey = scenarioKey(url, market.countryCode);
      const runScenarios = scenariosByKey.get(runKey) ?? [];
      const scenarioSelectors = selectorsByKey.get(runKey);

      const runRow = await createRun({
        sweepId: sweep.id,
        marketId: market.id,
        pageId: page.id,
        proxyCountry: market.countryCode,
      });

      const base = `${market.countryCode}-${market.language}-${page.pageKey}`;
      const screenshotPath = join(outputDir, `${base}.png`);
      const aiScreenshotPath = join(outputDir, `${base}-ai.png`);

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

      const scenarioNote =
        runScenarios.length > 0 ? ` [${runScenarios.length} scenario(s)]` : "";
      console.log(
        `  [${captureIndex}/${totalCaptures}] ${label} capturing ${url} ...${scenarioNote}`,
      );
      const startedAt = Date.now();

      const capture = await capturePage({
        url,
        country: market.countryCode,
        proxy,
        screenshotPath,
        aiScreenshotPath,
        steps: resolveInteractions(page.pageKey),
        scenarioSelectors,
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
        scenarios: runScenarios,
        aiScreenshotPath,
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
    checks.push(
      ...scenarioChecks(item.scenarios, item.capture.scenarioObservations),
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

    // Advisory AI visual verdict (does NOT change run status). Skipped when no
    // API key is set or the capture was not healthy.
    if (isHealthy(capture)) {
      const ai = await verifyExperience({
        screenshotPath: item.aiScreenshotPath,
        country: item.country,
        language: item.language,
        pageKey: item.pageKey,
        expectation: item.expectation,
      });
      if (ai) {
        await insertAiVerdict({
          runId: item.runId,
          model: ai.model,
          verdict: ai.verdict,
          confidence: ai.confidence,
          findings: ai.error ? { error: ai.error } : ai.findings,
          inputTokens: ai.inputTokens,
          outputTokens: ai.outputTokens,
          costUsd: ai.costUsd,
        });
        if (ai.costUsd) {
          aiCostUsd += ai.costUsd;
        }
        const conf = ai.confidence != null ? ` ${Math.round(ai.confidence * 100)}%` : "";
        const cost = ai.costUsd != null ? ` $${ai.costUsd.toFixed(5)}` : "";
        console.log(`  ai ${item.country}/${item.pageKey} -> ${ai.verdict}${conf}${cost}`);
      }
    }
  }

  const sweepStatus = rollUp(worstRun);
  await finishSweep(sweep.id, sweepStatus);
  console.log(`sweep #${sweep.id} finished -> ${sweepStatus}`);
  if (aiCostUsd > 0) {
    console.log(`ai cost this sweep: $${aiCostUsd.toFixed(5)}`);
  }
  console.log(`screenshots: ${outputDir}`);
}

main()
  .catch((err) => {
    console.error("sweep failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());