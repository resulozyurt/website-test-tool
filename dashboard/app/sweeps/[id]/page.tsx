import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAiVerdictsForRuns,
  getChecksForRuns,
  getRunsBySweep,
  getSweep,
  type MatrixCell,
} from "@/lib/queries";
import { formatDateTime, formatDuration } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { SweepMatrix } from "@/components/SweepMatrix";
import { Filters, type FilterState } from "@/components/Filters";
import { RunCard } from "@/components/RunCard";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function SweepPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sweepId = Number(id);
  if (!Number.isInteger(sweepId) || sweepId <= 0) {
    notFound();
  }

  const sweep = await getSweep(sweepId);
  if (!sweep) {
    notFound();
  }

  const runs = await getRunsBySweep(sweepId);
  const runIds = runs.map((r) => r.id);
  const [checks, verdicts] = await Promise.all([
    getChecksForRuns(runIds),
    getAiVerdictsForRuns(runIds),
  ]);

  const checksByRun = new Map<number, typeof checks>();
  for (const c of checks) {
    const list = checksByRun.get(c.runId) ?? [];
    list.push(c);
    checksByRun.set(c.runId, list);
  }
  const aiByRun = new Map(verdicts.map((v) => [v.runId, v]));

  // Overview board uses every run, regardless of the active filter.
  const cells: MatrixCell[] = runs.map((r) => ({
    country: r.country,
    pageKey: r.pageKey,
    status: r.status,
  }));

  const countries = Array.from(new Set(runs.map((r) => r.country)));
  const pages = Array.from(new Set(runs.map((r) => r.pageKey)));

  const sp = await searchParams;
  const filters: FilterState = {
    country: firstParam(sp.country),
    page: firstParam(sp.page),
    status: firstParam(sp.status),
  };

  const visibleRuns = runs.filter(
    (r) =>
      (!filters.country || r.country === filters.country) &&
      (!filters.page || r.pageKey === filters.page) &&
      (!filters.status || r.status === filters.status),
  );

  return (
    <>
      <div className="crumbs">
        <Link href="/">← sweeps</Link>
      </div>

      <div className="page-head">
        <div>
          <div className="eyebrow">{sweep.environmentKey} · {sweep.trigger}</div>
          <h1>Sweep #{sweep.id}</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>
            {formatDateTime(sweep.startedAt)} ·{" "}
            {formatDuration(sweep.startedAt, sweep.finishedAt)}
          </span>
          <StatusBadge status={sweep.status} />
        </div>
      </div>

      <section className="section">
        <h2 className="section-title">Country × page</h2>
        <div className="card" style={{ padding: 16, display: "inline-block" }}>
          <SweepMatrix cells={cells} />
        </div>
      </section>

      <Filters
        sweepId={sweep.id}
        current={filters}
        countries={countries}
        pages={pages}
      />

      <section className="section">
        <h2 className="section-title">
          Runs{" "}
          <span className="mono" style={{ color: "var(--faint)", fontWeight: 400 }}>
            ({visibleRuns.length} of {runs.length})
          </span>
        </h2>
        {visibleRuns.length === 0 ? (
          <div className="card empty">No runs match the current filters.</div>
        ) : (
          <div className="runs-grid">
            {visibleRuns.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                checks={checksByRun.get(run.id) ?? []}
                ai={aiByRun.get(run.id)}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
