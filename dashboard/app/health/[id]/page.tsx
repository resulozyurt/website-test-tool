import Link from "next/link";
import { notFound } from "next/navigation";
import { getHealthRun, getHealthPages } from "@/lib/queries";
import { formatDateTime, formatDuration } from "@/lib/format";
import { StatusPill } from "@/components/health/StatusPill";

export const dynamic = "force-dynamic";

export default async function HealthRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0) {
    notFound();
  }

  const run = await getHealthRun(runId);
  if (!run) {
    notFound();
  }

  const pages = await getHealthPages(runId);

  return (
    <>
      <div className="mb-1 font-mono text-xs text-muted">
        <Link href="/health" className="hover:text-ink">
          ← health runs
        </Link>
      </div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-[22px] font-medium tracking-tight">
          Run #{run.id}{" "}
          <span className="font-mono text-base text-faint">
            {run.country} · {run.trigger}
          </span>
        </h1>
        <StatusPill status={run.status} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { k: "Pages", v: String(run.pagesTotal) },
          { k: "Passing", v: String(run.pagesOk) },
          { k: "Failing", v: String(run.pagesFail) },
          { k: "Duration", v: formatDuration(run.startedAt, run.finishedAt) },
        ].map((m) => (
          <div key={m.k} className="rounded-xl bg-elev p-4">
            <div className="text-[13px] text-muted">{m.k}</div>
            <div className="mt-1 font-mono text-[22px] tabular-nums">{m.v}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-medium">Page</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">HTTP</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Site</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Cache</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr
                key={p.id}
                className="border-b border-line last:border-0 hover:bg-elev"
              >
                <td className="px-4 py-3 font-mono text-[13px]">
                  {p.path || "/"}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={p.status} />
                </td>
                <td className="hidden px-4 py-3 font-mono text-xs text-muted sm:table-cell">
                  {p.httpStatus ?? "—"}
                </td>
                <td className="hidden px-4 py-3 font-mono text-xs text-muted sm:table-cell">
                  {p.siteCountry ?? "—"}
                </td>
                <td className="hidden px-4 py-3 font-mono text-xs text-muted sm:table-cell">
                  {p.cacheBucket ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 font-mono text-xs text-faint">
        Started {formatDateTime(run.startedAt)}
      </div>
    </>
  );
}
