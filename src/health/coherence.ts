/**
 * Button/link text-vs-target coherence analysis for the health crawl.
 *
 * Reads the links already collected by functional.ts (text + resolved href) and
 * flags anchors whose visible text clearly names a destination but whose target
 * points somewhere else (a different known section, or the home page). This is
 * the "the button text and its link don't match" check.
 *
 * Deterministic, read-only, and deliberately conservative: an intent must match
 * the text, the resolved target must contain NONE of that intent's expected
 * tokens, and the target must be a real navigation URL. Ambiguous text is
 * skipped. Findings are advisory (minor) by design -- they surface in the panel
 * without failing a page, since intent inference is heuristic.
 *
 * All comparison is done on folded strings (lowercase, Turkish dotted/dotless I
 * and common accents normalized) so "FİYATLANDIRMA" and "/fiyatlandirma/" match.
 */

import {
  HOME_PATHS,
  LINK_INTENTS,
  type LinkIntent,
} from "../config/coherence.js";
import type { FunctionalSignals, LinkInfo } from "./functional.js";

/** One text-vs-target mismatch, ready to be turned into a finding. */
export interface CoherenceMismatch {
  text: string;
  href: string;
  intentId: string;
  intentLabel: string;
  /** Why it was flagged: "home" (named intent -> home) or "other" (-> elsewhere). */
  reason: "home" | "other";
}

/**
 * Folds a string for tolerant matching: normalizes the Turkish dotted/dotless I
 * family and a few common accented Latin letters to plain ASCII, strips the rest
 * of the combining marks, then lowercases. Mirrors functional.ts's foldForMatch
 * so both checks agree on what "the same word" means. Runs in Node.
 */
function fold(input: string): string {
  return input
    .replace(/[İIı]/g, "i")
    .replace(/[ığ]/g, (c) => (c === "ı" ? "i" : "g"))
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The path portion of a resolved URL, folded and trailing-slash-normalized. */
function foldedPath(resolved: string): string | null {
  try {
    const u = new URL(resolved);
    let path = u.pathname.toLowerCase();
    if (!path.endsWith("/")) {
      path += "/";
    }
    return path;
  } catch {
    return null;
  }
}

/** First intent whose text tokens appear in the folded link text, or null. */
function matchIntent(foldedText: string): LinkIntent | null {
  if (foldedText.length < 2) {
    return null;
  }
  for (const intent of LINK_INTENTS) {
    for (const token of intent.textIncludes) {
      if (foldedText.includes(token)) {
        return intent;
      }
    }
  }
  return null;
}

/** True when the resolved href satisfies the intent (contains an expected token). */
function targetSatisfiesIntent(foldedResolved: string, intent: LinkIntent): boolean {
  return intent.hrefIncludes.some((token) => foldedResolved.includes(token));
}

/** Analyzes one link; returns a mismatch or null. */
function analyzeLink(link: LinkInfo): CoherenceMismatch | null {
  // Only real anchors with a resolved navigation target are eligible. Buttons
  // (JS-driven), broken hrefs, mailto/tel/hash, and non-anchors are out of scope.
  if (link.tag !== "a" || link.brokenHref || !link.resolved) {
    return null;
  }
  const text = (link.text || "").trim();
  if (text.length < 2) {
    return null;
  }

  const foldedText = fold(text);
  const intent = matchIntent(foldedText);
  if (!intent) {
    return null; // text does not clearly name a known destination
  }

  const foldedResolved = fold(link.resolved);
  if (targetSatisfiesIntent(foldedResolved, intent)) {
    return null; // coherent: target contains an expected token
  }

  // Not satisfied. Distinguish "went to home" (strong signal) from "went to
  // some other section" (still a mismatch, but reported as 'other').
  const path = foldedPath(link.resolved);
  const reason: CoherenceMismatch["reason"] =
    path && HOME_PATHS.includes(path) ? "home" : "other";

  return {
    text: text.slice(0, 80),
    href: link.resolved,
    intentId: intent.id,
    intentLabel: intent.label,
    reason,
  };
}

/**
 * Returns every text-vs-target mismatch on the page. Deduplicated by
 * text+href so a link repeated in header and footer is reported once.
 */
export function analyzeLinkCoherence(
  signals: FunctionalSignals,
): CoherenceMismatch[] {
  const out: CoherenceMismatch[] = [];
  const seen = new Set<string>();
  for (const link of signals.links) {
    const mismatch = analyzeLink(link);
    if (!mismatch) {
      continue;
    }
    const key = `${fold(mismatch.text)}::${mismatch.href}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(mismatch);
  }
  return out;
}
