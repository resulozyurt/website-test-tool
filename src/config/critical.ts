/**
 * The daily "critical page" scope.
 *
 * Both lanes (geo sweep and health crawl) run in one of two scopes:
 *
 *   critical -- the funnel pages flagged `isCritical` in config/targets.ts,
 *               visited every day in every active market;
 *   full     -- everything the site inventory knows about, once a week.
 *
 * This module is the single place that turns the page config into the shapes
 * the two lanes need, so "add a daily page" stays a one-line change in
 * config/targets.ts.
 */

import type { LanguageCode, PageConfig } from "../types.js";
import { env } from "./env.js";
import { PAGES } from "./targets.js";

export type Scope = "critical" | "full";

/** Active pages in the daily set, in config order. */
export const CRITICAL_PAGES: PageConfig[] = PAGES.filter(
  (page) => page.isActive && page.isCritical,
);

/** Page keys in the daily set (e.g. ['home','pricing','demo','free-trial']). */
export const CRITICAL_PAGE_KEYS: string[] = CRITICAL_PAGES.map((p) => p.key);

/**
 * Canonical form of a path for comparison: lower-cased, leading slash, exactly
 * one trailing slash. `/Pricing` and `/pricing/` both become `/pricing/`.
 */
export function normalizePath(path: string): string {
  let out = (path || "/").trim().toLowerCase();
  const hash = out.indexOf("#");
  if (hash >= 0) {
    out = out.slice(0, hash);
  }
  const query = out.indexOf("?");
  if (query >= 0) {
    out = out.slice(0, query);
  }
  if (!out.startsWith("/")) {
    out = `/${out}`;
  }
  if (!out.endsWith("/")) {
    out = `${out}/`;
  }
  return out;
}

/** One daily target: which page, at which path/URL, for one language. */
export interface CriticalTarget {
  pageKey: string;
  path: string;
  url: string;
  /**
   * True when this language has no translation of its own and falls back to
   * the English URL (currently the trial funnel). Language expectations are
   * relaxed for these, since the page is legitimately English everywhere.
   */
  sharedWithEnglish: boolean;
}

function absoluteUrl(path: string): string {
  return `${env.TARGET_BASE_URL.replace(/\/+$/, "")}${path}`;
}

/** The daily targets for one language, in config order. */
export function criticalTargets(language: LanguageCode): CriticalTarget[] {
  const out: CriticalTarget[] = [];
  for (const page of CRITICAL_PAGES) {
    const path = page.pathByLanguage[language];
    if (!path) {
      continue;
    }
    const englishPath = page.pathByLanguage.en;
    out.push({
      pageKey: page.key,
      path: normalizePath(path),
      url: absoluteUrl(normalizePath(path)),
      sharedWithEnglish:
        language !== "en" && Boolean(englishPath) && englishPath === path,
    });
  }
  return out;
}

/** Canonical paths of the daily set for one language. */
export function criticalPaths(language: LanguageCode): string[] {
  return criticalTargets(language).map((t) => t.path);
}

/** Whether a path belongs to the daily set for a language. */
export function isCriticalPath(path: string, language: LanguageCode): boolean {
  const wanted = normalizePath(path);
  return criticalPaths(language).includes(wanted);
}
