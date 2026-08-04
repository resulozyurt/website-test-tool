/**
 * Deterministic visual + structural signals read from the rendered DOM, for the
 * health crawl. These are objective, measurable facts (not opinions): broken
 * images, horizontal overflow, elements spilling past the viewport, empty
 * sections, and web-font load state. Subjective "does this look broken" is left
 * to the AI visual verdict (a later phase).
 *
 * IMPORTANT: the page.evaluate body contains NO named function/arrow
 * declarations. tsx/esbuild runs with keepNames, which wraps such functions in
 * a module-scope `__name(...)` helper that does not exist in the browser and
 * makes the evaluate throw. All callbacks are anonymous and inline.
 */

import type { Page } from "playwright";

/** One image that failed to load. */
export interface BrokenImage {
  src: string;
  /** Where it sits, for triage. */
  top: number;
}

/** One element that spills horizontally past the viewport. */
export interface OverflowElement {
  selector: string;
  right: number;
  width: number;
}

/** Measurable visual/structural signals for one page. */
export interface VisualSignals {
  /** Rendered document dimensions. */
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  /** Page has meaningful text (used with height for a blank-page check). */
  textLength: number;
  /** Visible body text sample (trimmed) for content-language detection. */
  textSample: string;
  /** Horizontal scrollbar present (layout likely broken / element too wide). */
  horizontalOverflow: boolean;
  /** Images present in the DOM that failed to load (naturalWidth === 0). */
  brokenImages: BrokenImage[];
  /** Total <img> count, for context. */
  imageCount: number;
  /** Block elements whose right edge spills well past the viewport width. */
  overflowingElements: OverflowElement[];
  /** Web fonts finished loading ("loaded") or not ("loading"/"error"). */
  fontStatus: string;
  /** Accumulated layout shift (CLS) during load + lazy-content scroll (0 = unmeasured). */
  cumulativeLayoutShift: number;
  /** Images still not finished loading after the full scroll pass. */
  unloadedImages: BrokenImage[];
  /** Pairs of interactive/heading elements that visibly overlap (likely layout bug). */
  overlaps: OverlapPair[];
}

/** One overlapping pair of elements (selectors + overlap ratio of the smaller). */
export interface OverlapPair {
  a: string;
  b: string;
  ratio: number;
}

/**
 * Collects visual/structural signals from the current page state. Read-only.
 * Never throws; returns a safe empty-ish result on failure.
 */
