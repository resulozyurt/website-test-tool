/**
 * Scenario generator. Turns a page's inventory (sections, conditions, elements)
 * into per-country visibility scenarios that the runner can verify in the live
 * DOM.
 *
 * Rules (deliberately asymmetric to avoid false positives):
 *  - A geo condition that resolves to "hide for country C" produces an `absent`
 *    scenario. This is safe: a failing geo gate hides the element regardless of
 *    any other (plan/layout) condition, so a geo-hidden element that still
 *    appears is a real leak (e.g. the price showing to a non-US visitor).
 *  - A geo condition that resolves to "show for C" produces a `present`
 *    scenario ONLY when nothing else in the element's ancestry could hide it
 *    (no non-geo conditions). Otherwise we cannot guarantee presence, so we
 *    skip the `present` assertion.
 *
 * Target country set comes from the page language via the active MARKETS
 * (en -> US, AE; tr -> TR; languages with no active market are skipped).
 *
 * The DOM selector is `.brxe-<element_id>` (Bricks renders each element with
 * that class), so checks target a specific element instead of matching text.
 */

import { MARKETS } from "../config/targets.js";
import {
  indexElements,
  type Inventory,
  type InventoryElement,
} from "../manifest/inventory.js";

export interface Scenario {
  country: string;
  elementId: string;
  selector: string;
  kind: string;
  label: string;
  expectation: "present" | "absent";
  rule: string;
  inherited: boolean;
  moneyCritical: boolean;
}

/** Layout/non-visual wrappers we do not assert on directly. */
const EXCLUDE_KINDS = new Set(["container", "code", "shortcode", "template"]);

/** Heuristic flag for money-critical elements (prices, billing, pricing CTAs). */
const MONEY_RE = /\$|price|pricing|billed|fiyat/i;

export function countriesForLanguage(language: string | null): string[] {
  if (!language) {
    return [];
  }
  return MARKETS.filter((m) => m.isActive && m.language === language).map(
    (m) => m.country,
  );
}

function evalGeo(
  op: string,
  ruleCountry: string,
  country: string,
): boolean | null {
  if (op === "==") {
    return country === ruleCountry;
  }
  if (op === "!=") {
    return country !== ruleCountry;
  }
  return null; // unknown operator -> cannot decide
}

/** The element and its ancestors, nearest first. */
function chain(
  id: string,
  byId: Map<string, InventoryElement>,
): InventoryElement[] {
  const out: InventoryElement[] = [];
  let current = byId.get(id);
  let guard = 0;
  while (current && guard < 100) {
    out.push(current);
    if (!current.parent || current.parent === "0") {
      break;
    }
    current = byId.get(current.parent);
    guard += 1;
  }
  return out;
}

export function generateScenarios(inventory: Inventory): Scenario[] {
  const byId = indexElements(inventory);
  const countries = countriesForLanguage(inventory.page.language);
  if (countries.length === 0) {
    return [];
  }

  const scenarios: Scenario[] = [];

  for (const [id, el] of byId) {
    if (EXCLUDE_KINDS.has(el.kind)) {
      continue;
    }

    const els = chain(id, byId);
    const geoConds: { op: string; country: string; inherited: boolean }[] = [];
    let nonGeoCount = 0;
    els.forEach((e, index) => {
      for (const c of e.conditions) {
        if (c.is_geo && c.country) {
          geoConds.push({ op: c.op, country: c.country, inherited: index > 0 });
        } else {
          nonGeoCount += 1;
        }
      }
    });

    if (geoConds.length === 0) {
      continue; // not gated on country
    }
    // Ambiguity guard: conflicting geo targets in the chain -> skip.
    if (new Set(geoConds.map((g) => g.country)).size > 1) {
      continue;
    }

    const primary = geoConds[0];
    const rule = `${primary.op} ${primary.country}`;
    const moneyCritical = MONEY_RE.test(el.label);

    for (const country of countries) {
      const visible = evalGeo(primary.op, primary.country, country);
      if (visible === null) {
        continue;
      }
      if (!visible) {
        scenarios.push({
          country,
          elementId: id,
          selector: `.brxe-${id}`,
          kind: el.kind,
          label: el.label,
          expectation: "absent",
          rule,
          inherited: primary.inherited,
          moneyCritical,
        });
      } else if (nonGeoCount === 0) {
        scenarios.push({
          country,
          elementId: id,
          selector: `.brxe-${id}`,
          kind: el.kind,
          label: el.label,
          expectation: "present",
          rule,
          inherited: primary.inherited,
          moneyCritical,
        });
      }
    }
  }

  return scenarios;
}
