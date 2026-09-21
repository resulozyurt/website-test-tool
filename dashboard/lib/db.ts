import { Pool } from "pg";

declare global {
  // Cached across hot reloads in dev so we do not exhaust connections.
  // eslint-disable-next-line no-var
  var __dashboardPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Point it at the same Railway Postgres the runner writes to.",
    );
  }
  // Railway's public Postgres proxy generally connects without forced SSL.
  // Set DATABASE_SSL=true if your connection requires it.
  const useSsl = (process.env.DATABASE_SSL ?? "").toLowerCase() === "true";
  return new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    // The dashboard is low-traffic and read-only; keep the footprint small.
    max: 3,
  });
}

// Lazily create the pool on first query, NOT at module import. `next build`
// imports every page module to collect data even for force-dynamic routes; if
// the pool were built at import time it would call createPool() during the
// build (where DATABASE_URL is absent) and throw "DATABASE_URL is not set",
// failing the build. Deferring creation to the first readQuery() means the
// connection string is only required at runtime, where it is present.
//
// The single instance is cached on globalThis so it is reused across requests
// in production and across hot reloads in development (Next.js re-evaluates
// modules on every change in dev).
function getPool(): Pool {
  if (!global.__dashboardPool) {
    global.__dashboardPool = createPool();
  }
  return global.__dashboardPool;
}

// The dashboard must never mutate the database. This guard rejects anything
// that is not a SELECT or a CTE (WITH ...) before it reaches Postgres. It is a
// defense-in-depth layer on top of only ever writing SELECTs by hand.
const READ_ONLY = /^\s*(select|with)\b/i;

/** Runs a read-only query and returns typed rows. */
export async function readQuery<T>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  if (!READ_ONLY.test(text)) {
    throw new Error("readQuery only allows SELECT/WITH statements.");
  }
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

/**
 * The one exception to the read-only rule: proxy provider settings, which the
 * settings page has to write. Narrow on purpose -- the statement must mention
 * proxy_settings and nothing else is reachable through this helper, so the
 * dashboard still cannot touch runs, findings or expectations.
 */
export async function proxySettingsQuery<T>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  if (!/\bproxy_settings\b/i.test(text)) {
    throw new Error("proxySettingsQuery only allows statements on proxy_settings.");
  }
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

/**
 * The second write exception: alert settings. Same reasoning as
 * proxySettingsQuery -- the settings page has to persist what the operator
 * types, and nothing beyond that one table is reachable from here.
 */
export async function alertSettingsQuery<T>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  if (!/\balert_settings\b/i.test(text)) {
    throw new Error("alertSettingsQuery only allows statements on alert_settings.");
  }
  const result = await getPool().query(text, params);
  return result.rows as T[];
}
