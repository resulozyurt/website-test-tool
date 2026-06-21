/**
 * AE proxy geo probe.
 *
 * The AE proxy currently exits in AE (per ip-api) but the SITE detects US
 * (whereami) -- DataImpulse's AE exit IPs are classified as US by the GeoIP
 * database Kinsta uses. This script tries several fresh sticky sessions and, for
 * each, reports both views, so we can decide:
 *   - if whereami returns AE for some session  -> rotation works; add a
 *     geo-mismatch retry to the runner.
 *   - if it is always US                        -> the AE pool is mis-classified;
 *     the proxy targeting/provider needs to change.
 *
 * Read-only: GET requests only, through the same relay technique the app uses.
 *
 * Run from the repo root:
 *   npx tsx ae-geo-probe.ts
 */

import "dotenv/config";
import { request } from "playwright";
import { anonymizeProxy, closeAnonymizedProxy } from "proxy-chain";

const WHEREAMI_PATH = "/wp-json/fieldpie-monitor/v1/whereami";
const ATTEMPTS = 5;

/** Builds an upstream URL with a fresh DataImpulse sticky session (sessid). */
function freshUpstream(raw: string, token: string): string {
  const parsed = new URL(raw.trim());
  const user0 = decodeURIComponent(parsed.username);
  const hasSession = /;sessid\.[^;]+/.test(user0);
  const user = hasSession
    ? user0.replace(/;sessid\.[^;]+/, `;sessid.${token}`)
    : `${user0};sessid.${token}`;
  const pass = decodeURIComponent(parsed.password);
  return `${parsed.protocol}//${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${parsed.host}`;
}

async function probe(
  index: number,
  raw: string,
  base: string,
  secret: string,
  userAgent: string | undefined,
): Promise<void> {
  const token = `probe${index}${Math.random().toString(36).slice(2, 8)}`;
  const relayUrl = await anonymizeProxy(freshUpstream(raw, token));
  const ctx = await request.newContext({ proxy: { server: relayUrl } });

  let exit = "?";
  let site = "?";
  try {
    const r1 = await ctx.get(
      "http://ip-api.com/json/?fields=status,countryCode,query",
      { timeout: 20000 },
    );
    const d1 = (await r1.json()) as { countryCode?: string };
    exit = d1.countryCode ?? "?";
  } catch {
    exit = "err";
  }
  try {
    const url = new URL(WHEREAMI_PATH, base).toString();
    const headers: Record<string, string> = {
      "X-Monitor-Secret": secret,
      Accept: "application/json",
    };
    if (userAgent) {
      headers["User-Agent"] = userAgent;
    }
    const r2 = await ctx.get(url, { headers, timeout: 20000 });
    if (r2.ok()) {
      const d2 = (await r2.json()) as { country?: string | null };
      site = d2.country ?? "?";
    } else {
      site = `http ${r2.status()}`;
    }
  } catch {
    site = "err";
  }

  await ctx.dispose();
  await closeAnonymizedProxy(relayUrl, true);

  const verdict = exit === "AE" && site === "AE" ? "  <-- AE confirmed" : "";
  console.log(
    `#${index}  exit(ip-api)=${exit.padEnd(3)}  site(whereami)=${site}${verdict}`,
  );
}

async function main(): Promise<void> {
  const raw = process.env.PROXY_AE;
  if (!raw || raw.trim().length === 0) {
    console.error("PROXY_AE is not set in .env.");
    process.exitCode = 1;
    return;
  }
  const base = process.env.TARGET_BASE_URL ?? "https://www.fieldpie.com";
  const secret = (process.env.MANIFEST_SECRET ?? "").trim();
  const userAgent = (process.env.MONITOR_USER_AGENT ?? "").trim() || undefined;
  if (!secret) {
    console.error("MANIFEST_SECRET is not set; whereami cannot be queried.");
    process.exitCode = 1;
    return;
  }

  console.log(`probing AE proxy ${ATTEMPTS} times (target=${base}) ...`);
  for (let i = 1; i <= ATTEMPTS; i += 1) {
    await probe(i, raw, base, secret, userAgent);
  }
  console.log(
    "\nIf any line shows site(whereami)=AE, rotation can fix AE.\n" +
      "If every line shows site=US, the AE pool is GeoIP-misclassified.",
  );
}

main().catch((err) => {
  console.error("probe crashed:", err);
  process.exitCode = 1;
});