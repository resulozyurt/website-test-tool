import { listSweeps } from "@/lib/queries";
import { SweepsTable } from "@/components/SweepsTable";

// Data reflects live monitoring runs; never serve a cached page.
export const dynamic = "force-dynamic";

export default async function GeoSweepPage() {
  const sweeps = await listSweeps(50);

  return (
    <>
      <div className="mb-6">
        <div className="font-mono text-[11px] font-medium uppercase tracking-[0.13em] text-muted">
          Geo sweep
        </div>
        <h1 className="mt-1 text-[22px] font-medium tracking-tight">
          Recent sweeps
        </h1>
      </div>

      {sweeps.length === 0 ? (
        <div className="rounded-xl border border-line bg-card p-8 text-center text-sm text-muted">
          No sweeps yet. Run{" "}
          <code className="rounded bg-elev px-1.5 py-0.5 font-mono text-xs">
            npm run sweep
          </code>{" "}
          in the runner, then refresh.
        </div>
      ) : (
        <SweepsTable items={sweeps} />
      )}
    </>
  );
}