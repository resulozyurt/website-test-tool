/**
 * Connectivity test for a proxy configuration.
 *
 * Three questions decide whether a provider is usable, and they are not the
 * same question: does the proxy work at all, is its exit IP in the country we
 * asked for, and -- the one that actually matters -- does fieldpie.com resolve
 * that IP to the same country? A datacenter IP that MaxMind places elsewhere
 * would quietly make the whole suite test the wrong cache bucket while every
 * check passes. One request to the site's own whereami endpoint answers the
 * third, and its x-geoip-caching header names the bucket outright.
 *
 * Read-only against the live site: a single GET to a monitoring endpoint.
 */

import { request as playwrightRequest } from "playwright";
import { env } from "../config/env.js";
import type { CountryCode } from "../types.js";
import type { ProxyConfig } from "../runner/proxy.js";
import type { ProxyTestDetail } from "./store.js";

const WHEREAMI_PATH = "/wp-json/fieldpie-monitor/v1/whereami";
const IP_ECHO_URL = "https://api.ipify.org?format=json";

export interface ProxyVerifyResult extends ProxyTestDetail {
  ok: boolean;
  /** Set when the exit country and the requested country disagree. */
  countryMismatch: boolean;
  durationMs: number;
}

export async function verifyProxy(
  country: CountryCode,
  proxy: ProxyConfig,
  timeoutMs = 30000,
): Promise<ProxyVerifyResult> {
  const startedAt = Date.now();
  const detail: ProxyTestDetail = {
    exitIp: null,
    siteCountry: null,
    cacheCountry: null,
    httpStatus: null,
    error: null,
  };

  let context;
  try {
    context = await playwrightRequest.newContext({
      proxy: {
        server: proxy.server,
        username: proxy.username,
        password: proxy.password,
      },
      timeout: timeoutMs,
      ignoreHTTPSErrors: false,
    });
  } catch (err) {
    detail.error = err instanceof Error ? err.message : String(err);
    return {
      ...detail,
      ok: false,
      countryMismatch: false,
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    // Exit IP first: when this fails, the credentials or balance are the
    // problem and the site request would only produce a confusing second error.
    try {
      const ipRes = await context.get(IP_ECHO_URL, { timeout: timeoutMs });
      if (ipRes.ok()) {
        const body = (await ipRes.json()) as { ip?: string };
        detail.exitIp = body.ip ?? null;
      }
    } catch (err) {
      detail.error = `exit ip lookup failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (env.MANIFEST_SECRET) {
      headers["X-Monitor-Secret"] = env.MANIFEST_SECRET;
    }
    if (env.MONITOR_USER_AGENT) {
      headers["User-Agent"] = env.MONITOR_USER_AGENT;
    }

    const url = new URL(WHEREAMI_PATH, env.TARGET_BASE_URL).toString();
    const res = await context.get(url, { headers, timeout: timeoutMs });
    detail.httpStatus = res.status();
    detail.cacheCountry = res.headers()["x-geoip-caching"] ?? null;
    if (res.ok()) {
      try {
        const data = (await res.json()) as { country?: string | null };
        detail.siteCountry = data.country ?? null;
      } catch {
        detail.error = "whereami returned a non-JSON body";
      }
    } else if (!detail.error) {
      detail.error = `whereami http ${res.status()}`;
    }
  } catch (err) {
    detail.error = err instanceof Error ? err.message : String(err);
  } finally {
    await context.dispose().catch(() => undefined);
  }

  const seen = (detail.siteCountry ?? detail.cacheCountry ?? "").toUpperCase();
  const countryMismatch = seen.length > 0 && seen !== country.toUpperCase();
  const ok = Boolean(detail.exitIp) && seen === country.toUpperCase();

  return { ...detail, ok, countryMismatch, durationMs: Date.now() - startedAt };
}
