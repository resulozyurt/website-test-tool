/**
 * Auto-apply layer for live-render learning (fully automatic mode).
 *
 * Takes the proposals produced by buildProposals() and writes them straight to
 * the `expectations` table as source='auto' -- no human review file. This is
 * the "the system learns the country rules by itself" path the owner asked for.
 *
 * Safety model (priority: manual > auto > manifest):
 *   - Only proposals that buildProposals marked `approved` are applied. That
 *     flag is already false for any unhealthy capture or wrong-geo page (the
 *     site detected a different country), so a page measured through a
 *     misbehaving proxy is never learned as ground truth.
 *   - A human 'manual' row is never overwritten (auto yields to manual).
 *   - Money-critical anomalies (e.g. a price appearing where the manifest says
 *     it should be hidden) are surfaced as flags in the report and NOT silently
 *     trusted. The written payload keeps the manifest's price decision -- the
 *     render never flips a price rule -- so auto-learn cannot turn a real leak
 *     into an accepted baseline; it only records the flag for a human to see.
 *
 * Non-approved proposals are reported as `held` (they need attention) rather
 * than applied. The whole apply runs inside the caller's transaction client.
 */

import type { Executor } from "../db/repository.js";
import {
  getExpectationByMarketPage,
  getMarketByCountryLanguage,
  getPageByKey,
  upsertExpectation,
} from "../db/repository.js";
import { checksumOf } from "../manifest/checksum.js";
import type { LearnedProposal, ProposalsFile } from "./learn.js";

export type AutoOutcome = "applied" | "held" | "skipped";

export interface AutoEntry {
  country: string;
  language: string;
  pageKey: string;
  outcome: AutoOutcome;
  /** True when the proposal carried a money-critical (price) anomaly note. */
  moneyFlag: boolean;
  reason: string | null;
}

export interface AutoReport {
  entries: AutoEntry[];
  applied: number;
  held: number;
  skipped: number;
  /** Count of applied/held entries carrying a money-critical flag. */
  moneyFlags: number;
}

/** A note mentioning price/currency is treated as a money-critical flag. */
function hasMoneyFlag(proposal: LearnedProposal): boolean {
  return proposal.notes.some((n) => /price|currency|fiyat/i.test(n));
}

/**
 * Applies every approved proposal as source='auto'. Requires the markets/pages
 * to be seeded (buildProposals uses the config matrix; rows are resolved here).
 */
export async function applyProposalsAuto(
  file: ProposalsFile,
  exec: Executor,
): Promise<AutoReport> {
  const entries: AutoEntry[] = [];

  for (const p of file.proposals) {
    const moneyFlag = hasMoneyFlag(p);
    const base = {
      country: p.country,
      language: p.language,
      pageKey: p.pageKey,
      moneyFlag,
    };

    // Not approved by the learner (unhealthy capture or wrong geo) -> hold.
    if (!p.approved) {
      entries.push({
        ...base,
        outcome: "held",
        reason: p.notes[0] ?? "not approved by learner",
      });
      continue;
    }

    const market = await getMarketByCountryLanguage(p.country, p.language, exec);
    const page = await getPageByKey(p.pageKey, exec);
    if (!market || !page) {
      entries.push({
        ...base,
        outcome: "skipped",
        reason: "market/page not seeded (run npm run seed)",
      });
      continue;
    }

    // Never clobber a human override.
    const existing = await getExpectationByMarketPage(market.id, page.id, exec);
    if (existing && existing.source === "manual") {
      entries.push({
        ...base,
        outcome: "skipped",
        reason: "manual override present; left untouched",
      });
      continue;
    }

    await upsertExpectation(
      {
        marketId: market.id,
        pageId: page.id,
        source: "auto",
        payload: p.payload,
        checksum: checksumOf(p.payload),
      },
      exec,
    );
    entries.push({
      ...base,
      outcome: "applied",
      reason: moneyFlag ? "applied with money-critical flag (review)" : null,
    });
  }

  const count = (o: AutoOutcome): number =>
    entries.filter((e) => e.outcome === o).length;

  return {
    entries,
    applied: count("applied"),
    held: count("held"),
    skipped: count("skipped"),
    moneyFlags: entries.filter((e) => e.moneyFlag && e.outcome !== "skipped").length,
  };
}
