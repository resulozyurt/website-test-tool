/**
 * CLI for the full-site health crawl.
 *
 * Usage:
 *   npm run healthcheck                       # all targets, AI off
 *   npm run healthcheck -- --country=US       # one country
 *   npm run healthcheck -- --limit=5          # cap pages per country (dev)
 *   npm run healthcheck -- --ai               # enable sliced AI visual review
 *   npm run healthcheck -- --country=US --limit=5 --ai
 */

import { closePool } from "../db/client.js";
import type { CountryCode } from "../types.js";
import { runCrawl, type CrawlOptions } from "./crawl.js";

function parseArgs(argv: string[]): CrawlOptions {
  let ai = false;
  let onlyCountry: CountryCode | undefined;
  let limit = 0;

  for (const arg of argv) {
    if (arg === "--ai") {
      ai = true;
    } else if (arg.startsWith("--country=")) {
      const c = arg.slice("--country=".length).toUpperCase();
      if (c === "US" || c === "AE" || c === "TR") {
        onlyCountry = c;
      } else {
        throw new Error(`unknown country "${c}" (expected US, AE, or TR)`);
      }
    } else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`invalid --limit "${arg}"`);
      }
      limit = Math.floor(n);
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }

  return { ai, onlyCountry, limit, trigger: "manual" };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log(
    `healthcheck start (country=${options.onlyCountry ?? "all"}, ` +
      `limit=${options.limit || "none"}, ai=${options.ai})`,
  );
  await runCrawl(options);
}

main()
  .catch((err) => {
    console.error("healthcheck failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());