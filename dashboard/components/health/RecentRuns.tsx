import Link from "next/link";
import type { HealthRunView } from "@/lib/queries";
import { formatDateTime, formatDuration } from "@/lib/format";
import { StatusPill } from "./StatusPill";

export function RecentRuns({ runs }: { runs: HealthRunView[] }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-card p-8 text-center text-sm text-muted">
        No health runs yet. Run{" "}
        <code className="rounded bg-elev px-1.5 py-0.5 font-mono text-xs">
          npm run healthcheck
        </code>{" "}
        in the runner, then refresh.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-wide text-faint">
            <th className="px-4 py-2.5 font-medium">Run</th>
            <th className="px-4 py-2.5 font-medium">Country</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Result</th>
            <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Started</th>
            <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Duration</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run.id}
              className="border-b border-line last:border-0 hover:bg-elev"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/health/${run.id}`}
                  className="font-mono font-medium text-brand"
                >
                  #{run.id}
                </Link>{" "}
                <span className="font-mono text-xs text-faint">{run.trigger}</span>
              </td>
              <td className="px-4 py-3 font-mono">{run.country}</td>
              <td className="px-4 py-3">
                <StatusPill status={run.status} />
              </td>
              <td className="px-4 py-3 font-mono text-xs">
                <span className="text-[var(--st-ok-fg)]">{run.pagesOk} ok</span>
                <span className="mx-2 text-faint">·</span>
                <span
                  className={
                    run.pagesFail
                      ? "text-[var(--st-bad-fg)]"
                      : "text-faint"
                  }
                >
                  {run.pagesFail} fail
                </span>
              </td>
              <td className="hidden px-4 py-3 font-mono text-xs text-muted sm:table-cell">
                {formatDateTime(run.startedAt)}
              </td>
              <td className="hidden px-4 py-3 font-mono text-xs text-muted sm:table-cell">
                {formatDuration(run.startedAt, run.finishedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
