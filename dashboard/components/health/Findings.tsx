import type { HealthFindingView } from "@/lib/queries";
import { SeverityPill } from "./SeverityPill";

/** Pretty-print the jsonb detail column, or null when there is nothing to show. */
function detailText(detail: unknown): string | null {
  if (detail === null || detail === undefined) return null;
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}

function FindingRow({ finding }: { finding: HealthFindingView }) {
  const json = detailText(finding.detail);
  return (
    <div className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityPill severity={finding.severity} />
        <span className="font-mono text-[12px] text-ink-2">{finding.type}</span>
        <span className="font-mono text-[10px] uppercase tracking-wide text-faint">
          {finding.category}
        </span>
      </div>
      <div className="mt-1 text-[13px] text-muted">{finding.message}</div>
      {json && (
        <details className="mt-1">
          <summary className="cursor-pointer select-none font-mono text-[11px] text-faint hover:text-muted">
            Details
          </summary>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-elev p-2 font-mono text-[11px] leading-relaxed text-ink-2">
            {json}
          </pre>
        </details>
      )}
    </div>
  );
}

/**
 * All findings for a single page. Gating findings (critical/major) come first
 * so they read as the reason a page failed; minor findings are grouped under a
 * quieter "Advisory" heading. Renders nothing when there are no findings.
 */
export function Findings({ findings }: { findings: HealthFindingView[] }) {
  if (findings.length === 0) return null;

  const gating = findings.filter(
    (f) => f.severity === "critical" || f.severity === "major",
  );
  const advisory = findings.filter((f) => f.severity === "minor");

  return (
    <div className="mt-2 border-t border-line pt-1">
      {gating.length > 0 && (
        <div className="divide-y divide-line">
          {gating.map((f) => (
            <FindingRow key={f.id} finding={f} />
          ))}
        </div>
      )}

      {advisory.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-faint">
            Advisory
          </div>
          <div className="divide-y divide-line opacity-90">
            {advisory.map((f) => (
              <FindingRow key={f.id} finding={f} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}