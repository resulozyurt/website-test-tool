import Link from "next/link";
import { formatDateTime, formatDuration } from "@/lib/format";
import type { SweepListItem } from "@/lib/queries";
import { StatusPill } from "./health/StatusPill";
import { SweepMatrixCompact } from "./SweepMatrix";

function Counts({ item }: { item: SweepListItem }) {
  const parts: { n: number; label: string; tone: string }[] = [
    { n: item.passCount, label: "pass", tone: "text-[var(--st-ok-fg)]" },
    { n: item.warnCount, label: "warn", tone: "text-[var(--st-warn-fg)]" },
    { n: item.failCount, label: "fail", tone: "text-[var(--st-bad-fg)]" },
  ];
  return (
    <span className="inline-flex gap-2.5 font-mono text-xs tabular-nums">
      {parts.map((p) => (
        <span key={p.label} className={p.n ? p.tone : "text-faint"}>
          {p.n} {p.label}
        </span>
      ))}
    </span>
  );
}

export function SweepsTable({ items }: { items: SweepListItem[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-wide text-faint">
            <th className="px-4 py-2.5 font-medium">Sweep</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Matrix</th>
            <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Result</th>
            <th className="hidden px-4 py-2.5 font-medium md:table-cell">Started</th>
            <th className="hidden px-4 py-2.5 font-medium md:table-cell">Duration</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className="border-b border-line last:border-0 hover:bg-elev"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/sweeps/${item.id}`}
                  className="font-mono font-semibold hover:text-brand"
                >
                  #{item.id}
                </Link>{" "}
                <span className="font-mono text-xs text-faint">{item.trigger}</span>
              </td>
              <td className="px-4 py-3">
                <StatusPill status={item.status} />
              </td>
              <td className="hidden px-4 py-3 sm:table-cell">
                <SweepMatrixCompact cells={item.cells} />
              </td>
              <td className="hidden px-4 py-3 sm:table-cell">
                <Counts item={item} />
              </td>
              <td className="hidden px-4 py-3 font-mono text-xs text-muted md:table-cell">
                {formatDateTime(item.startedAt)}
              </td>
              <td className="hidden px-4 py-3 font-mono text-xs text-muted md:table-cell">
                {formatDuration(item.startedAt, item.finishedAt)}
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/sweeps/${item.id}`}
                  className="font-mono text-xs text-muted hover:text-brand"
                  aria-label={`Open sweep ${item.id}`}
                >
                  open →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}