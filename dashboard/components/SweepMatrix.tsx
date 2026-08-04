import { normalizeStatus, type StatusKey } from "@/lib/format";
import type { MatrixCell } from "@/lib/queries";

const COUNTRY_ORDER = ["US", "AE", "TR"];
const PAGE_ORDER = ["home", "pricing"];

/** Cell fill/border per status, using the console's status tokens. */
const CELL: Record<StatusKey, string> = {
  pass: "bg-[var(--st-ok-bg)] border-[var(--st-ok)] text-[var(--st-ok-fg)]",
  warn: "bg-[var(--st-warn-bg)] border-[var(--st-warn)] text-[var(--st-warn-fg)]",
  fail: "bg-[var(--st-bad-bg)] border-[var(--st-bad)] text-[var(--st-bad-fg)]",
  error: "bg-[var(--st-err-bg)] border-[var(--st-err)] text-[var(--st-err-fg)]",
  running: "bg-[var(--st-info-bg)] border-[var(--st-info)] text-[var(--st-info-fg)]",
  unknown: "bg-[var(--st-none)] border-line-strong text-[var(--st-none-fg)]",
};

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

function axes(cells: MatrixCell[]) {
  const countries = ordered(
    cells.map((c) => c.country),
    COUNTRY_ORDER,
  );
  const pages = ordered(
    cells.map((c) => c.pageKey),
    PAGE_ORDER,
  );
  const lookup = new Map(
    cells.map((c) => [`${c.country}::${c.pageKey}`, c.status]),
  );
  return { countries, pages, lookup };
}

/**
 * Compact grid of colored squares (used in the sweeps list). One square per
 * country×page; title attributes carry the detail for hover/screen readers.
 */
export function SweepMatrixCompact({ cells }: { cells: MatrixCell[] }) {
  const { countries, pages, lookup } = axes(cells);

  return (
    <div
      className="inline-grid gap-1"
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
              className={
                "h-4 w-4 rounded-[4px] border " +
                CELL[normalizeStatus(status)]
              }
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
  const { countries, pages, lookup } = axes(cells);

  return (
    <table className="border-separate border-spacing-1">
      <thead>
        <tr>
          <th />
          {pages.map((page) => (
            <th
              key={page}
              className="px-1 text-left font-mono text-[11px] font-medium text-muted"
            >
              {page}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {countries.map((country) => (
          <tr key={country}>
            <th
              scope="row"
              className="px-1 text-left font-mono text-[11px] font-medium text-muted"
            >
              {country}
            </th>
            {pages.map((page) => {
              const status = lookup.get(`${country}::${page}`);
              return (
                <td key={page}>
                  <span
                    className={
                      "flex h-[30px] min-w-[96px] items-center rounded-[4px] border px-2.5 font-mono text-[11px] font-semibold " +
                      CELL[normalizeStatus(status)]
                    }
                  >
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