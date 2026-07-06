/**
 * Shared theming and data-shaping for the overview charts.
 *
 * No React or Recharts imports live here on purpose: everything is either a
 * plain color map or a pure function, so it can be unit-tested in isolation and
 * imported by server or client code alike. Colors are CSS-variable strings from
 * globals.css, so light/dark themes switch automatically at render time.
 */

import type { CountryCode, Severity } from "@/lib/types";

/**
 * Severity keeps the console's status vocabulary: critical reads as a failure,
 * major as a warning, minor as informational. These are the only chromatic
 * colors the distribution chart uses.
 */
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "var(--st-bad)",
  major: "var(--st-warn)",
  minor: "var(--st-info)",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};

/**
 * The trend lines are structural, not health signals, so they deliberately
 * avoid the status palette (a red line must never be mistaken for a failure).
 * Each country gets one restrained, theme-native stroke.
 */
export const COUNTRY_STROKE: Record<string, string> = {
  US: "var(--app-text)",
  TR: "var(--app-accent)",
  AE: "var(--app-muted)",
};

export function countryStroke(country: string): string {
  return COUNTRY_STROKE[country] ?? "var(--app-faint)";
}

/** Preferred, stable country ordering for legends and series. */
const COUNTRY_ORDER: CountryCode[] = ["US", "AE", "TR"];

/** One (country, run) sample fed to the trend chart. passRate is 0..100. */
export interface TrendPoint {
  country: string;
  dateLabel: string;
  passRate: number;
}

/** Pivoted trend data: one row per date, one numeric field per country. */
export interface TrendData {
  data: Array<Record<string, string | number>>;
  countries: string[];
}

/**
 * Pivot flat (country, date, passRate) samples into per-date rows keyed by
 * country, which is the shape Recharts wants for a multi-line chart. Input is
 * expected oldest-first; Map preserves insertion order, so the output stays
 * chronological by first-seen date.
 */
export function pivotTrend(points: TrendPoint[]): TrendData {
  const seen: string[] = [];
  const byDate = new Map<string, Record<string, string | number>>();

  for (const p of points) {
    if (!seen.includes(p.country)) seen.push(p.country);
    let row = byDate.get(p.dateLabel);
    if (!row) {
      row = { date: p.dateLabel };
      byDate.set(p.dateLabel, row);
    }
    row[p.country] = p.passRate;
  }

  const countries = seen.sort((a, b) => {
    const ia = COUNTRY_ORDER.indexOf(a as CountryCode);
    const ib = COUNTRY_ORDER.indexOf(b as CountryCode);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  return { data: Array.from(byDate.values()), countries };
}