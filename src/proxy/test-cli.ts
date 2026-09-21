/**
 * Proxy connectivity check.
 *
 *   npm run proxy:test                  # every market's active proxy
 *   npm run proxy:test -- --country=TR  # one market
 *   npm run proxy:test -- --id=3        # one saved setting, result recorded
 *
 * Reports the exit IP, the country the site resolved it to, and the cache
 * bucket that IP lands in -- the three facts that decide whether a provider
 * can be trusted with the suite.
 */

import { closePool } from "../db/client.js";
import { buildProxy, getProvider } from "../config/proxy-providers.js";
import { MARKETS } from "../config/targets.js";
import { loadProxyOverrides, resolveProxy } from "../runner/proxy.js";
import type { CountryCode } from "../types.js";
import { getProxySetting, recordProxyTest } from "./store.js";
import { verifyProxy } from "./verify.js";

function parseCountry(value: string): CountryCode {
  const c = value.toUpperCase();
  if (c !== "US" && c !== "AE" && c !== "TR") {
    throw new Error(`unknown country "${value}" (expected US, AE or TR)`);
  }
  return c;
}

function line(country: CountryCode, source: string, r: Awaited<ReturnType<typeof verifyProxy>>): string {
  const verdict = r.ok ? "OK" : r.countryMismatch ? "WRONG COUNTRY" : "FAIL";
  const parts = [
    `${country} [${source}] -> ${verdict}`,
    `ip=${r.exitIp ?? "?"}`,
    `site=${r.siteCountry ?? "?"}`,
    `cache=${r.cacheCountry ?? "?"}`,
    `${(r.durationMs / 1000).toFixed(1)}s`,
  ];
  if (r.error) {
    parts.push(`error=${r.error}`);
  }
  return parts.join("  ");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let only: CountryCode | undefined;
  let settingId: number | undefined;
  for (const arg of argv) {
    if (arg.startsWith("--country=")) {
      only = parseCountry(arg.slice("--country=".length));
    } else if (arg.startsWith("--id=")) {
      settingId = Number(arg.slice("--id=".length));
      if (!Number.isInteger(settingId) || settingId <= 0) {
        throw new Error(`invalid --id "${arg}"`);
      }
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }

  // Testing one saved row: build it directly, so a provider can be verified
  // before it is ever activated.
  if (settingId) {
    const setting = await getProxySetting(settingId);
    if (!setting) {
      throw new Error(`proxy setting #${settingId} not found`);
    }
    const provider = getProvider(setting.providerId);
    if (!provider) {
      throw new Error(`unknown provider "${setting.providerId}"`);
    }
    const built = buildProxy(provider, setting.credentials, setting.country);
    const result = await verifyProxy(setting.country, {
      server: built.server,
      username: built.username,
      password: built.password,
      session: provider.session,
      providerId: provider.id,
    });
    console.log(line(setting.country, provider.name, result));
    await recordProxyTest(settingId, result.ok, result);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const report = await loadProxyOverrides();
  for (const err of report.errors) {
    console.warn(`  ! ${err}`);
  }

  const countries = only
    ? [only]
    : [...new Set(MARKETS.filter((m) => m.isActive).map((m) => m.country))];

  let failures = 0;
  for (const country of countries) {
    const proxy = resolveProxy(country);
    if (!proxy) {
      console.log(`${country} -> NO PROXY CONFIGURED (panel setting or PROXY_${country})`);
      failures += 1;
      continue;
    }
    const source = proxy.providerId ?? "env";
    const result = await verifyProxy(country, proxy);
    console.log(line(country, source, result));
    if (!result.ok) {
      failures += 1;
    }
  }
  process.exitCode = failures > 0 ? 1 : 0;
}

main()
  .catch((err) => {
    console.error("proxy:test failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
