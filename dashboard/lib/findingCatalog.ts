/**
 * Human-readable catalog for health-crawl finding types.
 *
 * The database stores each finding as a compact machine `type` (e.g.
 * "link_coherence"). The panel is read by non-engineers too, so this maps every
 * known type to a short label and a one-line explanation of what it means and
 * why it matters. Unknown types fall back to a humanized version of the raw
 * type, so a newly added finding still renders sensibly before it is cataloged.
 *
 * Extending: add a line here when a new finding type is introduced in
 * src/health/checks.ts.
 */

export interface FindingMeta {
  label: string;
  description: string;
}

const CATALOG: Record<string, FindingMeta> = {
  // --- technical ---
  load_error: { label: "Page failed to load", description: "The page could not be opened at all." },
  page_gone: { label: "Page removed (410)", description: "The page intentionally returns 410 Gone." },
  http_status: { label: "Bad HTTP status", description: "The page returned an error status (4xx/5xx)." },
  blank_page: { label: "Blank page", description: "The page rendered almost no content." },
  console_error: { label: "JavaScript error", description: "First-party JavaScript threw an error in the console." },
  console_error_thirdparty: { label: "Third-party console error", description: "A console error from an external script (ignored)." },
  broken_resource: { label: "Broken resource", description: "A first-party file (image/script/font) failed to load." },
  third_party_noise: { label: "Third-party request noise", description: "An external/aborted request failed (ignored)." },

  // --- visual ---
  broken_image: { label: "Broken image", description: "An image is present but did not load." },
  image_not_loaded: { label: "Image not loaded", description: "An image was still loading after the full scroll." },
  horizontal_overflow: { label: "Horizontal overflow", description: "The page scrolls sideways — layout likely broken." },
  overflowing_element: { label: "Element spills off-screen", description: "An element extends past the viewport width." },
  element_overlap: { label: "Overlapping elements", description: "Two buttons/headings visibly sit on top of each other." },
  layout_shift: { label: "Layout shift", description: "Content jumped around while the page loaded (CLS)." },
  fonts_not_loaded: { label: "Fonts not loaded", description: "Web fonts had not finished loading." },
  ai_visual: { label: "AI visual note", description: "The AI visual reviewer flagged a possible defect (advisory)." },

  // --- functional ---
  dead_href: { label: "Dead link control", description: "A link has an empty/# / javascript href." },
  unclickable: { label: "Not clickable", description: "A link/button is hidden, zero-size, covered, or disabled." },
  dead_link: { label: "Broken internal link", description: "An internal link points to an unreachable page." },
  link_gone: { label: "Link to removed page", description: "An internal link points to a removed (410) target." },
  link_unreachable: { label: "Link not probed", description: "An internal link could not be checked (transient/timeout)." },
  link_coherence: { label: "Text ≠ link target", description: "A link's text names one place but points somewhere else." },
  cta_missing: { label: "CTA missing", description: "The market's expected call-to-action was not found." },
  cta_unclickable: { label: "CTA not clickable", description: "The expected call-to-action is present but not clickable." },
  cta_target: { label: "CTA wrong target", description: "The call-to-action links to an unexpected destination." },
  form_no_fields: { label: "Empty form", description: "A visible form renders no input fields." },
  menu_no_reveal: { label: "Menu did not open", description: "A nav dropdown did not reveal its submenu on hover." },

  // --- location / language ---
  content_language: { label: "Wrong content language", description: "The page text is in a different language than this market should serve (e.g. English left on a TR/ES/AR page)." },
  foreign_text: { label: "Possible untranslated text", description: "A significant share of the text looks foreign to the expected language." },
};

/** Turns a snake_case type into a Title-Cased label as a fallback. */
function humanize(type: string): string {
  return type
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Returns the catalog entry for a finding type, or a humanized fallback. */
export function findingMeta(type: string): FindingMeta {
  return CATALOG[type] ?? { label: humanize(type), description: "" };
}
