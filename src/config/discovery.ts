/**
 * Discovery configuration. Everything that decides "which URLs exist and which
 * ones we test" lives here, so extending it (a new language, a new excluded
 * section) is a one-line change.
 */

import { env } from "./env.js";

/** Path prefixes that mark a non-default language (Polylang structure). */
const LANGUAGE_PREFIXES: Record<string, string> = {
  tr: "tr",
  es: "es",
};

/**
 * Sections/paths that must NOT become test pages. Blog is the main one the
 * owner asked to skip; the rest are WordPress system/archive noise that can
 * appear in a sitemap index. First match wins.
 */
const EXCLUDE_PATTERNS: { test: RegExp; reason: string }[] = [
  { test: /^\/(?:(?:tr|es)\/)?blog(?:\/|$)/i, reason: "blog" },
  { test: /^\/(?:(?:tr|es)\/)?(?:author|category|tag)\//i, reason: "archive" },
  { test: /\/feed\/?$/i, reason: "feed" },
  { test: /\/wp-(?:content|admin|json|includes)\//i, reason: "wp-system" },
  { test: /\.(?:xml|gz|json|rss|txt)$/i, reason: "non-page" },
];

/** Absolute origin of the target site (protocol + host). */
export function targetOrigin(): string {
  return new URL(env.TARGET_BASE_URL).origin;
}

/** Host with a leading "www." stripped, for tolerant same-site comparison. */
export function hostKey(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

/** The target host key, computed once from TARGET_BASE_URL. */
export function targetHostKey(): string {
  return hostKey(new URL(env.TARGET_BASE_URL).hostname);
}

/**
 * Ordered list of sitemap URLs to try. An explicit SITEMAP_URL (read directly
 * from the environment, optional) wins; otherwise the common WordPress/SEO
 * defaults are attempted in turn.
 */
export function sitemapCandidates(): string[] {
  const base = env.TARGET_BASE_URL.replace(/\/+$/, "");
  const override = process.env.SITEMAP_URL?.trim();
  const list = [
    override,
    `${base}/sitemap_index.xml`,
    `${base}/sitemap.xml`,
    `${base}/wp-sitemap.xml`,
  ].filter((u): u is string => Boolean(u));
  return [...new Set(list)];
}

/** Best-effort language from a path prefix; defaults to 'en'. */
export function detectLanguage(path: string): string {
  for (const [language, prefix] of Object.entries(LANGUAGE_PREFIXES)) {
    if (new RegExp(`^/${prefix}(?:/|$)`, "i").test(path)) {
      return language;
    }
  }
  return "en";
}

/** Last non-language path segment, or null for a home/language-root path. */
export function deriveSlug(path: string): string | null {
  const segments = path.split("/").filter(Boolean);
  const first = segments[0]?.toLowerCase();
  if (first && Object.values(LANGUAGE_PREFIXES).includes(first)) {
    segments.shift();
  }
  const last = segments[segments.length - 1];
  return last ?? null;
}

/** Decides whether a path is excluded from testing, and why. */
export function classify(path: string): { excluded: boolean; reason: string | null } {
  for (const { test, reason } of EXCLUDE_PATTERNS) {
    if (test.test(path)) {
      return { excluded: true, reason };
    }
  }
  return { excluded: false, reason: null };
}
