import { listHealthRuns } from "@/lib/queries";
import { RecentRuns } from "@/components/health/RecentRuns";

export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const runs = await listHealthRuns(50);
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
      <RecentRuns runs={runs} />
    </>
  );
}
