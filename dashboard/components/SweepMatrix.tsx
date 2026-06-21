import { normalizeStatus } from "@/lib/format";
import type { MatrixCell } from "@/lib/queries";

const COUNTRY_ORDER = ["US", "AE", "TR"];
const PAGE_ORDER = ["home", "pricing"];

function ordered(values: string[], preferred: string[]): string[] {
  const seen = Array.from(new Set(values));
  return seen.sort((a, b) => {
    const ia = preferred.indexOf(a);
    const ib = preferred.indexOf(b);
    const ra = ia === -1 ? preferred.length : ia;
    const rb = ib === -1 ? preferred.length : ib;
    return ra - rb || a.localeCompare(b);
  });
}

function cellClass(status: string | undefined): string {
  return `cell-${normalizeStatus(status)}`;
}

/**
 * Compact grid of colored squares (used in the sweeps list). One square per
 * country×page; title attributes carry the detail for hover/screen readers.
 */
export function SweepMatrixCompact({ cells }: { cells: MatrixCell[] }) {
  const countries = ordered(
    cells.map((c) => c.country),
    COUNTRY_ORDER,
  );
  const pages = ordered(
    cells.map((c) => c.pageKey),
    PAGE_ORDER,
  );
  const lookup = new Map(cells.map((c) => [`${c.country}::${c.pageKey}`, c.status]));

  return (
    <div
      className="matrix compact"
      style={{ gridTemplateColumns: `repeat(${pages.length || 1}, 16px)` }}
      role="img"
      aria-label="Run status by country and page"
    >
      {countries.flatMap((country) =>
        pages.map((page) => {
          const status = lookup.get(`${country}::${page}`);
          return (
            <span
              key={`${country}-${page}`}
              className={`matrix-cell ${cellClass(status)}`}
              title={`${country} / ${page}: ${status ?? "no run"}`}
            />
          );
        }),
      )}
    </div>
  );
}

/** Labelled matrix with axis headers (used on the sweep detail page). */
export function SweepMatrix({ cells }: { cells: MatrixCell[] }) {
  const countries = ordered(
    cells.map((c) => c.country),
    COUNTRY_ORDER,
  );
  const pages = ordered(
    cells.map((c) => c.pageKey),
    PAGE_ORDER,
  );
  const lookup = new Map(cells.map((c) => [`${c.country}::${c.pageKey}`, c.status]));

  return (
    <table className="matrix-table">
      <thead>
        <tr>
          <th />
          {pages.map((page) => (
            <th key={page}>{page}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {countries.map((country) => (
          <tr key={country}>
            <th scope="row">{country}</th>
            {pages.map((page) => {
              const status = lookup.get(`${country}::${page}`);
              return (
                <td key={page}>
                  <span className={`matrix-cell labelled ${cellClass(status)}`}>
                    {status ?? "—"}
                  </span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
