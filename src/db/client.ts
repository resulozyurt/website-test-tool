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
  // A full crawl inspects pages for 15-80s at a time, so pooled connections sit
  // idle for long stretches and Railway's TCP proxy drops them. TCP keepalive
  // holds them open; a short idle timeout recycles the ones that die anyway.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

/**
 * CRITICAL: without this listener, an error on an *idle* pooled client is an
 * unhandled 'error' event, which Node turns into an uncaught exception and the
 * whole crawl dies. The pool discards the broken client on its own; all we have
 * to do is not crash. This is what killed run #9 mid-crawl.
 */
pool.on("error", (err: Error) => {
  console.warn(`  postgres idle client dropped (recovering): ${err.message}`);
});

/** Postgres/network errors that are worth retrying rather than failing on. */
const TRANSIENT_MESSAGE =
  /connection terminated|connection reset|socket hang up|terminating connection|server closed the connection|connection closed|read econnreset|epipe|etimedout|timeout exceeded when trying to connect/i;

const TRANSIENT_CODES = new Set([
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08003", // connection_does_not_exist
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "08006", // connection_failure
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
]);

export function isTransientDbError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code ?? "";
  if (code && TRANSIENT_CODES.has(code)) return true;
  const message = err instanceof Error ? err.message : String(err);
  return TRANSIENT_MESSAGE.test(message);
}

/**
 * Retries a database operation on transient connection failures with exponential
 * backoff. Non-transient errors (bad SQL, constraint violations) rethrow at once
 * -- retrying those would only hide a real bug.
 */
export async function withRetry<T>(
  op: () => Promise<T>,
  label = "query",
  attempts = 4,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await op();
    } catch (err) {
      lastError = err;
      if (!isTransientDbError(err) || attempt === attempts) {
        throw err;
      }
      const backoffMs = 500 * 2 ** (attempt - 1);
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `  db ${label} failed (attempt ${attempt}/${attempts}): ${message}` +
          ` -- retrying in ${backoffMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastError;
}

/** Runs a query and returns typed rows (retries transient failures). */
export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await withRetry(() => pool.query(text, params), "query");
  return result.rows as T[];
}

/** Closes the pool (call when a one-off script finishes). */
export async function closePool(): Promise<void> {
  await pool.end();
}