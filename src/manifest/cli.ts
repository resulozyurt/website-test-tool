/**
 * Manifest reader CLI.
 *
 * Fetches the live manifest, validates it, writes it to manifest-output/, and
 * prints the coverage summary plus the expectations derived for each active
 * market+page. Read-only against the site; no database writes (that is Step 3).
 *
 * Usage: npm run manifest
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchManifest, manifestUrl, ManifestError } from "./client.js";
import { mapManifestToExpectations } from "./map.js";

const OUTPUT_DIR = "manifest-output";

async function main(): Promise<void> {
  console.log(`Fetching manifest: ${manifestUrl(true)}`);
  const manifest = await fetchManifest({ fresh: true });

  await mkdir(OUTPUT_DIR, { recursive: true });
  const file = join(OUTPUT_DIR, "manifest.json");
  await writeFile(file, JSON.stringify(manifest, null, 2), "utf8");

  const c = manifest.coverage;
  console.log(`\nmanifest ${manifest.manifest_version}  (generated ${manifest.generated_at})`);
  console.log(`site      : ${manifest.site}`);
  console.log(`languages : ${manifest.languages.map((l) => l.code).join(", ")}`);
  console.log(
    `coverage  : pages=${c.pages_scanned} templates=${c.templates_scanned} ` +
      `geoRules=${c.geo_rule_count} structural=${c.structural_rule_count} unrecognized=${c.unrecognized_count}`,
  );
  if (manifest.unrecognized_rules.length > 0) {
    console.log(
      `note      : ${manifest.unrecognized_rules.length} unrecognized rule(s); review if any look geo/price related ` +
        `(content toggles like mb_page_* are expected and harmless).`,
    );
  }

  console.log(`\n=== derived expectations (source: manifest) ===`);
  for (const m of mapManifestToExpectations(manifest)) {
    const e = m.expectation;
    console.log(`\n[${m.country}/${m.language}] ${m.pageKey}  (geoRules=${m.evidence.geoRuleCount}, slug=${m.evidence.geoRuleSlug ?? "global"})`);
    console.log(`  language : htmlLang=${e.language?.htmlLang} mustNotBe=${(e.language?.mustNotBe ?? []).join(",") || "-"}`);
    console.log(`  cta      : primary=${e.cta?.primary ?? "(none)"}  mustNot=${(e.cta?.mustNotContain ?? []).join(" / ") || "-"}`);
    console.log(`  price    : ${e.price ? `visible=${e.price.visible}${e.price.currency ? ` currency=${e.price.currency}` : ""}` : "(n/a)"}`);
    console.log(`  heading  : ${e.heading?.contains ?? "(n/a)"}`);
  }

  console.log(`\nsaved: ${file}`);
}

main().catch((err) => {
  if (err instanceof ManifestError) {
    console.error(`\nmanifest error: ${err.message}`);
    if (err.bodySnippet) {
      console.error(`body: ${err.bodySnippet}`);
    }
  } else {
    console.error("manifest run failed:", err);
  }
  process.exitCode = 1;
});
