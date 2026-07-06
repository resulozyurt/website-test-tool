"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Severity } from "@/lib/types";
import { SEVERITY_COLOR, SEVERITY_LABEL } from "./chartTheme";

const AXIS = "var(--app-faint)";
const GRID = "var(--app-border)";
const MAX_BARS = 12;
const ROW_H = 26;

export interface DistributionDatum {
  severity: Severity;
  category: string;
  type: string;
  count: number;
}

function DistributionTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: DistributionDatum }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 shadow-sm">
      <div className="font-mono text-xs text-ink">{d.type}</div>
      <div className="mt-0.5 font-mono text-[11px] text-muted">
        {SEVERITY_LABEL[d.severity]} · {d.category}
      </div>
      <div className="mt-1 font-mono text-xs tabular-nums text-ink-2">
        {d.count} finding{d.count === 1 ? "" : "s"}
      </div>
    </div>
  );
}

export function FindingDistribution({ rows }: { rows: DistributionDatum[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (rows.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted">
        No findings in the latest runs.
      </div>
    );
  }

  const data = rows.slice(0, MAX_BARS);
  const severities = Array.from(new Set(data.map((d) => d.severity)));
  const height = data.length * ROW_H + 24;

  return (
    <div>
      <div style={{ height }}>
        {mounted && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 0, right: 12, bottom: 0, left: 4 }}
              barCategoryGap={6}
            >
              <XAxis
                type="number"
                allowDecimals={false}
                tick={{ fill: AXIS, fontSize: 11 }}
                tickLine={{ stroke: GRID }}
                axisLine={{ stroke: GRID }}
              />
              <YAxis
                type="category"
                dataKey="type"
                width={148}
                tick={{ fill: AXIS, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: GRID }}
              />
              <Tooltip
                content={<DistributionTooltip />}
                cursor={{ fill: "var(--app-elev)" }}
              />
              <Bar dataKey="count" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.type} fill={SEVERITY_COLOR[d.severity]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {severities.map((s) => (
          <span key={s} className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
            <span
              className="inline-block h-2 w-2 rounded-[2px]"
              style={{ background: SEVERITY_COLOR[s] }}
              aria-hidden="true"
            />
            {SEVERITY_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}