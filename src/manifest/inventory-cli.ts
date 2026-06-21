/**
 * Inventory dump CLI. Fetches the per-page inventory from the WordPress plugin
 * and prints a summary plus every geo-conditioned element (its own condition or
 * one inherited from an ancestor container), so we can eyeball exactly what the
 * scenario generator will turn into per-country checks. Read-only; no database.
 *
 * Usage:
 *   npx tsx src/manifest/inventory-cli.ts --url=https://www.fieldpie.com/pricing/
 *   npx tsx src/manifest/inventory-cli.ts --post-id=32
 *   npm run inventory -- --post-id=32
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ManifestError } from "./client.js";
import {
  effectiveGeo,
  fetchInventory,
  indexElements,
  type Inventory,
} from "./inventory.js";

const OUTPUT_DIR = "discovery-output";

// Element kinds worth showing in the geo summary (skip bare layout wrappers
// unless they carry their own condition, which effectiveGeo already surfaces).
const MEANINGFUL_KINDS = new Set([
  "button",
  "link",
  "heading",
  "text",
  "media",
  "form",
]);

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

function printGeo(inventory: Inventory): void {
  const byId = indexElements(inventory);
  const rows: string[] = [];

  for (const [id, el] of byId) {
    const geo = effectiveGeo(id, byId);
    if (!geo) {
      continue;
    }
    // Show elements gated on their own condition always; for inherited gating,
    // only show meaningful kinds to keep the list readable.
    if (geo.inherited && !MEANINGFUL_KINDS.has(el.kind)) {
      continue;
    }
    const rule = `${geo.op} ${geo.country}`.padEnd(8);
    const tag = geo.inherited ? "inherited" : "direct   ";
    rows.push(`  ${rule} ${tag}  ${el.kind.padEnd(8)} ${el.label}`);
  }

  console.log(`geo-conditioned elements shown: ${rows.length}`);
  console.log("  rule     source     kind     label");
  console.log("  -------------------------------------------------");
  for (const row of rows) {
    console.log(row);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.postId && !args.url) {
    console.error(
      "Usage: npx tsx src/manifest/inventory-cli.ts --url=<page url>   (or --post-id=NNN)",
    );
    process.exitCode = 1;
    return;
  }

  const inventory = await fetchInventory({ ...args, fresh: true });

  console.log(`page:  ${inventory.page.url}`);
  console.log(
    `title: ${inventory.page.title}  | lang: ${inventory.page.language ?? "?"} | post_id: ${inventory.page.post_id}`,
  );
  console.log(`inventory v${inventory.inventory_version}`);
  console.log(
    `sections=${inventory.coverage.section_count} ` +
      `elements=${inventory.coverage.element_count} ` +
      `conditional=${inventory.coverage.conditional_element_count}\n`,
  );

  printGeo(inventory);

  await mkdir(OUTPUT_DIR, { recursive: true });
  const out = join(OUTPUT_DIR, `inventory-${inventory.page.post_id}.json`);
  await writeFile(out, JSON.stringify(inventory, null, 2), "utf8");
  console.log(`\nsnapshot -> ${out}`);
}

main().catch((err) => {
  if (err instanceof ManifestError) {
    console.error(`\ninventory error: ${err.message}`);
  } else {
    console.error("inventory failed:", err);
  }
  process.exitCode = 1;
});
