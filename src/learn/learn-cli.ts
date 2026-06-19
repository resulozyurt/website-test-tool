/**
 * Live-render learning CLI.
 *
 * Captures the live site (read-only) and writes proposed manual expectations to
 * learn-output/proposals.json for human review. Nothing is saved to the
 * database here. After reviewing, run `npm run learn:apply`.
 *
 * Usage: npm run learn
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ManifestError } from "../manifest/client.js";
import { buildProposals } from "./learn.js";

const OUTPUT_DIR = "learn-output";

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const file = await buildProposals(OUTPUT_DIR);
  const path = join(OUTPUT_DIR, "proposals.json");
  await writeFile(path, JSON.stringify(file, null, 2), "utf8");

  console.log("\n=== learn: proposed expectations ===\n");
  for (const p of file.proposals) {
    console.log(`[${p.country}/${p.language}] ${p.pageKey}  approved=${p.approved}`);
    console.log(`  heading : ${p.payload.heading?.contains ?? "(none)"}`);
    console.log(`  cta     : ${p.payload.cta?.primary ?? "(none)"}`);
    console.log(`  phone   : ${p.payload.phone?.equals ?? "(none)"}`);
    console.log(
      `  price   : ${
        p.payload.price
          ? `visible=${p.payload.price.visible ?? "?"}` +
            (p.payload.price.currency ? ` currency=${p.payload.price.currency}` : "")
          : "(n/a)"
      }`,
    );
    for (const note of p.notes) {
      console.log(`  note    : ${note}`);
    }
  }

  console.log(`\nsaved: ${path}`);
  console.log(
    "Review the file. Set approved:false for anything you don't want, fix any " +
      "flagged values, then run: npm run learn:apply",
  );
}

main().catch((err) => {
  if (err instanceof ManifestError) {
    console.error(`\nmanifest error: ${err.message}`);
  } else {
    console.error("learn failed:", err);
  }
  process.exitCode = 1;
});