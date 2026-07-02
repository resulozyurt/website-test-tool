import { listSweeps } from "@/lib/queries";
import { SweepsTable } from "@/components/SweepsTable";

// Data reflects live monitoring runs; never serve a cached page.
export const dynamic = "force-dynamic";

export default async function GeoSweepPage() {
  const sweeps = await listSweeps(50);

  return (
    <>
      <div className="mb-6">
        <div className="eyebrow">Geo sweep</div>
        <h1>Recent sweeps</h1>
      </div>

      {sweeps.length === 0 ? (
        <div className="card empty">
          No sweeps yet. Run <code>npm run sweep</code> in the runner, then
          refresh.
        </div>
      ) : (
        <SweepsTable items={sweeps} />
      )}
    </>
  );
}
