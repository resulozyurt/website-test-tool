/**
 * Scenario generation CLI (single page, print-only). Fetches a page's inventory
 * and prints the per-country scenarios it produces, so we can confirm the
 * generator before persisting and wiring it into the runner. Read-only; no DB.
 *
 * Usage:
 *   npx tsx src/scenarios/generate-cli.ts --url=https://www.fieldpie.com/pricing/
 *   npx tsx src/scenarios/generate-cli.ts --post-id=32
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ManifestError } from "../manifest/client.js";
import { fetchInventory } from "../manifest/inventory.js";
import {
  countriesForLanguage,
  generateScenarios,
  type Scenario,
} from "./generate.js";

const OUTPUT_DIR = "discovery-output";

function parseArgs(argv: string[]): { postId?: number; url?: string } {
  const out: { postId?: number; url?: string } = {};
  for (const arg of argv) {
    const pid = arg.match(/^--post-id=(\d+)$/);
    if (pid) {
      out.postId = Number(pid[1]);
    }
    const u = arg.match(/^--url=(.+)$/);
    if (u) {
      out.url = u[1];
    }
    if (/^\d+$/.test(arg)) {
      out.postId = Number(arg);
    }
  }
  return out;
}

function printForCountry(country: string, scenarios: Scenario[]): void {
  const mine = scenarios.filter((s) => s.country === country);
  const present = mine.filter((s) => s.expectation === "present");
  const absent = mine.filter((s) => s.expectation === "absent");

  console.log(`\n[${country}]  present=${present.length}  absent=${absent.length}`);
  const line = (s: Scenario) => {
    const money = s.moneyCritical ? " $MONEY" : "";
    const src = s.inherited ? "inh" : "dir";
    return `    ${s.kind.padEnd(12)} ${src}  ${s.label}${money}`;
  };
  if (present.length) {
    console.log("  must be PRESENT:");
    for (const s of present) console.log(line(s));
  }
  if (absent.length) {
    console.log("  must be ABSENT:");
    for (const s of absent) console.log(line(s));
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.postId && !args.url) {
    console.error(
      "Usage: npx tsx src/scenarios/generate-cli.ts --url=<page url>   (or --post-id=NNN)",
    );
    process.exitCode = 1;
    return;
  }

  const inventory = await fetchInventory({ ...args, fresh: true });
  const countries = countriesForLanguage(inventory.page.language);

  console.log(`page:  ${inventory.page.url}`);
  console.log(
    `lang:  ${inventory.page.language ?? "?"}  -> markets: ${countries.join(", ") || "(none active)"}`,
  );

  if (countries.length === 0) {
    console.log(
      "\nNo active market for this page's language; nothing to generate (e.g. es pages until the es market is added).",
    );
    return;
  }

  const scenarios = generateScenarios(inventory);
  console.log(`total scenarios: ${scenarios.length}`);
  for (const country of countries) {
    printForCountry(country, scenarios);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const out = join(OUTPUT_DIR, `scenarios-${inventory.page.post_id}.json`);
  await writeFile(
    out,
    JSON.stringify({ page: inventory.page, scenarios }, null, 2),
    "utf8",
  );
  console.log(`\nsnapshot -> ${out}`);
}

main().catch((err) => {
  if (err instanceof ManifestError) {
    console.error(`\ngenerate error: ${err.message}`);
  } else {
    console.error("generate failed:", err);
  }
  process.exitCode = 1;
});
