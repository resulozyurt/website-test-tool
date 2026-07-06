import Link from "next/link";
import {
  healthFindingDistribution,
  latestHealthByCountry,
  listHealthRuns,
  healthRunTrend,
} from "@/lib/queries";
import { CountryCards } from "@/components/health/CountryCards";
import { RecentRuns } from "@/components/health/RecentRuns";
import { PassRateTrend } from "@/components/charts/PassRateTrend";
import {
  FindingDistribution,
  type DistributionDatum,
} from "@/components/charts/FindingDistribution";
import type { TrendPoint } from "@/components/charts/chartTheme";

// Data reflects live monitoring runs; never serve a cached page.
export const dynamic = "force-dynamic";

function overallSummary(
  countries: { pagesTotal: number; pagesOk: number; pagesFail: number; pagesWarn: number }[],
) {
  let total = 0;
  let ok = 0;
  let issues = 0;
  for (const c of countries) {
    total += c.pagesTotal;
    ok += c.pagesOk;
    issues += c.pagesFail + c.pagesWarn;
  }
  const rate = total > 0 ? Math.round((ok / total) * 100) : null;
  return { total, ok, issues, rate };
}

/** Deterministic YYYY-MM-DD (UTC) so server render and hydration agree. */
function isoDate(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

export default async function OverviewPage() {
  const [countries, runs, trend] = await Promise.all([
    latestHealthByCountry(),
    listHealthRuns(12),
    healthRunTrend(12),
  ]);

  // Distribution is scoped to the latest run per country, matching the cards.
  const distribution: DistributionDatum[] = await healthFindingDistribution(
    countries.map((c) => c.runId),
  );

  const trendPoints: TrendPoint[] = trend
    .filter((t) => t.passRate !== null)
    .map((t) => ({
      country: t.country,
      dateLabel: isoDate(t.startedAt),
      passRate: t.passRate as number,
    }));

  const summary = overallSummary(countries);
  const healthy = summary.issues === 0 && countries.length > 0;
  const showCharts = trendPoints.length > 0 || distribution.length > 0;

  return (
    <>
      <div className="mb-6">
        <div className="font-mono text-[11px] font-medium uppercase tracking-[0.13em] text-muted">
          Production monitor
        </div>
        <h1 className="mt-1 text-[22px] font-medium tracking-tight">Overview</h1>
      </div>

      {countries.length === 0 ? (
        <div className="rounded-xl border border-line bg-card p-8 text-center text-sm text-muted">
          No health data yet. Run{" "}
          <code className="rounded bg-elev px-1.5 py-0.5 font-mono text-xs">
            npm run healthcheck
          </code>{" "}
          in the runner, then refresh.
        </div>
      ) : (
        <>
          <div
            className={
              "mb-3 flex items-center justify-between rounded-xl border p-4 " +
              (healthy
                ? "border-[var(--st-ok-fg)]/30 bg-[var(--st-ok-bg)]"
                : "border-[var(--st-warn-fg)]/30 bg-[var(--st-warn-bg)]")
            }
          >
            <div className="flex items-center gap-3">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  background: healthy ? "var(--st-ok)" : "var(--st-warn)",
                }}
                aria-hidden="true"
              />
              <div>
                <div
                  className="text-[17px] font-medium"
                  style={{
                    color: healthy ? "var(--st-ok-fg)" : "var(--st-warn-fg)",
                  }}
                >
                  {healthy ? "All systems healthy" : "Needs attention"}
                </div>
                <div
                  className="text-[13px]"
                  style={{
                    color: healthy ? "var(--st-ok-fg)" : "var(--st-warn-fg)",
                  }}
                >
                  {healthy
                    ? `${summary.total} pages passing across ${countries.length} countries`
                    : `${summary.issues} issue${summary.issues === 1 ? "" : "s"} across the latest runs`}
                </div>
              </div>
            </div>
            {summary.rate !== null && (
              <div className="text-right">
                <div className="font-mono text-[32px] leading-none tabular-nums">
                  {summary.rate}%
                </div>
                <div className="text-xs text-muted">pages healthy</div>
              </div>
            )}
          </div>

          <div className="mb-8">
            <CountryCards rows={countries} />
          </div>

          {showCharts && (
            <div className="mb-8 grid gap-4 lg:grid-cols-2">
              {trendPoints.length > 0 && (
                <div className="rounded-xl border border-line bg-card p-4">
                  <div className="mb-3">
                    <div className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-faint">
                      Pass-rate trend
                    </div>
                    <div className="text-[13px] text-muted">
                      Recent runs by country
                    </div>
                  </div>
                  <PassRateTrend points={trendPoints} />
                </div>
              )}

              {distribution.length > 0 && (
                <div className="rounded-xl border border-line bg-card p-4">
                  <div className="mb-3">
                    <div className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-faint">
                      Findings by type
                    </div>
                    <div className="text-[13px] text-muted">
                      Latest run per country
                    </div>
                  </div>
                  <FindingDistribution rows={distribution} />
                </div>
              )}
            </div>
          )}

          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink-2">Recent runs</h2>
            <Link href="/health" className="text-xs text-brand hover:underline">
              View all
            </Link>
          </div>
          <RecentRuns runs={runs} />
        </>
      )}
    </>
  );
}