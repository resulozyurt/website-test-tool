/**
 * Functional signals for the health crawl: are links/CTAs well-formed and
 * clickable, do their targets resolve, and is the market's primary CTA present?
 *
 * No clicking happens here (PROD is read-only, and clicking would be slow and
 * flaky). We read link metadata from the DOM, check clickability geometrically,
 * flag broken hrefs statically, and probe unique internal targets with HEAD
 * (falling back to GET on 403/405/501, which some WP/Cloudflare setups return
 * for HEAD). Real submit-through-the-form testing is a staging concern.
 *
 * Reachability probing is deduplicated crawl-wide: a shared LinkProbeCache
 * ensures each unique internal target is probed once across every page (and
 * even across in-flight parallel pages), which is the main cost fix -- nav and
 * footer links no longer get re-probed on every page.
 *
 * IMPORTANT: the page.evaluate body contains NO named function/arrow
 * declarations (tsx/esbuild keepNames would inject a browser-undefined
 * `__name`). All callbacks are anonymous and inline. The probe helpers below
 * run in Node (not serialized to the browser), so ordinary named functions are
 * fine there.
 */

import type { APIRequestContext, Page } from "playwright";
import type { CountryCode } from "../types.js";

/** One link/CTA as read from the DOM. */
export interface LinkInfo {
  text: string;
  href: string | null;
  /** Resolved absolute URL when href is a real navigation target, else null. */
  resolved: string | null;
  internal: boolean;
  /** Rendered and interactable: visible, non-zero size, not disabled, not covered. */
  clickable: boolean;
  /** href is empty, "#", or "javascript:void(0)" style (a dead control). */
  brokenHref: boolean;
  tag: string;
}

export interface FunctionalSignals {
  links: LinkInfo[];
  /** Total interactive elements considered. */
  total: number;
}

/**
 * Reads all anchors/buttons (and Bricks CTA-ish elements) from the page and
 * classifies each. Read-only. Never throws.
 */
export async function collectFunctionalSignals(
  page: Page,
): Promise<FunctionalSignals> {
  try {
    return await page.evaluate(() => {
      const origin = location.origin;
      const els = Array.from(document.querySelectorAll("a, button"));
      const out: {
        text: string;
        href: string | null;
        resolved: string | null;
        internal: boolean;
        clickable: boolean;
        brokenHref: boolean;
        tag: string;
      }[] = [];

      for (const node of els) {
        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();
        const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);

        const rawHref = el.getAttribute("href");
        let href: string | null = rawHref;
        let resolved: string | null = null;
        let internal = false;
        let brokenHref = false;

        if (tag === "a") {
          const h = (rawHref || "").trim();
          if (
            h === "" ||
            h === "#" ||
            h.toLowerCase().startsWith("javascript:")
          ) {
            brokenHref = true;
          } else if (
            h.startsWith("mailto:") ||
            h.startsWith("tel:") ||
            h.startsWith("#")
          ) {
            // Not a navigation target; ignore for reachability.
            resolved = null;
          } else {
            try {
              const u = new URL(h, origin);
              resolved = u.href.split("#")[0];
              internal = u.origin === origin;
            } catch {
              brokenHref = true;
            }
          }
        }

        // Clickability: visible, non-zero size, not disabled, not covered by
        // another element at its center point.
        let clickable = false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const sized = rect.width > 2 && rect.height > 2;
        const shown =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.pointerEvents !== "none" &&
          !(el as HTMLButtonElement).disabled;
        if (sized && shown) {
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          if (cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight) {
            const top = document.elementFromPoint(cx, cy);
            clickable = top != null && (top === el || el.contains(top) || top.contains(el));
          } else {
            // Off current viewport but rendered and sized -> treat as clickable.
            clickable = true;
          }
        }

        out.push({ text, href, resolved, internal, clickable, brokenHref, tag });
      }

      return { links: out, total: out.length };
    });
  } catch {
    return { links: [], total: 0 };
  }
}

/** One internal target that did not resolve to a healthy status. */
export interface DeadLink {
  url: string;
  status: number | null;
  method: string;
  error: string | null;
}

/**
 * Crawl-wide reachability cache: maps an absolute target URL to a settled (or
 * in-flight) probe result. `null` means the target was reachable/healthy. The
 * crawl creates one of these and passes it through every page so each unique
 * target is probed exactly once, and parallel pages share an in-flight probe.
 */
export type LinkProbeCache = Map<string, Promise<DeadLink | null>>;

