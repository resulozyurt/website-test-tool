/**
 * Page discovery. Reads the live site's sitemap (read-only GET), walks any
 * sitemap index, and classifies every URL into a DiscoveredPage (language,
 * slug, and whether it is excluded from testing). No browser, no side effects.
 *
 * Sitemaps are machine-generated and regular, so we extract <loc> values with a
 * focused regex rather than pulling in an XML parser dependency.
 */

import { env } from "../config/env.js";
import {
  classify,
  deriveSlug,
  detectLanguage,
  hostKey,
  sitemapCandidates,
  targetHostKey,
} from "../config/discovery.js";

export interface DiscoveredPage {
  url: string;
  path: string;
  language: string;
  slug: string | null;
  source: "sitemap" | "crawl";
  isExcluded: boolean;
  excludeReason: string | null;
}

export interface DiscoveryResult {
  usedSitemap: string | null;
  pages: DiscoveredPage[];
}

const MAX_SITEMAP_DEPTH = 3;
const LOC_RE = /<loc>\s*([^<]+?)\s*<\/loc>/gi;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  LOC_RE.lastIndex = 0;
  while ((match = LOC_RE.exec(xml)) !== null) {
    out.push(decodeEntities(match[1].trim()));
  }
  return out;
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/** Read-only GET, with the same allowlist headers the runner uses. */
async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.NAV_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: "application/xml,text/xml,*/*",
    };
    if (env.MONITOR_USER_AGENT) {
      headers["User-Agent"] = env.MONITOR_USER_AGENT;
    }
    if (env.MONITOR_HEADER_NAME && env.MONITOR_HEADER_VALUE) {
      headers[env.MONITOR_HEADER_NAME] = env.MONITOR_HEADER_VALUE;
    }
    const res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) {
      return null;
    }
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Walks a sitemap (recursing into index sitemaps) and returns page URLs. */
async function walkSitemap(
  xml: string,
  seen: Set<string>,
  depth: number,
): Promise<string[]> {
  const locs = extractLocs(xml);
  if (!isSitemapIndex(xml)) {
    return locs;
  }
  if (depth >= MAX_SITEMAP_DEPTH) {
    return [];
  }
  const out: string[] = [];
  for (const child of locs) {
    if (seen.has(child)) {
      continue;
    }
    seen.add(child);
    if (/\.gz(?:$|\?)/i.test(child)) {
      continue; // gzipped child sitemaps are skipped (kept dependency-free)
    }
    const childXml = await fetchText(child);
    if (!childXml) {
      continue;
    }
    out.push(...(await walkSitemap(childXml, seen, depth + 1)));
  }
  return out;
}

async function collectSitemapUrls(): Promise<{
  urls: string[];
  usedSitemap: string | null;
}> {
  for (const candidate of sitemapCandidates()) {
    const xml = await fetchText(candidate);
    if (!xml) {
      continue;
    }
    const urls = await walkSitemap(xml, new Set<string>([candidate]), 0);
    if (urls.length > 0) {
      return { urls, usedSitemap: candidate };
    }
  }
  return { urls: [], usedSitemap: null };
}

export async function discover(): Promise<DiscoveryResult> {
  const wantedHost = targetHostKey();
  const { urls, usedSitemap } = await collectSitemapUrls();

  const seen = new Set<string>();
  const pages: DiscoveredPage[] = [];

  for (const raw of urls) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (hostKey(parsed.hostname) !== wantedHost) {
      continue; // same-site only (tolerant of www.)
    }
    const normalized = `${parsed.origin}${parsed.pathname}`; // drop query/hash
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);

    const path = parsed.pathname;
    const { excluded, reason } = classify(path);
    pages.push({
      url: normalized,
      path,
      language: detectLanguage(path),
      slug: deriveSlug(path),
      source: "sitemap",
      isExcluded: excluded,
      excludeReason: reason,
    });
  }

  return { usedSitemap, pages };
}
