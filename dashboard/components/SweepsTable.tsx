import Link from "next/link";
import { formatDateTime, formatDuration } from "@/lib/format";
import type { SweepListItem } from "@/lib/queries";
import { StatusBadge } from "./StatusBadge";
import { SweepMatrixCompact } from "./SweepMatrix";

function Counts({ item }: { item: SweepListItem }) {
  return (
    <span className="counts">
      <span className={item.passCount ? "c-pass" : "zero"}>
        {item.passCount} pass
      </span>
      <span className={item.warnCount ? "c-warn" : "zero"}>
        {item.warnCount} warn
      </span>
      <span className={item.failCount ? "c-fail" : "zero"}>
        {item.failCount} fail
      </span>
    </span>
  );
}

export function SweepsTable({ items }: { items: SweepListItem[] }) {
  return (
    <div className="card">
      <table className="sweeps">
        <thead>
          <tr>
            <th>Sweep</th>
            <th>Status</th>
            <th className="hide-sm">Matrix</th>
            <th className="hide-sm">Result</th>
            <th className="hide-sm">Started</th>
            <th className="hide-sm">Duration</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link href={`/sweeps/${item.id}`} className="sweep-id">
                  #{item.id}
                </Link>{" "}
                <span className="mono" style={{ color: "var(--faint)" }}>
                  {item.trigger}
                </span>
              </td>
              <td>
                <StatusBadge status={item.status} />
              </td>
              <td className="hide-sm">
                <SweepMatrixCompact cells={item.cells} />
              </td>
              <td className="hide-sm">
                <Counts item={item} />
              </td>
              <td className="hide-sm mono" style={{ color: "var(--muted)" }}>
                {formatDateTime(item.startedAt)}
              </td>
              <td className="hide-sm mono" style={{ color: "var(--muted)" }}>
                {formatDuration(item.startedAt, item.finishedAt)}
              </td>
              <td style={{ textAlign: "right" }}>
                <Link
                  href={`/sweeps/${item.id}`}
                  className="row-link mono"
                  aria-label={`Open sweep ${item.id}`}
                  style={{ color: "var(--muted)" }}
                >
                  open{" "}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
