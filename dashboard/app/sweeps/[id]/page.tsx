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
import { StatusPill } from "@/components/health/StatusPill";
import { SweepMatrix } from "@/components/SweepMatrix";
import { ChipFilter, type FilterValues } from "@/components/health/ChipFilter";
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
  const filters: FilterValues = {
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
      <div className="mb-1 font-mono text-xs text-muted">
        <Link href="/geo" className="hover:text-ink">
          ← geo sweeps
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] font-medium uppercase tracking-[0.13em] text-muted">
            {sweep.environmentKey} · {sweep.trigger}
          </div>
          <h1 className="mt-1 text-[22px] font-medium tracking-tight">
            Sweep #{sweep.id}
          </h1>
        </div>
        <div className="flex items-center gap-3.5">
          <span className="font-mono text-xs text-muted">
            {formatDateTime(sweep.startedAt)} ·{" "}
            {formatDuration(sweep.startedAt, sweep.finishedAt)}
          </span>
          <StatusPill status={sweep.status} />
        </div>
      </div>

      <section className="mb-7">
        <h2 className="mb-3 text-sm font-medium text-ink-2">Country × page</h2>
        <div className="inline-block rounded-xl border border-line bg-card p-4">
          <SweepMatrix cells={cells} />
        </div>
      </section>

      <ChipFilter
        basePath={`/sweeps/${sweep.id}`}
        current={filters}
        groups={[
          { label: "Country", field: "country", options: countries },
          { label: "Page", field: "page", options: pages },
          {
            label: "Status",
            field: "status",
            options: ["pass", "warn", "fail", "error"],
          },
        ]}
      />

      <section className="mb-7">
        <h2 className="mb-3 text-sm font-medium text-ink-2">
          Runs{" "}
          <span className="font-mono font-normal text-faint">
            ({visibleRuns.length} of {runs.length})
          </span>
        </h2>
        {visibleRuns.length === 0 ? (
          <div className="rounded-xl border border-line bg-card p-8 text-center text-sm text-muted">
            No runs match the current filters.
          </div>
        ) : (
          <div className="grid gap-3.5">
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