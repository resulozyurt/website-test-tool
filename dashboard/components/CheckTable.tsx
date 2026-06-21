import type { CheckView } from "@/lib/queries";
import { StatusBadge } from "./StatusBadge";

function ExpectedActual({ check }: { check: CheckView }) {
  if (check.expected === null && check.actual === null) {
    return <span style={{ color: "var(--faint)" }}>—</span>;
  }
  return (
    <span className="expected-actual">
      {check.expected ?? "—"}
      <span className="arrow">→</span>
      {check.actual ?? "—"}
    </span>
  );
}

export function CheckTable({ checks }: { checks: CheckView[] }) {
  if (checks.length === 0) {
    return (
      <p className="mono" style={{ color: "var(--faint)", margin: "4px 0 0" }}>
        No checks recorded.
      </p>
    );
  }

  return (
    <table className="checks">
      <thead>
        <tr>
          <th>Check</th>
          <th>Severity</th>
          <th>Status</th>
          <th>Expected → Actual</th>
          <th>Message</th>
        </tr>
      </thead>
      <tbody>
        {checks.map((check) => (
          <tr key={check.id}>
            <td className="type">{check.type}</td>
            <td>
              <span className={`sev sev-${check.severity}`}>{check.severity}</span>
            </td>
            <td>
              <StatusBadge status={check.status} />
            </td>
            <td>
              <ExpectedActual check={check} />
            </td>
            <td className="msg">{check.message}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
