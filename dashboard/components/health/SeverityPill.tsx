import type { Severity } from "@/lib/types";

/**
 * A small badge for a finding's severity. Severity is a separate vocabulary
 * from run/page status, so it gets its own pill rather than reusing StatusPill.
 * Colors come from the console's status tokens (critical reads as a failure,
 * major as a warning, minor as informational), so dark mode switches for free.
 */
const SEVERITY_STYLE: Record<
  Severity,
  { bg: string; fg: string; label: string }
> = {
  critical: { bg: "var(--st-bad-bg)", fg: "var(--st-bad-fg)", label: "Critical" },
  major: { bg: "var(--st-warn-bg)", fg: "var(--st-warn-fg)", label: "Major" },
  minor: { bg: "var(--st-info-bg)", fg: "var(--st-info-fg)", label: "Minor" },
};

export function SeverityPill({ severity }: { severity: Severity }) {
  const s = SEVERITY_STYLE[severity];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}