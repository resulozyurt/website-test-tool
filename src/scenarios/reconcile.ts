/**
 * Reconciles scenario-bearing pages into the `pages` table so the sweep visits
 * them. Pages already served by an existing row (home, pricing, ...) are left
 * alone; only "extra" scenario pages get a new per-language row. The runner
 * matches scenarios at run time by (url, country), so no schema change is
 * needed here.
 */

import { listPages, upsertPage } from "../db/repository.js";
import type { LanguageCode } from "../types.js";
import { listScenarioPages } from "./store.js";

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export interface ReconcileResult {
  created: string[];
  skipped: number;
}

export async function reconcilePages(): Promise<ReconcileResult> {
  const scenarioPages = await listScenarioPages();
  const existing = await listPages(false);

  // Signatures (language|path) already served by some page row.
  const served = new Set<string>();
  for (const page of existing) {
    for (const [lang, path] of Object.entries(page.pathByLanguage)) {
      served.add(`${lang}|${path}`);
    }
  }

  const created: string[] = [];
  let skipped = 0;

  for (const sp of scenarioPages) {
    const path = pathOf(sp.pageUrl);
    const lang = sp.language as LanguageCode;
    const signature = `${lang}|${path}`;

    if (served.has(signature)) {
      skipped += 1;
      continue;
    }

    const slug =
      sp.pageSlug && sp.pageSlug.trim() !== "" ? sp.pageSlug : "home";
    const key = `${slug}-${lang}`;
    await upsertPage({
      key,
      pathByLanguage: { [lang]: path } as Partial<Record<LanguageCode, string>>,
      isActive: true,
    });
    served.add(signature);
    created.push(`${key} (${lang}: ${path})`);
  }

  return { created, skipped };
}
