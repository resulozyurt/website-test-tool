"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  countryStroke,
  pivotTrend,
  type TrendPoint,
} from "./chartTheme";

const HEIGHT = 240;
const AXIS = "var(--app-faint)";
const GRID = "var(--app-border)";

interface TooltipPayloadItem {
  dataKey: string;
  value: number;
  color: string;
}

function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 shadow-sm">
      <div className="mb-1 font-mono text-[11px] text-muted">{label}</div>
      {payload.map((item) => (
        <div
          key={item.dataKey}
          className="flex items-center gap-2 font-mono text-xs"
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: item.color }}
            aria-hidden="true"
          />
          <span className="text-ink-2">{item.dataKey}</span>
          <span className="ml-auto tabular-nums text-ink">{item.value}%</span>
        </div>
      ))}
    </div>
  );
}

export function PassRateTrend({ points }: { points: TrendPoint[] }) {
  // Recharts measures its container on the client; render a spacer during SSR
  // so the initial HTML matches and hydration stays quiet.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { data, countries } = pivotTrend(points);

  if (data.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-muted">
        Not enough runs yet to chart a trend.
      </div>
    );
  }

  return (
    <div>
      <div style={{ height: HEIGHT }}>
        {mounted && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 8, right: 12, bottom: 4, left: -12 }}
            >
              <CartesianGrid stroke={GRID} strokeDasharray="2 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: AXIS, fontSize: 11 }}
                tickLine={{ stroke: GRID }}
                axisLine={{ stroke: GRID }}
                minTickGap={16}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 50, 100]}
                width={40}
                tick={{ fill: AXIS, fontSize: 11 }}
                tickLine={{ stroke: GRID }}
                axisLine={{ stroke: GRID }}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                content={<TrendTooltip />}
                cursor={{ stroke: GRID, strokeDasharray: "3 3" }}
              />
              {countries.map((c) => (
                <Line
                  key={c}
                  type="monotone"
                  dataKey={c}
                  stroke={countryStroke(c)}
                  strokeWidth={1.75}
                  dot={{ r: 2, strokeWidth: 0, fill: countryStroke(c) }}
                  activeDot={{ r: 3.5 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {countries.map((c) => (
          <span key={c} className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: countryStroke(c) }}
              aria-hidden="true"
            />
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}