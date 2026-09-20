import type { RunScope } from "@/lib/queries";

/**
 * Which page set a run covered. Worth showing everywhere a run is listed: a
 * green "pass" over four funnel pages and a green "pass" over the whole site
 * are very different claims, and without this they look identical.
 */
const LABEL: Record<RunScope, string> = {
  critical: "funnel",
  full: "full site",
};

const TITLE: Record<RunScope, string> = {
  critical: "Daily run: home, pricing, demo and free trial in every market",
  full: "Weekly run: every page in the inventory",
};

export function ScopeBadge({ scope }: { scope: RunScope | null | undefined }) {
  const key: RunScope = scope === "critical" ? "critical" : "full";
  return (
    <span
      title={TITLE[key]}
      className={
        "inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-medium " +
        (key === "critical"
          ? "bg-[var(--st-info-bg)] text-[var(--st-info-fg)]"
          : "bg-[var(--st-none)] text-[var(--st-none-fg)]")
      }
    >
      {LABEL[key]}
    </span>
  );
}
