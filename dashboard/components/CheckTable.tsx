import type { CheckView } from "@/lib/queries";
import { StatusPill } from "./health/StatusPill";
import { SeverityPill } from "./health/SeverityPill";

function ExpectedActual({ check }: { check: CheckView }) {
  if (check.expected === null && check.actual === null) {
    return <span className="text-faint">—</span>;
  }
  return (
    <span className="font-mono text-xs text-ink-2">
      {check.expected ?? "—"}
      <span className="mx-1 text-faint">→</span>
      {check.actual ?? "—"}
    </span>
  );
}

export function CheckTable({ checks }: { checks: CheckView[] }) {
  if (checks.length === 0) {
    return (
      <p className="mt-1 font-mono text-xs text-faint">No checks recorded.</p>
    );
  }

  return (
    <table className="mt-1 w-full text-[13px]">
      <thead>
        <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wide text-faint">
          <th className="py-1.5 pr-3 font-medium">Check</th>
          <th className="py-1.5 pr-3 font-medium">Severity</th>
          <th className="py-1.5 pr-3 font-medium">Status</th>
          <th className="hidden py-1.5 pr-3 font-medium sm:table-cell">
            Expected → Actual
          </th>
          <th className="hidden py-1.5 font-medium sm:table-cell">Message</th>
        </tr>
      </thead>
      <tbody>
        {checks.map((check) => (
          <tr
            key={check.id}
            className="border-b border-line align-top last:border-0"
          >
            <td className="py-2 pr-3 font-mono font-semibold whitespace-nowrap">
              {check.type}
            </td>
            <td className="py-2 pr-3">
              <SeverityPill severity={check.severity} />
            </td>
            <td className="py-2 pr-3">
              <StatusPill status={check.status} />
            </td>
            <td className="hidden py-2 pr-3 sm:table-cell">
              <ExpectedActual check={check} />
            </td>
            <td className="hidden py-2 text-muted sm:table-cell">
              {check.message}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}