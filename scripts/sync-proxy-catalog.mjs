/**
 * Keeps the dashboard's copy of the proxy catalogue and crypto in step with
 * the runner's.
 *
 * Railway builds the dashboard with `dashboard/` as its root directory, so the
 * panel cannot import from `src/`. Rather than let two hand-maintained
 * catalogues drift -- which would show the operator one set of fields while
 * the runner builds a URL from another -- the runner's files are the source of
 * truth and are copied here, with a header marking them generated.
 *
 *   node scripts/sync-proxy-catalog.mjs          # write the copies
 *   node scripts/sync-proxy-catalog.mjs --check  # fail if they are stale
 *
 * The check runs as part of `npm run typecheck`, so a forgotten sync breaks
 * the build instead of shipping a mismatch.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const HEADER = `// GENERATED FILE -- do not edit.
// Source: %SOURCE%
// Run \`npm run catalog:sync\` in the repository root after changing it.
`;

/** The runner imports CountryCode from src/types.ts; the panel has no such path. */
const COUNTRY_TYPE = `export type CountryCode = "US" | "AE" | "TR";\n`;

const FILES = [
  {
    source: "src/config/proxy-providers.ts",
    target: "dashboard/lib/proxy-providers.generated.ts",
    transform: (text) =>
      text.replace(
        /import type \{ CountryCode \} from "\.\.\/types\.js";\n/,
        COUNTRY_TYPE,
      ),
  },
  {
    source: "src/proxy/crypto.ts",
    target: "dashboard/lib/proxyCrypto.generated.ts",
    transform: (text) => text,
  },
];

let stale = false;
const check = process.argv.includes("--check");

for (const file of FILES) {
  const source = readFileSync(join(root, file.source), "utf8");
  const body = file.transform(source);
  const wanted = HEADER.replace("%SOURCE%", file.source) + "\n" + body;
  let current = null;
  try {
    current = readFileSync(join(root, file.target), "utf8");
  } catch {
    current = null;
  }
  if (current === wanted) {
    continue;
  }
  if (check) {
    console.error(`stale: ${file.target} (run \`npm run catalog:sync\`)`);
    stale = true;
    continue;
  }
  writeFileSync(join(root, file.target), wanted, "utf8");
  console.log(`wrote ${file.target}`);
}

if (stale) {
  process.exitCode = 1;
} else if (check) {
  console.log("proxy catalogue copies are up to date");
}
