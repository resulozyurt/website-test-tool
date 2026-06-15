import type { InteractionStep } from "../runner/interaction.js";

/**
 * Non-submitting interaction specs per page. PROD only ever opens/reveals and
 * inspects; it never submits (real submission is staging-only, Phase 5).
 * Sourced manually for now; Phase 4 proposes AI candidates for human approval.
 */
const BY_PAGE: Record<string, InteractionStep[]> = {
  // Home currently has no required non-submitting interaction.
  home: [],

  // Example for when the pricing page is enabled (all non-submitting):
  // pricing: [
  //   { kind: "click", selector: "text=Book a Demo", label: "open demo popup" },
  //   { kind: "expectVisible", selector: ".demo-form", label: "demo form visible" },
  //   { kind: "expectVisible", selector: "input[name='email']", label: "email field present" },
  // ],
};

export function resolveInteractions(pageKey: string): InteractionStep[] {
  return BY_PAGE[pageKey] ?? [];
}