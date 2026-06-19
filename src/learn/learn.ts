/**
 * Live-render learning (Phase 3, Step 3b).
 *
 * Visits each active market+page once (read-only), reads what the live page
 * actually shows, and proposes a complete expectation per market+page:
 *   proposal = manifest expectation  +  values learned from the render
 *             (real H1 heading, phone, normalized CTA text).
 *
 * Proposals are written to a JSON file for human review; nothing is saved to
 * the database here. `npm run learn:apply` writes the approved ones as
 * source='manual'.
 */

import { join } from "node:path";
import "dotenv/config";
import { env } from "../config/env.js";
import { MARKETS, PAGES } from "../config/targets.js";
import type { CountryCode, ExpectationSet, LanguageCode } from "../types.js";
import { capturePage } from "../runner/capture.js";
import { proxyEnvKey, resolveProxy } from "../runner/proxy.js";
import { fetchManifest } from "../manifest/client.js";
import { mapManifestToExpectations } from "../manifest/map.js";

export interface ProposalEvidence {
  firstHeading: string;
  phoneNumbers: string[];
  ctaCandidates: string[];
  currencySymbols: string[];
  hasStartFreeTrial: boolean;
  hasBookDemo: boolean;
  httpStatus: number | null;
  exitCountry: string | null;
}

export interface LearnedProposal {
  country: CountryCode;
  language: LanguageCode;
  pageKey: string;
  /** Set to false in the JSON to skip this one on apply. */
  approved: boolean;
  source: "manual";
  payload: ExpectationSet;
  evidence: ProposalEvidence;
  notes: string[];
}

export interface ProposalsFile {
  generatedAt: string;
  target: string;
  proposals: LearnedProposal[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merges `over` onto `base` at sub-object granularity (over wins). */
function merge(base: ExpectationSet, over: ExpectationSet): ExpectationSet {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, overVal] of Object.entries(over as Record<string, unknown>)) {
    if (overVal === undefined) {
      continue;
    }
    const baseVal = out[key];
    out[key] =
      isPlainObject(baseVal) && isPlainObject(overVal)
        ? { ...baseVal, ...overVal }
        : overVal;
  }
  return out as ExpectationSet;
}

/**
 * Captures every active market+page and produces a proposal list. The browser
 * writes a screenshot per page under `${outputDir}/screenshots`.
 */
export async function buildProposals(outputDir: string): Promise<ProposalsFile> {
  const manifest = await fetchManifest({ fresh: true });

  const baseByKey = new Map<string, ExpectationSet>();
  for (const m of mapManifestToExpectations(manifest)) {
    baseByKey.set(`${m.country}::${m.language}::${m.pageKey}`, m.expectation);
  }

  const proposals: LearnedProposal[] = [];

  for (const market of MARKETS) {
    if (!market.isActive) {
      continue;
    }
    const proxy = resolveProxy(market.country);

    for (const page of PAGES) {
      if (!page.isActive) {
        continue;
      }
      const path = page.pathByLanguage[market.language];
      if (!path) {
        continue;
      }

      if (!proxy) {
        console.warn(
          `skip ${market.country}/${market.language}/${page.key}: no proxy (${proxyEnvKey(market.country)})`,
        );
        continue;
      }

      const base = baseByKey.get(`${market.country}::${market.language}::${page.key}`) ?? {};
      const url = new URL(path, env.TARGET_BASE_URL).toString();
      console.log(`learn ${market.country}/${market.language}/${page.key} ${url} ...`);

      const screenshotPath = join(
        outputDir,
        "screenshots",
        `${market.country}-${market.language}-${page.key}.png`,
      );
      const capture = await capturePage({
        url,
        country: market.country,
        proxy,
        screenshotPath,
      });

      const markers = capture.markers;
      const notes: string[] = [];
      const evidence: ProposalEvidence = {
        firstHeading: markers?.firstHeading ?? "",
        phoneNumbers: markers?.phoneNumbers ?? [],
        ctaCandidates: markers?.ctaCandidates ?? [],
        currencySymbols: markers?.currencySymbols ?? [],
        hasStartFreeTrial: markers?.hasStartFreeTrial ?? false,
        hasBookDemo: markers?.hasBookDemo ?? false,
        httpStatus: capture.cache?.httpStatus ?? null,
        exitCountry: capture.exit.country ?? null,
      };

      // Unhealthy capture: keep manifest base, do not approve automatically.
      if (capture.error || !markers || capture.cache?.httpStatus !== 200) {
        notes.push(
          `capture not healthy (${capture.error ?? `http ${capture.cache?.httpStatus ?? "?"}`}); review before applying`,
        );
        proposals.push({
          country: market.country,
          language: market.language,
          pageKey: page.key,
          approved: false,
          source: "manual",
          payload: base,
          evidence,
          notes,
        });
        continue;
      }

      const learned: ExpectationSet = {};

      // Real heading text (fixes heading mismatches).
      if (markers.firstHeading) {
        learned.heading = { contains: markers.firstHeading };
      } else {
        notes.push("no <h1> heading detected");
      }

      // Phone (human verifies; first candidate is usually a tel: link).
      if (markers.phoneNumbers.length > 0) {
        learned.phone = { equals: markers.phoneNumbers[0] };
        if (markers.phoneNumbers.length > 1) {
          notes.push(`multiple phone candidates; using "${markers.phoneNumbers[0]}"`);
        }
      } else {
        notes.push("no phone detected");
      }

      // Normalize the manifest CTA to the actual rendered text, if found.
      if (base.cta?.primary) {
        const target = base.cta.primary.toLowerCase();
        const match =
          markers.ctaCandidates.find((c) => c.toLowerCase() === target) ??
          markers.ctaCandidates.find((c) => c.toLowerCase().includes(target));
        if (match) {
          learned.cta = { ...base.cta, primary: match };
        } else {
          notes.push(
            `manifest CTA "${base.cta.primary}" not found in rendered buttons; pick from evidence.ctaCandidates`,
          );
        }
      }

      // Money-critical sanity flag (do not auto-change the manifest decision).
      if (base.price?.visible === false && markers.currencySymbols.length > 0) {
        notes.push(
          `price expected hidden but currency present (${markers.currencySymbols.join(", ")}); confirm it is not a real price leak`,
        );
      }

      proposals.push({
        country: market.country,
        language: market.language,
        pageKey: page.key,
        approved: true,
        source: "manual",
        payload: merge(base, learned),
        evidence,
        notes,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    target: env.TARGET_BASE_URL,
    proposals,
  };
}