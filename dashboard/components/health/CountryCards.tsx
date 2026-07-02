import Link from "next/link";
import type { CountryHealthView } from "@/lib/queries";
import type { CountryCode } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { StatusPill } from "./StatusPill";

const COUNTRY_LABEL: Record<CountryCode, { name: string; lang: string }> = {
  US: { name: "United States", lang: "en" },
  TR: { name: "Turkey", lang: "tr" },
  AE: { name: "UAE", lang: "en" },
};

const ALL_COUNTRIES: CountryCode[] = ["US", "TR", "AE"];

function meterColor(rate: number): string {
  if (rate >= 0.995) return "var(--st-ok)";
  if (rate >= 0.9) return "var(--st-warn)";
  return "var(--st-bad)";
}

export function CountryCards({ rows }: { rows: CountryHealthView[] }) {
  const byCountry = new Map<CountryCode, CountryHealthView>();
  for (const r of rows) byCountry.set(r.country, r);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {ALL_COUNTRIES.map((code) => {
        const label = COUNTRY_LABEL[code];
        const data = byCountry.get(code);

        if (!data) {
          return (
            <div
              key={code}
              className="rounded-xl border border-line bg-card p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-medium">{label.name}</span>
                <span className="rounded-md bg-elev px-2 py-0.5 font-mono text-xs text-muted">
                  {code} · {label.lang}
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between text-sm text-faint">
                <span>Not run yet</span>
                <span className="font-mono">—</span>
              </div>
            </div>
          );
        }

        const rate = data.pagesTotal > 0 ? data.pagesOk / data.pagesTotal : 0;
        const issues = data.pagesFail + data.pagesWarn;
        return (
          <Link
            key={code}
            href={`/health/${data.runId}`}
            className="rounded-xl border border-line bg-card p-4 transition-colors hover:border-line-strong"
          >
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-medium">{label.name}</span>
              <span className="rounded-md bg-elev px-2 py-0.5 font-mono text-xs text-muted">
                {code} · {label.lang}
              </span>
            </div>

            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-elev">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.round(rate * 100)}%`,
                  background: meterColor(rate),
                }}
              />
            </div>

            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="font-mono text-muted">
                {data.pagesOk}/{data.pagesTotal} pass
              </span>
              {issues > 0 ? (
                <span className="font-mono text-[var(--st-bad-fg)]">
                  {issues} issue{issues === 1 ? "" : "s"}
                </span>
              ) : (
                <StatusPill status="pass" />
              )}
            </div>

            <div className="mt-3 font-mono text-xs text-faint">
              {formatDateTime(data.startedAt)}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
