import Link from "next/link";

export interface FilterState {
  country?: string;
  page?: string;
  status?: string;
}

function buildHref(
  sweepId: number,
  current: FilterState,
  key: keyof FilterState,
  value: string,
): string {
  // Toggle: clicking the active value clears it back to "all".
  const next: FilterState = { ...current };
  if (current[key] === value) {
    delete next[key];
  } else {
    next[key] = value;
  }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return `/sweeps/${sweepId}${qs ? `?${qs}` : ""}`;
}

function Group({
  sweepId,
  current,
  label,
  field,
  options,
}: {
  sweepId: number;
  current: FilterState;
  label: string;
  field: keyof FilterState;
  options: string[];
}) {
  if (options.length === 0) return null;
  return (
    <div className="filter-group">
      <span className="label">{label}</span>
      {options.map((value) => {
        const active = current[field] === value;
        return (
          <Link
            key={value}
            href={buildHref(sweepId, current, field, value)}
            className={`chip${active ? " active" : ""}`}
          >
            {value}
          </Link>
        );
      })}
    </div>
  );
}

export function Filters({
  sweepId,
  current,
  countries,
  pages,
}: {
  sweepId: number;
  current: FilterState;
  countries: string[];
  pages: string[];
}) {
  return (
    <div className="card filters">
      <Group
        sweepId={sweepId}
        current={current}
        label="Country"
        field="country"
        options={countries}
      />
      <Group
        sweepId={sweepId}
        current={current}
        label="Page"
        field="page"
        options={pages}
      />
      <Group
        sweepId={sweepId}
        current={current}
        label="Status"
        field="status"
        options={["pass", "warn", "fail", "error"]}
      />
    </div>
  );
}
