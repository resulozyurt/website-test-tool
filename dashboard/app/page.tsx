import { listSweeps } from "@/lib/queries";
import { SweepsTable } from "@/components/SweepsTable";

// Data reflects live monitoring runs; never serve a cached page.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const sweeps = await listSweeps(50);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Production monitor</div>
          <h1>Recent sweeps</h1>
        </div>
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
