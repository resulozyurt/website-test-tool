import type { CheckStatus, RunStatus, SweepStatus } from "./types";

/** A single status vocabulary the UI can render, regardless of source table. */
export type StatusKey =
  | "pass"
  | "warn"
  | "fail"
  | "error"
  | "running"
  | "unknown";

export function normalizeStatus(
  status: CheckStatus | RunStatus | SweepStatus | string | null | undefined,
): StatusKey {
  switch (status) {
    case "pass":
    case "warn":
    case "fail":
    case "error":
    case "running":
      return status;
    default:
      return "unknown";
  }
}

export function statusLabel(status: StatusKey): string {
  switch (status) {
    case "pass":
      return "Pass";
    case "warn":
      return "Warn";
    case "fail":
      return "Fail";
    case "error":
      return "Error";
    case "running":
      return "Running";
    default:
      return "Unknown";
  }
}

const DATE_TIME_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return DATE_TIME_FMT.format(d);
}

export function formatDuration(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
): string {
  if (!start || !end) return "—";
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return "—";
  const secs = Math.round((e - s) / 1000);
  if (secs < 60) return `${secs}s`;
  const minutes = Math.floor(secs / 60);
  const rest = secs % 60;
  return `${minutes}m ${rest}s`;
}

export function formatCost(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "—";
  return `$${n.toFixed(4)}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}
