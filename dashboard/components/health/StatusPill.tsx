import { normalizeStatus, statusLabel, type StatusKey } from "@/lib/format";

const PILL: Record<StatusKey, string> = {
  pass: "bg-[var(--st-ok-bg)] text-[var(--st-ok-fg)]",
  warn: "bg-[var(--st-warn-bg)] text-[var(--st-warn-fg)]",
  fail: "bg-[var(--st-bad-bg)] text-[var(--st-bad-fg)]",
  error: "bg-[var(--st-err-bg)] text-[var(--st-err-fg)]",
  running: "bg-[var(--st-info-bg)] text-[var(--st-info-fg)]",
  unknown: "bg-[var(--st-none)] text-[var(--st-none-fg)]",
};

const DOT: Record<StatusKey, string> = {
  pass: "bg-[var(--st-ok)]",
  warn: "bg-[var(--st-warn)]",
  fail: "bg-[var(--st-bad)]",
  error: "bg-[var(--st-err)]",
  running: "bg-[var(--st-info)]",
  unknown: "bg-[var(--app-faint)]",
};

export function StatusPill({
  status,
}: {
  status: string | null | undefined;
}) {
  const key = normalizeStatus(status);
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium " +
        PILL[key]
      }
    >
      <span className={"h-1.5 w-1.5 rounded-full " + DOT[key]} aria-hidden="true" />
      {statusLabel(key)}
    </span>
  );
}
