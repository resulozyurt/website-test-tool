import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import "dotenv/config";
import { chromium } from "playwright";
import { MARKETS, type Market } from "./markets.js";
import { getProxyConfig } from "./proxy.js";
import {
  extractMarkers,
  readCacheSignals,
  type CacheSignals,
  type ContentMarkers,
} from "./checks.js";

const OUTPUT_DIR = "poc-output";
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 4000);
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS ?? 45000);

interface MarketResult {
  country: string;
  expectedLanguage: string;
  url: string;
  proxyConfigured: boolean;
  error: string | null;
  cache: CacheSignals | null;
  markers: ContentMarkers | null;
  screenshot: string | null;
  /** True when a non-TR market unexpectedly served Turkish content. */
  silentTurkishFallback: boolean;
}

/** Visits a single market through its country proxy and captures all signals. */
async function visitMarket(market: Market): Promise<MarketResult> {
  const baseUrl = process.env.TARGET_BASE_URL ?? "https://fieldpie.com";
  const url = new URL(market.path, baseUrl).toString();
  const proxy = getProxyConfig(market);

  const result: MarketResult = {
    country: market.country,
    expectedLanguage: market.expectedLanguage,
    url,
    proxyConfigured: proxy !== null,
    error: null,
    cache: null,
    markers: null,
    screenshot: null,
    silentTurkishFallback: false,
  };

  if (!proxy) {
    result.error = `No proxy configured for ${market.country} (set ${market.proxyEnvKey}).`;
    return result;
  }

  const browser = await chromium.launch({ proxy });
  try {
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForTimeout(SETTLE_MS);

    result.cache = readCacheSignals(response);
    result.markers = await extractMarkers(page);

    // A non-TR market that renders Turkish (lang=tr or Turkish text) indicates
    // the "silent fallback to TR" failure we explicitly want to catch.
    if (market.country !== "TR" && result.markers) {
      result.silentTurkishFallback =
        result.markers.htmlLang.toLowerCase().startsWith("tr") ||
        result.markers.turkishDetected;
    }

    const screenshotPath = join(OUTPUT_DIR, `${market.country}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    result.screenshot = screenshotPath;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    await browser.close();
  }

  return result;
}

/** Prints a compact human-readable summary to the console. */
function printSummary(results: MarketResult[]): void {
  console.log("\n=== Phase 0 verification summary ===\n");
  for (const r of results) {
    console.log(`[${r.country}] ${r.url}`);
    if (r.error) {
      console.log(`  ERROR: ${r.error}\n`);
      continue;
    }
    console.log(`  HTTP:           ${r.cache?.httpStatus}`);
    console.log(`  x-kinsta-cache: ${r.cache?.kinstaCache ?? "(absent)"}`);
    console.log(`  cf-cache-status:${r.cache?.cfCacheStatus ?? "(absent)"}`);
    console.log(`  html lang:      ${r.markers?.htmlLang || "(none)"}`);
    console.log(`  CTA:            trial=${r.markers?.hasStartFreeTrial} demo=${r.markers?.hasBookDemo}`);
    console.log(`  currency:       ${r.markers?.currencySymbols.join(", ") || "(none)"}`);
    console.log(`  phone:          ${r.markers?.phoneNumbers.join(", ") || "(none)"}`);
    console.log(`  fingerprint:    ${r.markers?.fingerprint}`);
    if (r.silentTurkishFallback) {
      console.log("  >> WARNING: silent Turkish fallback detected!");
    }
    console.log("");
  }

  // Cross-country differentiation: distinct fingerprints mean the cache served
  // different content per country, which is what we expect.
  const fingerprints = results
    .filter((r) => r.markers)
    .map((r) => r.markers!.fingerprint);
  const uniqueCount = new Set(fingerprints).size;
  console.log(`Distinct content fingerprints: ${uniqueCount} of ${fingerprints.length}`);
  if (fingerprints.length > 1 && uniqueCount === 1) {
    console.log(">> WARNING: all countries returned identical content (cache not differentiating).");
  }
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
    target: process.env.TARGET_BASE_URL ?? "https://fieldpie.com",
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
