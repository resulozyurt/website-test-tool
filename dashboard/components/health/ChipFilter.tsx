import Link from "next/link";

/**
 * A URL-driven chip filter, shared by the health run detail page (status +
 * severity) and the health runs list (country). Same toggle semantics as the
 * geo sweep Filters — clicking the active value clears it — but styled with the
 * health design tokens so it reads correctly in dark mode. No client state:
 * every chip is a plain link that rewrites the query string.
 */

export type FilterValues = Record<string, string | undefined>;

export interface ChipGroup {
  label: string;
  field: string;
  options: string[];
}

/** Pure href builder: toggle `value` on `field`, keeping the rest of `current`. */
export function buildFilterHref(
  basePath: string,
  current: FilterValues,
  field: string,
  value: string,
): string {
  const next: FilterValues = { ...current };
  if (next[field] === value) {
    delete next[field];
  } else {
    next[field] = value;
  }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return `${basePath}${qs ? `?${qs}` : ""}`;
}

function Group({
  basePath,
  current,
  group,
}: {
  basePath: string;
  current: FilterValues;
  group: ChipGroup;
}) {
  if (group.options.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wide text-faint">
        {group.label}
      </span>
      {group.options.map((value) => {
        const active = current[group.field] === value;
        return (
          <Link
            key={value}
            href={buildFilterHref(basePath, current, group.field, value)}
            className={
              "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors " +
              (active
                ? "border-brand bg-brand-weak text-brand"
                : "border-line bg-card text-ink-2 hover:border-line-strong")
            }
          >
            {value}
          </Link>
        );
      })}
    </div>
  );
}

export function ChipFilter({
  basePath,
  current,
  groups,
}: {
  basePath: string;
  current: FilterValues;
  groups: ChipGroup[];
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-card px-4 py-3">
      {groups.map((g) => (
        <Group key={g.field} basePath={basePath} current={current} group={g} />
      ))}
    </div>
  );
}