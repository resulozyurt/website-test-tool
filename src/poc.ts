import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import "dotenv/config";
import { chromium } from "playwright";
import { MARKETS, type Market } from "./markets.js";
import { getProxyConfig, type ProxyConfig } from "./proxy.js";
import {
  extractMarkers,
  getExitInfo,
  looksLikeBlockPage,
  readCacheSignals,
  type CacheSignals,
  type ContentMarkers,
  type ExitInfo,
} from "./checks.js";

const OUTPUT_DIR = "poc-output";
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 4000);
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS ?? 45000);
const DEFAULT_BASE_URL = "https://www.fieldpie.com";

/** One visit attempt through a specific proxy variant. */
interface Attempt {
  variant: "configured" | "fresh-session";
  exit: ExitInfo;
  cache: CacheSignals | null;
  markers: ContentMarkers | null;
  blockDetected: boolean;
  bodySnippet: string | null;
  screenshot: string | null;
  error: string | null;
}

interface MarketResult {
  country: string;
  expectedLanguage: string;
  url: string;
  proxyConfigured: boolean;
  attempts: Attempt[];
  /** True when a non-TR market unexpectedly served Turkish content. */
  silentTurkishFallback: boolean;
}

function emptyAttempt(variant: Attempt["variant"], error: string | null): Attempt {
  return {
    variant,
    exit: { ip: null, country: null, error: null },
    cache: null,
    markers: null,
    blockDetected: false,
    bodySnippet: null,
    screenshot: null,
    error,
  };
}

/**
 * DataImpulse pins a sticky IP via ";sessid.<id>" in the username. Replacing the
 * id (or appending one) forces a different exit IP, which lets us tell whether a
 * block is specific to one IP or affects the whole country pool.
 */
function withFreshSession(proxy: ProxyConfig): ProxyConfig {
  if (!proxy.username) {
    return proxy;
  }
  const token = `r${Math.random().toString(36).slice(2, 10)}`;
  const hasSession = /;sessid\.[^;]+/.test(proxy.username);
  const username = hasSession
    ? proxy.username.replace(/;sessid\.[^;]+/, `;sessid.${token}`)
    : `${proxy.username};sessid.${token}`;
  return { ...proxy, username };
}

/** Runs a single visit attempt and captures every signal. */
async function runAttempt(
  market: Market,
  url: string,
  proxy: ProxyConfig,
  variant: Attempt["variant"],
): Promise<Attempt> {
  const attempt = emptyAttempt(variant, null);
  const browser = await chromium.launch({ proxy });
  try {
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1366, height: 900 },
    });

    // Confirm the real exit IP and country first (same sticky session).
    attempt.exit = await getExitInfo(context);

    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForTimeout(SETTLE_MS);

    attempt.cache = readCacheSignals(response);
    attempt.markers = await extractMarkers(page);

    const status = response?.status() ?? 0;
    if (status !== 200 && response) {
      const body = await response.text();
      attempt.blockDetected = looksLikeBlockPage(body);
      attempt.bodySnippet = body.slice(0, 300).replace(/\s+/g, " ").trim();
    }

    const screenshotPath = join(OUTPUT_DIR, `${market.country}-${variant}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    attempt.screenshot = screenshotPath;
  } catch (err) {
    attempt.error = err instanceof Error ? err.message : String(err);
  } finally {
    await browser.close();
  }
  return attempt;
}

/** Visits a market; retries once with a fresh IP if the first attempt is not 200. */
async function visitMarket(market: Market): Promise<MarketResult> {
  const baseUrl = process.env.TARGET_BASE_URL ?? DEFAULT_BASE_URL;
  const url = new URL(market.path, baseUrl).toString();
  const proxy = getProxyConfig(market);

  const result: MarketResult = {
    country: market.country,
    expectedLanguage: market.expectedLanguage,
    url,
    proxyConfigured: proxy !== null,
    attempts: [],
    silentTurkishFallback: false,
  };

  if (!proxy) {
    result.attempts.push(
      emptyAttempt(
        "configured",
        `No proxy configured for ${market.country} (set ${market.proxyEnvKey}).`,
      ),
    );
    return result;
  }

  const first = await runAttempt(market, url, proxy, "configured");
  result.attempts.push(first);

  const firstStatus = first.cache?.httpStatus ?? 0;
  if (firstStatus !== 200 || first.error) {
    const second = await runAttempt(
      market,
      url,
      withFreshSession(proxy),
      "fresh-session",
    );
    result.attempts.push(second);
  }

  // Evaluate the silent-Turkish-fallback flag on the best available attempt.
  const ok =
    result.attempts.find((a) => a.cache?.httpStatus === 200) ??
    result.attempts[0];
  if (market.country !== "TR" && ok?.markers) {
    result.silentTurkishFallback =
      ok.markers.htmlLang.toLowerCase().startsWith("tr") ||
      ok.markers.turkishDetected;
  }

  return result;
}

function printAttempt(market: MarketResult, a: Attempt): void {
  console.log(`  -- attempt: ${a.variant}`);
  if (a.error) {
    console.log(`     ERROR: ${a.error}`);
  }
  console.log(`     exit IP/country: ${a.exit.ip ?? "?"} / ${a.exit.country ?? "?"}`);
  if (a.exit.country && a.exit.country !== market.country) {
    console.log(`     >> WARNING: exited from ${a.exit.country}, expected ${market.country}`);
  }
  console.log(`     HTTP:           ${a.cache?.httpStatus ?? "(none)"}`);
  console.log(`     x-kinsta-cache: ${a.cache?.kinstaCache ?? "(absent)"}`);
  console.log(`     html lang:      ${a.markers?.htmlLang || "(none)"}`);
  console.log(`     CTA:            trial=${a.markers?.hasStartFreeTrial} demo=${a.markers?.hasBookDemo}`);
  console.log(`     phone:          ${a.markers?.phoneNumbers.join(", ") || "(none)"}`);
  console.log(`     fingerprint:    ${a.markers?.fingerprint ?? "(none)"}`);
  if (a.blockDetected) {
    console.log("     >> looks like a block page (Cloudflare/WAF)");
  }
  if (a.bodySnippet) {
    console.log(`     body: ${a.bodySnippet}`);
  }
}

function printSummary(results: MarketResult[]): void {
  console.log("\n=== Phase 0 verification summary ===\n");
  for (const r of results) {
    console.log(`[${r.country}] ${r.url}`);
    for (const a of r.attempts) {
      printAttempt(r, a);
    }
    if (r.silentTurkishFallback) {
      console.log("  >> WARNING: silent Turkish fallback detected!");
    }
    console.log("");
  }

  // Cross-country differentiation across the successful (200) attempts.
  const okFingerprints = results
    .map((r) => r.attempts.find((a) => a.cache?.httpStatus === 200)?.markers?.fingerprint)
    .filter((fp): fp is string => Boolean(fp));
  const uniqueCount = new Set(okFingerprints).size;
  console.log(`Distinct content fingerprints (200 only): ${uniqueCount} of ${okFingerprints.length}`);
  console.log("\nFull details written to poc-output/report.json\n");
}

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const results: MarketResult[] = [];
  for (const market of MARKETS) {
    console.log(`Visiting ${market.country} ...`);
    results.push(await visitMarket(market));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    target: process.env.TARGET_BASE_URL ?? DEFAULT_BASE_URL,
    results,
  };
  await writeFile(
    join(OUTPUT_DIR, "report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );

  printSummary(results);
}

main().catch((err) => {
  console.error("PoC run failed:", err);
  process.exitCode = 1;
});
