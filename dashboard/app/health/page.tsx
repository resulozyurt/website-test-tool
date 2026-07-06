import { listHealthRuns } from "@/lib/queries";
import { RecentRuns } from "@/components/health/RecentRuns";
import { ChipFilter, type FilterValues } from "@/components/health/ChipFilter";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const runs = await listHealthRuns(50);

  const sp = await searchParams;
  const filters: FilterValues = { country: firstParam(sp.country) };

  const countries = Array.from(new Set(runs.map((r) => r.country)));
  const visibleRuns = filters.country
    ? runs.filter((r) => r.country === filters.country)
    : runs;

  return (
    <>
      <div className="mb-6">
        <div className="font-mono text-[11px] font-medium uppercase tracking-[0.13em] text-muted">
          Health crawl
        </div>
        <h1 className="mt-1 text-[22px] font-medium tracking-tight">
          Health runs
        </h1>
      </div>

      {countries.length > 1 && (
        <ChipFilter
          basePath="/health"
          current={filters}
          groups={[{ label: "Country", field: "country", options: countries }]}
        />
      )}

      {visibleRuns.length === 0 ? (
        <div className="rounded-xl border border-line bg-card p-8 text-center text-sm text-muted">
          No runs match the current filter.
        </div>
      ) : (
        <RecentRuns runs={visibleRuns} />
      )}
    </>
  );
}