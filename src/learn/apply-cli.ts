/**
 * Applies reviewed learning proposals.
 *
 * Reads learn-output/proposals.json and upserts every approved entry into the
 * `expectations` table as source='manual' (+ checksum), inside one transaction.
 * Manual rows take priority over manifest and are never overwritten by
 * `npm run manifest:sync`.
 *
 * Prerequisite: `npm run seed` (markets/pages must exist to resolve against).
 *
 * Usage: npm run learn:apply
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { closePool, pool } from "../db/client.js";
import {
  getMarketByCountryLanguage,
  getPageByKey,
  upsertExpectation,
} from "../db/repository.js";
import { checksumOf } from "../manifest/checksum.js";
import type { ProposalsFile } from "./learn.js";

const INPUT = join("learn-output", "proposals.json");

async function main(): Promise<void> {
  const raw = await readFile(INPUT, "utf8");
  const file = JSON.parse(raw) as ProposalsFile;

  const client = await pool.connect();
  let applied = 0;
  let skipped = 0;
  try {
    await client.query("begin");
    for (const p of file.proposals) {
      const label = `${p.country}/${p.language}/${p.pageKey}`;

      if (!p.approved) {
        console.log(`skip ${label} (approved=false)`);
        skipped += 1;
        continue;
      }

      const market = await getMarketByCountryLanguage(p.country, p.language, client);
      const page = await getPageByKey(p.pageKey, client);
      if (!market || !page) {
        console.log(`skip ${label} (not seeded -- run npm run seed)`);
        skipped += 1;
        continue;
      }

      await upsertExpectation(
        {
          marketId: market.id,
          pageId: page.id,
          source: "manual",
          payload: p.payload,
          checksum: checksumOf(p.payload),
        },
        client,
      );
      console.log(`apply ${label} -> manual`);
      applied += 1;
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  console.log(`\napplied=${applied} skipped=${skipped}`);
}

main()
  .catch((err) => {
    console.error("apply failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());