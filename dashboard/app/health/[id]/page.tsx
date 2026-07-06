import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getHealthRun,
  getHealthPages,
  getHealthFindings,
  type HealthFindingView,
} from "@/lib/queries";
import { formatDateTime, formatDuration } from "@/lib/format";
import { StatusPill } from "@/components/health/StatusPill";
import { Findings } from "@/components/health/Findings";
import { ChipFilter, type FilterValues } from "@/components/health/ChipFilter";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function HealthRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

  const [pages, findings] = await Promise.all([
    getHealthPages(runId),
    getHealthFindings(runId),
  ]);

  const sp = await searchParams;
  const filters: FilterValues = {
    status: firstParam(sp.status),
    severity: firstParam(sp.severity),
  };

  // Group findings by their page for nested rendering.
  const findingsByPage = new Map<number, HealthFindingView[]>();
  for (const f of findings) {
    const list = findingsByPage.get(f.pageId) ?? [];
    list.push(f);
    findingsByPage.set(f.pageId, list);
  }

  // Apply filters: status narrows which pages show; severity narrows to pages
  // that carry that severity (and, per page, which findings are displayed).
  const visiblePages = pages.filter((p) => {
    if (filters.status && p.status !== filters.status) return false;
    if (filters.severity) {
      const pf = findingsByPage.get(p.id) ?? [];
      if (!pf.some((f) => f.severity === filters.severity)) return false;
    }
    return true;
  });

  const findingsForPage = (pageId: number): HealthFindingView[] => {
    const pf = findingsByPage.get(pageId) ?? [];
    return filters.severity
      ? pf.filter((f) => f.severity === filters.severity)
      : pf;
  };

  const filtersActive = Boolean(filters.status || filters.severity);

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

      <ChipFilter
        basePath={`/health/${run.id}`}
        current={filters}
        groups={[
          {
            label: "Status",
            field: "status",
            options: ["pass", "warn", "fail", "error"],
          },
          {
            label: "Severity",
            field: "severity",
            options: ["critical", "major", "minor"],
          },
        ]}
      />

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
            {visiblePages.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-muted"
                >
                  No pages match the current filters.
                </td>
              </tr>
            ) : (
              visiblePages.map((p) => {
                const pageFindings = findingsForPage(p.id);
                return (
                  <tr
                    key={p.id}
                    className="border-b border-line align-top last:border-0"
                  >
                    <td className="px-4 py-3 font-mono text-[13px]">
                      {p.path || "/"}
                      {pageFindings.length > 0 && (
                        <Findings findings={pageFindings} />
                      )}
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
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between font-mono text-xs text-faint">
        <span>Started {formatDateTime(run.startedAt)}</span>
        {filtersActive && (
          <Link href={`/health/${run.id}`} className="hover:text-muted">
            Clear filters
          </Link>
        )}
      </div>
    </>
  );
}