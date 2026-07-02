/**
 * Full-site health crawl orchestrator.
 *
 * For each crawl target (country + language), lists every active, non-excluded
 * discovered page and inspects it through that country's proxy as a read-only
 * visitor, with bounded concurrency and a politeness delay. Each page's raw
 * signals become findings (checks.ts) and are persisted (store.ts). When AI is
 * enabled for the run, readable slices are cut and sent to Claude for an
 * advisory visual verdict.
 *
 * A single crawl-wide link-probe cache is shared across every target and page
 * so each unique internal target is reachability-probed exactly once (nav and
 * footer links are otherwise re-probed on every page -- the main cost fix).
 *
 * Separate from the geo sweep; writes only to the 0005 health tables.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CountryCode, LanguageCode } from "../types.js";
import {
  CRAWL_TARGETS,
  EXPECTED_CTA_BY_LANG,
  HEALTH_CONFIG,
} from "../config/health.js";
import { proxyEnvKey, resolveProxy } from "../runner/proxy.js";
import { inspectPage, type PageHealth } from "./inspect.js";
import { buildFindings, aggregatePageStatus } from "./checks.js";
import { reviewPageVisual } from "./ai-visual.js";
import type { LinkProbeCache } from "./functional.js";
import {
  createHealthRun,
  finishHealthRun,
  insertHealthFinding,
  insertHealthPage,
  listPagesToCrawl,
  type CrawlPage,
  type HealthRunStatus,
  type HealthStatus,
} from "./store.js";

export interface CrawlOptions {
  /** Enable the sliced AI visual review for this crawl (default false). */
  ai: boolean;
  /** Restrict to a single country (default: all CRAWL_TARGETS). */
  onlyCountry?: CountryCode;
  /** Cap pages per country (0 = config default / no cap). */
  limit: number;
  trigger: "manual" | "cron";
}

function slugOf(page: CrawlPage): string {
  return (page.slug && page.slug.trim()) || "home";
}

/** Runs a bounded-concurrency map over items, preserving politeness spacing. */
async function pool<T>(
  items: T[],
  concurrency: number,
  delayMs: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners: Promise<void>[] = [];
  const take = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) {
        return;
      }
      if (delayMs > 0 && i > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      await worker(items[i], i);
    }
  };
  const n = Math.max(1, Math.min(concurrency, items.length));
  for (let k = 0; k < n; k += 1) {
    runners.push(take());
  }
  await Promise.all(runners);
}

function worse(a: HealthStatus, b: HealthStatus): HealthStatus {
  const rank: Record<HealthStatus, number> = { pass: 0, warn: 1, fail: 2, error: 3 };
  return rank[b] > rank[a] ? b : a;
}

