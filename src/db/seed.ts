/**
 * Idempotent seed: writes the static config from src/config/targets.ts
 * (environments, markets, pages) into the database. Safe to run repeatedly --
 * existing rows are updated in place via upsert, never duplicated. Runs inside
 * a single transaction, so a failure leaves the tables untouched.
 *
 * Usage: npm run seed
 */

import { ENVIRONMENTS, MARKETS, PAGES } from "../config/targets.js";
import { closePool, pool } from "./client.js";
import { upsertEnvironment, upsertMarket, upsertPage } from "./repository.js";

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    for (const environment of ENVIRONMENTS) {
      const row = await upsertEnvironment(environment, client);
      console.log(
        `environment ${row.key} -> #${row.id} ` +
          `(active=${row.isActive}, base_url=${row.baseUrl || "(none)"})`,
      );
    }

    for (const market of MARKETS) {
      const row = await upsertMarket(market, client);
      console.log(
        `market ${row.countryCode}/${row.language} -> #${row.id} (active=${row.isActive})`,
      );
    }

    for (const page of PAGES) {
      const row = await upsertPage(page, client);
      console.log(`page ${row.pageKey} -> #${row.id} (active=${row.isActive})`);
    }

    await client.query("commit");
    console.log("seed complete");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error("seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());