export async function collectVisualSignals(page: Page): Promise<VisualSignals> {
  try {
    return await page.evaluate(() => {
      const doc = document.documentElement;
      const vw = doc.clientWidth || window.innerWidth || 0;

      // Broken images: loaded but zero natural size (and not intentionally empty).
      const imgs = Array.from(document.querySelectorAll("img"));
      const broken: { src: string; top: number }[] = [];
      for (const img of imgs) {
        const el = img as HTMLImageElement;
        const src = el.currentSrc || el.src || "";
        if (!src) {
          continue;
        }
        if (el.complete && el.naturalWidth === 0) {
          const rect = el.getBoundingClientRect();
          broken.push({ src, top: Math.round(rect.top + window.scrollY) });
        }
      }

      // Elements spilling well past the viewport width (layout breakage). Only
      // consider a bounded candidate set and require a real overshoot to avoid
      // noise from full-bleed sections.
      const overflow: { selector: string; right: number; width: number }[] = [];
      const tolerance = 4;
      const candidates = Array.from(
        document.querySelectorAll("section, div, header, footer, img, table, pre"),
      );
      for (const node of candidates) {
        const el = node as HTMLElement;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          continue;
        }
        if (rect.right > vw + tolerance && rect.width > vw + tolerance) {
          let sel = el.tagName.toLowerCase();
          if (el.id) {
            sel += "#" + el.id;
          } else if (typeof el.className === "string" && el.className.trim()) {
            sel += "." + el.className.trim().split(/\s+/).slice(0, 2).join(".");
          }
          overflow.push({
            selector: sel,
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          });
        }
      }

      const bodyText = document.body ? document.body.innerText || "" : "";
      let fontStatus = "unknown";
      try {
        fontStatus = (document as unknown as { fonts?: { status?: string } })
          .fonts?.status ?? "unknown";
      } catch {
        fontStatus = "unknown";
      }

      // Images that never finished loading after the full scroll pass.
      const unloaded: { src: string; top: number }[] = [];
      for (const img of imgs) {
        const el = img as HTMLImageElement;
        const src = el.currentSrc || el.src || "";
        if (!src) {
          continue;
        }
        if (!el.complete) {
          const rect = el.getBoundingClientRect();
          unloaded.push({ src, top: Math.round(rect.top + window.scrollY) });
        }
      }

      // Overlapping interactive/heading elements: two visible controls/headings
      // whose boxes intersect over >70% of the smaller one (a likely layout bug,
      // not intentional stacking). Bounded scan; parent/child pairs excluded.
      const overlaps: { a: string; b: string; ratio: number }[] = [];
      const ovMeta = Array.from(
        document.querySelectorAll("a, button"),
      )
        .slice(0, 250)
        .map((n) => {
          const el = n as HTMLElement;
          const r = el.getBoundingClientRect();
          const st = window.getComputedStyle(el);
          let sel = el.tagName.toLowerCase();
          if (el.id) {
            sel += "#" + el.id;
          } else if (typeof el.className === "string" && el.className.trim()) {
            sel += "." + el.className.trim().split(/\s+/).slice(0, 2).join(".");
          }
          return { el, r, st, sel };
        });
      for (let i = 0; i < ovMeta.length && overlaps.length < 20; i += 1) {
        const A = ovMeta[i];
        if (A.r.width < 4 || A.r.height < 4) {
          continue;
        }
        if (A.st.display === "none" || A.st.visibility === "hidden") {
          continue;
        }
        for (let j = i + 1; j < ovMeta.length && overlaps.length < 20; j += 1) {
          const B = ovMeta[j];
          if (B.r.width < 4 || B.r.height < 4) {
            continue;
          }
          if (B.st.display === "none" || B.st.visibility === "hidden") {
            continue;
          }
          if (A.el.contains(B.el) || B.el.contains(A.el)) {
            continue;
          }
          const ix = Math.max(0, Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left));
          const iy = Math.max(0, Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top));
          const inter = ix * iy;
          if (inter <= 0) {
            continue;
          }
          const minArea = Math.min(A.r.width * A.r.height, B.r.width * B.r.height);
          const ratio = minArea > 0 ? inter / minArea : 0;
          if (ratio > 0.7) {
            overlaps.push({ a: A.sel, b: B.sel, ratio: Math.round(ratio * 100) / 100 });
          }
        }
      }

      const clsRaw = (window as unknown as { __clsValue?: number }).__clsValue;
      const cumulativeLayoutShift =
        typeof clsRaw === "number" ? Math.round(clsRaw * 1000) / 1000 : 0;

      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: vw,
        scrollHeight: doc.scrollHeight,
        textLength: bodyText.trim().length,
        textSample: bodyText.replace(/\s+/g, " ").trim().slice(0, 5000),
        horizontalOverflow: doc.scrollWidth > vw + tolerance,
        brokenImages: broken.slice(0, 30),
        imageCount: imgs.length,
        overflowingElements: overflow.slice(0, 20),
        fontStatus,
        cumulativeLayoutShift,
        unloadedImages: unloaded.slice(0, 30),
        overlaps,
      };
    });
  } catch {
    return {
      scrollWidth: 0,
      clientWidth: 0,
      scrollHeight: 0,
      textLength: 0,
      textSample: "",
      horizontalOverflow: false,
      brokenImages: [],
      imageCount: 0,
      overflowingElements: [],
      fontStatus: "unknown",
      cumulativeLayoutShift: 0,
      unloadedImages: [],
      overlaps: [],
    };
  }
}