/** Crawls one country/language target; returns per-page status counts. */
async function crawlTarget(
  runId: number,
  country: CountryCode,
  language: LanguageCode,
  pages: CrawlPage[],
  outputDir: string,
  aiEnabled: boolean,
  probeCache: LinkProbeCache,
): Promise<{ ok: number; fail: number; worst: HealthStatus; aiCost: number }> {
  const proxy = resolveProxy(country);
  if (!proxy) {
    console.warn(`  no proxy for ${country} (set ${proxyEnvKey(country)}); skipping target`);
    return { ok: 0, fail: 0, worst: "pass", aiCost: 0 };
  }

  // CTA expectation is language-driven (US and AE share English), so resolve it
  // from the page language rather than the country.
  const expectedCta = EXPECTED_CTA_BY_LANG[language];
  let ok = 0;
  let fail = 0;
  let worst: HealthStatus = "pass";
  let aiCost = 0;
  let done = 0;

  await pool(
    pages,
    HEALTH_CONFIG.concurrency,
    HEALTH_CONFIG.politenessDelayMs,
    async (page) => {
      const slug = slugOf(page);
      const base = `${country}-${language}-${slug}`.replace(/[^a-z0-9-]/gi, "_");
      const screenshotPath = join(outputDir, `${base}.png`);

      const health: PageHealth = await inspectPage({
        url: page.url,
        country,
        proxy,
        screenshotPath,
        settleMs: HEALTH_CONFIG.settleMs,
        navTimeoutMs: HEALTH_CONFIG.navTimeoutMs,
        maxLinkProbes: HEALTH_CONFIG.maxLinkProbesPerPage,
        probeHeadTimeoutMs: HEALTH_CONFIG.probeHeadTimeoutMs,
        probeGetTimeoutMs: HEALTH_CONFIG.probeGetTimeoutMs,
        probeCache,
        slices: aiEnabled
          ? {
              dir: join(outputDir, "slices"),
              base,
              sliceHeight: HEALTH_CONFIG.aiSliceHeight,
              maxSlices: HEALTH_CONFIG.aiMaxSlices,
            }
          : undefined,
      });

      // Optional AI visual review (advisory).
      let ai = null;
      if (aiEnabled && health.aiSlicePaths.length > 0) {
        ai = await reviewPageVisual({
          slicePaths: health.aiSlicePaths,
          country,
          language,
          url: health.url,
        });
        if (ai?.costUsd) {
          aiCost += ai.costUsd;
        }
      }

      const findings = buildFindings(
        health,
        expectedCta,
        ai,
        HEALTH_CONFIG.firstPartyHosts,
      );
      const status = aggregatePageStatus(health, findings);

      const pageId = await insertHealthPage(runId, {
        discoveredPageId: page.discoveredPageId,
        url: health.url,
        path: page.path,
        language,
        country,
        httpStatus: health.httpStatus,
        finalUrl: health.finalUrl,
        blank: health.blank,
        cacheBucket: health.cache?.kinstaCache ?? null,
        siteCountry: health.siteCountry,
        consoleErrors: health.consoleErrors.length ? health.consoleErrors : null,
        networkErrors: health.networkErrors.length ? health.networkErrors : null,
        brokenImages: health.visual?.brokenImages?.length ? health.visual.brokenImages : null,
        brokenLinks: health.deadLinks.length ? health.deadLinks : null,
        aiVerdict: ai?.verdict ?? null,
        aiNotes: ai ? (ai.suggestion ?? (ai.error ? `error: ${ai.error}` : null)) : null,
        aiCostUsd: ai?.costUsd ?? null,
        screenshotKey: health.screenshotPath,
        status,
        error: health.error,
        durationMs: health.durationMs,
      });

      for (const fnd of findings) {
        await insertHealthFinding(pageId, fnd);
      }

      if (status === "pass") {
        ok += 1;
      } else {
        fail += 1;
      }
      worst = worse(worst, status);
      done += 1;

      const flags = findings
        .filter((x) => x.severity !== "minor")
        .map((x) => x.type);
      const tail = flags.length ? ` [${flags.join(", ")}]` : "";
      const aiTag = ai ? ` ai=${ai.verdict}` : "";
      console.log(
        `  [${done}/${pages.length}] ${country}/${language} ${slug} -> ${status}` +
          ` (http=${health.httpStatus ?? "?"}, ${(health.durationMs / 1000).toFixed(1)}s)${aiTag}${tail}`,
      );
    },
  );

  return { ok, fail, worst, aiCost };
}

/** Runs the health crawl for the selected targets. */
export async function runCrawl(options: CrawlOptions): Promise<void> {
  const targets = CRAWL_TARGETS.filter(
    (t) => !options.onlyCountry || t.country === options.onlyCountry,
  );
  if (targets.length === 0) {
    console.log("no matching crawl targets");
    return;
  }

  const perCountryLimit =
    options.limit > 0 ? options.limit : HEALTH_CONFIG.maxPagesPerCountry;

  // One cache for the whole crawl: a unique internal target is probed once,
  // even across countries. Cached results are settled values, so awaiting a
  // probe started by an already-closed context is safe.
  const probeCache: LinkProbeCache = new Map();

  for (const target of targets) {
    const pages = await listPagesToCrawl(target.language, perCountryLimit);
    if (pages.length === 0) {
      console.log(`no pages to crawl for ${target.country}/${target.language}`);
      continue;
    }

    const run = await createHealthRun(
      { country: target.country, trigger: options.trigger, aiEnabled: options.ai },
      undefined,
    );
    const outputDir = join("healthcheck-output", `run-${run.id}`);
    await mkdir(outputDir, { recursive: true });

    console.log(
      `health run #${run.id} ${target.country}/${target.language}: ${pages.length} page(s)` +
        `${options.ai ? " (AI on)" : ""}`,
    );

    const { ok, fail, worst, aiCost } = await crawlTarget(
      run.id,
      target.country,
      target.language,
      pages,
      outputDir,
      options.ai,
      probeCache,
    );

    const runStatus: HealthRunStatus =
      worst === "fail" || worst === "error" ? "fail" : worst === "warn" ? "warn" : "pass";

    await finishHealthRun(run.id, {
      status: runStatus,
      pagesTotal: pages.length,
      pagesOk: ok,
      pagesWarn: 0,
      pagesFail: fail,
    });

    console.log(
      `health run #${run.id} ${target.country} finished -> ${runStatus}` +
        ` (ok=${ok}, fail=${fail}${aiCost > 0 ? `, ai=$${aiCost.toFixed(4)}` : ""})`,
    );
    console.log(`  output: ${outputDir}`);
  }
}