/** Options for reachability probing (timeouts + optional crawl-wide cache). */
export interface ProbeOptions {
  /** Max unique internal targets to probe per page (politeness cap). */
  max: number;
  /** HEAD request timeout, ms. */
  headTimeoutMs: number;
  /** GET fallback timeout, ms. */
  getTimeoutMs: number;
  /** Shared cache so a target is probed once crawl-wide (optional). */
  cache?: LinkProbeCache;
}

/**
 * Probes ONE target: HEAD first, GET fallback on 403/405/501 (setups that
 * reject HEAD). Returns a DeadLink when unhealthy, or null when healthy. Runs in
 * Node against the proxy-bound request context; never throws.
 */
async function probeSingle(
  request: APIRequestContext,
  url: string,
  headTimeoutMs: number,
  getTimeoutMs: number,
): Promise<DeadLink | null> {
  let status: number | null = null;
  let method = "HEAD";
  try {
    let res = await request.head(url, { timeout: headTimeoutMs });
    status = res.status();
    if (status === 403 || status === 405 || status === 501) {
      method = "GET";
      res = await request.get(url, { timeout: getTimeoutMs });
      status = res.status();
    }
    if (status >= 400) {
      return { url, status, method, error: null };
    }
    return null;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { url, status, method, error };
  }
}

/**
 * Probes unique internal link targets for reachability, deduplicated crawl-wide
 * via the shared cache when provided. Returns only the unhealthy ones. Bounded
 * by `options.max` to stay polite. Uses the page's proxy-bound request context;
 * cached results from another page are just awaited values (no context needed).
 */
export async function probeInternalTargets(
  request: APIRequestContext,
  links: LinkInfo[],
  options: ProbeOptions,
): Promise<DeadLink[]> {
  const { max, headTimeoutMs, getTimeoutMs, cache } = options;

  const seen = new Set<string>();
  const targets: string[] = [];
  for (const link of links) {
    if (link.internal && link.resolved && !seen.has(link.resolved)) {
      seen.add(link.resolved);
      targets.push(link.resolved);
      if (targets.length >= max) {
        break;
      }
    }
  }

  const dead: DeadLink[] = [];
  for (const url of targets) {
    let pending: Promise<DeadLink | null>;
    const cached = cache?.get(url);
    if (cached) {
      pending = cached;
    } else {
      pending = probeSingle(request, url, headTimeoutMs, getTimeoutMs);
      if (cache) {
        cache.set(url, pending);
      }
    }
    const result = await pending;
    if (result) {
      dead.push(result);
    }
  }
  return dead;
}

/** The primary CTA a market must show, and where it should point. */
export interface ExpectedCta {
  /** Case-insensitive text the CTA should contain. */
  text: string;
  /** Optional substring the target href should contain (e.g. "get-demo"). */
  hrefContains?: string;
}

/**
 * Case-folds text for tolerant CTA matching. Turkish is the reason this is not
 * a plain `toLowerCase()`: the site renders CTAs in uppercase ("ÜCRETSİZ
 * DENEYİN") while config stores them in title case ("Ücretsiz Deneyin"), and
 * JS `toLowerCase()` turns the dotted capital "İ" (U+0130) into "i" + combining
 * dot (two code points), which then fails to equal a plain "i". We normalize
 * the dotted/dotless I variants to a plain ASCII "i" BEFORE lowercasing so both
 * forms fold to the same string. Runs in Node (safe to be a named function).
 */
function foldForMatch(s: string): string {
  return s
    .replace(/[İIı]/g, "i")
    .toLowerCase();
}

/**
 * Finds whether the market's expected CTA is present and clickable. Matches by
 * visible text (accent/locale-tolerant, case-insensitive contains). Returns the
 * best match or null.
 */
export function findExpectedCta(
  signals: FunctionalSignals,
  expected: ExpectedCta,
): { present: boolean; clickable: boolean; href: string | null } {
  const needle = foldForMatch(expected.text);
  const matches = signals.links.filter((l) =>
    foldForMatch(l.text).includes(needle),
  );
  if (matches.length === 0) {
    return { present: false, clickable: false, href: null };
  }
  const clickableMatch = matches.find((m) => m.clickable) ?? matches[0];
  return {
    present: true,
    clickable: clickableMatch.clickable,
    href: clickableMatch.resolved ?? clickableMatch.href,
  };
}

/** Type marker so config can key expected CTAs by country. */
export type ExpectedCtaByCountry = Partial<Record<CountryCode, ExpectedCta>>;