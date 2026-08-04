/**
 * Read-only "human-like" interaction probe for the health crawl.
 *
 * After the page is loaded and its passive signals + screenshot are collected,
 * this pass does the two safe things a real visitor does that pure DOM reading
 * misses: it HOVERS navigation items to see whether their dropdown menus open,
 * and it inspects forms to see whether they actually render input fields. It
 * never clicks a link, never submits, and never sends a non-GET request; the
 * read-only guard in browser.ts still blocks writes as a backstop.
 *
 * Mutations here (a temporary data-* tag, a mouse hover) affect ONLY our
 * throwaway browser DOM, exactly like the existing popup-dismiss/scroll-unlock
 * helpers -- they cause no request and no change to the live site.
 *
 * IMPORTANT: every page.evaluate body below contains NO named function/arrow
 * declarations (tsx/esbuild keepNames would inject a browser-undefined
 * `__name`). All callbacks are anonymous and inline.
 */

import type { Page } from "playwright";

/** A form that renders but shows no usable input fields (likely broken). */
export interface FormIssue {
  index: number;
  action: string | null;
  visibleInputs: number;
}

/** A nav item that has a submenu in the DOM but did not reveal it on hover. */
export interface MenuIssue {
  label: string;
}

/** Everything the interaction probe measures for one page. */
export interface InteractionSignals {
  /** Total <form> elements on the page. */
  formsTotal: number;
  /** Visible forms that render zero usable input fields. */
  brokenForms: FormIssue[];
  /** Navigation dropdown triggers found (elements with a nested submenu). */
  menuTriggers: number;
  /** Triggers whose submenu stayed hidden even after hover. */
  menusNotRevealing: MenuIssue[];
}

/** How many menu triggers to hover-test at most (politeness / speed cap). */
const MAX_MENU_HOVERS = 10;
/** Settle time after a hover for CSS transitions to reveal a submenu, ms. */
const HOVER_SETTLE_MS = 250;

const EMPTY: InteractionSignals = {
  formsTotal: 0,
  brokenForms: [],
  menuTriggers: 0,
  menusNotRevealing: [],
};

/**
 * Runs the read-only interaction probe. Never throws; returns a safe empty
 * result on any failure so it cannot fail the page inspection.
 */
export async function collectInteractionSignals(
  page: Page,
): Promise<InteractionSignals> {
  try {
    const forms = await inspectForms(page);
    const menus = await inspectMenus(page);
    return {
      formsTotal: forms.formsTotal,
      brokenForms: forms.brokenForms,
      menuTriggers: menus.menuTriggers,
      menusNotRevealing: menus.menusNotRevealing,
    };
  } catch {
    return EMPTY;
  }
}

/** Structural form check: visible forms that render no usable input field. */
async function inspectForms(
  page: Page,
): Promise<{ formsTotal: number; brokenForms: FormIssue[] }> {
  try {
    return await page.evaluate(() => {
      const forms = Array.from(document.querySelectorAll("form"));
      const broken: { index: number; action: string | null; visibleInputs: number }[] = [];

      forms.forEach((form, index) => {
        const el = form as HTMLFormElement;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const formVisible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden";
        if (!formVisible) {
          return; // collapsed/hidden forms are out of scope (may open on click)
        }

        const fields = Array.from(
          el.querySelectorAll("input, select, textarea"),
        ).filter((f) => {
          const fe = f as HTMLElement;
          const type = (fe.getAttribute("type") || "").toLowerCase();
          if (type === "hidden") {
            return false;
          }
          const fr = fe.getBoundingClientRect();
          const fs = window.getComputedStyle(fe);
          return (
            fr.width > 0 &&
            fr.height > 0 &&
            fs.display !== "none" &&
            fs.visibility !== "hidden"
          );
        });

        if (fields.length === 0) {
          broken.push({
            index,
            action: el.getAttribute("action"),
            visibleInputs: 0,
          });
        }
      });

      return { formsTotal: forms.length, brokenForms: broken };
    });
  } catch {
    return { formsTotal: 0, brokenForms: [] };
  }
}

/**
 * Hover-tests navigation dropdowns. First tags every nav item that owns a
 * nested submenu (and is not already showing it) with a temporary data-* marker
 * in OUR DOM only, then hovers each marked trigger and checks whether its
 * submenu became visible. A submenu that never reveals on hover is reported
 * (advisory: some menus open on click/tap instead).
 */
async function inspectMenus(
  page: Page,
): Promise<{ menuTriggers: number; menusNotRevealing: MenuIssue[] }> {
  // Tag candidates and report how many there are + which start hidden.
  const candidates = await page.evaluate((max: number) => {
    const navRoots = Array.from(
      document.querySelectorAll("nav, header, [role='navigation']"),
    );
    const seen = new Set<Element>();
    const items: { id: number; label: string; startsHidden: boolean }[] = [];
    let id = 0;

    for (const root of navRoots) {
      const lis = Array.from(root.querySelectorAll("li, [aria-haspopup='true']"));
      for (const li of lis) {
        if (seen.has(li)) {
          continue;
        }
        const submenu = li.querySelector("ul, .sub-menu, [class*='submenu'], [class*='dropdown']");
        if (!submenu) {
          continue;
        }
        seen.add(li);

        const subEl = submenu as HTMLElement;
        const subStyle = window.getComputedStyle(subEl);
        const subRect = subEl.getBoundingClientRect();
        const startsHidden =
          subStyle.display === "none" ||
          subStyle.visibility === "hidden" ||
          subStyle.opacity === "0" ||
          subRect.height < 2;

        const label =
          (li.querySelector("a, button, span")?.textContent || li.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 40) || "(menu)";

        (li as HTMLElement).setAttribute("data-itest-menu", String(id));
        subEl.setAttribute("data-itest-sub", String(id));
        items.push({ id, label, startsHidden });
        id += 1;
        if (items.length >= max) {
          break;
        }
      }
      if (items.length >= max) {
        break;
      }
    }
    return items;
  }, MAX_MENU_HOVERS);

  const menusNotRevealing: MenuIssue[] = [];
  for (const cand of candidates) {
    if (!cand.startsHidden) {
      continue; // already visible (e.g. a mega-menu shown by default)
    }
    try {
      await page.hover(`[data-itest-menu="${cand.id}"]`, { timeout: 2000 });
      await page.waitForTimeout(HOVER_SETTLE_MS);
      const revealed = await page.evaluate((id: number) => {
        const sub = document.querySelector(`[data-itest-sub="${id}"]`);
        if (!sub) {
          return false;
        }
        const s = window.getComputedStyle(sub as HTMLElement);
        const r = (sub as HTMLElement).getBoundingClientRect();
        return (
          s.display !== "none" &&
          s.visibility !== "hidden" &&
          s.opacity !== "0" &&
          r.height >= 2
        );
      }, cand.id);
      if (!revealed) {
        menusNotRevealing.push({ label: cand.label });
      }
    } catch {
      // A hover that could not be performed is not counted as a failure.
    }
  }

  return { menuTriggers: candidates.length, menusNotRevealing };
}
