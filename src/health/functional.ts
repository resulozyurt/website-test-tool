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
 * IMPORTANT: the page.evaluate body contains NO named function/arrow
 * declarations (tsx/esbuild keepNames would inject a browser-undefined
 * `__name`). All callbacks are anonymous and inline.
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
 * Probes unique internal link targets for reachability using HEAD, falling back
 * to GET when HEAD is rejected (403/405/501). Returns only the unhealthy ones.
 * Bounded by `max` to stay polite. Uses the proxy-bound request context.
 */
export async function probeInternalTargets(
  request: APIRequestContext,
  links: LinkInfo[],
  max = 40,
): Promise<DeadLink[]> {
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
    let status: number | null = null;
    let method = "HEAD";
    let error: string | null = null;
    try {
      let res = await request.head(url, { timeout: 15000 });
      status = res.status();
      if (status === 403 || status === 405 || status === 501) {
        method = "GET";
        res = await request.get(url, { timeout: 20000 });
        status = res.status();
      }
      if (status >= 400) {
        dead.push({ url, status, method, error: null });
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      dead.push({ url, status, method, error });
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
 * Finds whether the market's expected CTA is present and clickable. Matches by
 * visible text (case-insensitive contains). Returns the best match or null.
 */
export function findExpectedCta(
  signals: FunctionalSignals,
  expected: ExpectedCta,
): { present: boolean; clickable: boolean; href: string | null } {
  const needle = expected.text.toLowerCase();
  const matches = signals.links.filter((l) =>
    l.text.toLowerCase().includes(needle),
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