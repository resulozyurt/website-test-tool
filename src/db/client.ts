import { Pool } from "pg";
import { env } from "../config/env.js";

if (!env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Add the Railway DATABASE_PUBLIC_URL to your .env.",
  );
}

// Railway's public Postgres proxy generally connects without forced SSL. If you
// ever hit an SSL-related connection error, set DATABASE_SSL=true in your .env.
const useSsl = (process.env.DATABASE_SSL ?? "").toLowerCase() === "true";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  max: 5,
});

/** Runs a query and returns typed rows. */
export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

/** Closes the pool (call when a one-off script finishes). */
export async function closePool(): Promise<void> {
  await pool.end();
}