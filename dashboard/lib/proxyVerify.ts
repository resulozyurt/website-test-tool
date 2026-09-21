import { ProxyAgent, request as undiciRequest } from "undici";
import type { ProxyTestDetail } from "./proxySettings";
import type { CountryCode } from "./proxy-providers.generated";

/**
 * Connectivity test, run from the panel.
 *
 * Asks three separate questions, because a provider can pass one and fail the
 * next: does the tunnel work (exit IP), does the site resolve that IP to the
 * country we asked for (whereami), and which cache bucket does it land in
 * (x-geoip-caching). The second is the one that silently ruins a test suite --
 * a datacenter IP geolocated to the wrong country makes every later check
 * measure the wrong experience while still reporting green.
 *
 * Read-only against the live site: one GET to a monitoring endpoint.
 */

const WHEREAMI_PATH = "/wp-json/fieldpie-monitor/v1/whereami";
const IP_ECHO_URL = "https://api.ipify.org?format=json";
const TIMEOUT_MS = 25000;

export interface ProxyVerifyResult extends ProxyTestDetail {
  ok: boolean;
  countryMismatch: boolean;
  durationMs: number;
}

export async function verifyProxy(
  country: CountryCode,
  proxy: { server: string; username: string; password: string },
): Promise<ProxyVerifyResult> {
  const startedAt = Date.now();
  const detail: ProxyTestDetail = {
    exitIp: null,
    siteCountry: null,
    cacheCountry: null,
    httpStatus: null,
    error: null,
  };

  const token =
    "Basic " +
    Buffer.from(`${proxy.username}:${proxy.password}`, "utf8").toString("base64");
  const agent = new ProxyAgent({
    uri: proxy.server,
    token,
    connectTimeout: TIMEOUT_MS,
    headersTimeout: TIMEOUT_MS,
    bodyTimeout: TIMEOUT_MS,
  });

  try {
    try {
      const res = await undiciRequest(IP_ECHO_URL, { dispatcher: agent });
      const body = (await res.body.json()) as { ip?: string };
      detail.exitIp = body.ip ?? null;
    } catch (err) {
      detail.error = `exit ip lookup failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    const base = process.env.TARGET_BASE_URL ?? "https://www.fieldpie.com";
    const headers: Record<string, string> = { accept: "application/json" };
    if (process.env.MANIFEST_SECRET) {
      headers["x-monitor-secret"] = process.env.MANIFEST_SECRET;
    }
    if (process.env.MONITOR_USER_AGENT) {
      headers["user-agent"] = process.env.MONITOR_USER_AGENT;
    }

    try {
      const res = await undiciRequest(new URL(WHEREAMI_PATH, base).toString(), {
        dispatcher: agent,
        headers,
      });
      detail.httpStatus = res.statusCode;
      const cacheHeader = res.headers["x-geoip-caching"];
      detail.cacheCountry = Array.isArray(cacheHeader)
        ? cacheHeader[0] ?? null
        : cacheHeader ?? null;
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const data = (await res.body.json()) as { country?: string | null };
        detail.siteCountry = data.country ?? null;
      } else {
        await res.body.dump();
        if (!detail.error) detail.error = `whereami http ${res.statusCode}`;
      }
    } catch (err) {
      if (!detail.error) {
        detail.error = err instanceof Error ? err.message : String(err);
      }
    }
  } finally {
    await agent.close().catch(() => undefined);
  }

  const seen = (detail.siteCountry ?? detail.cacheCountry ?? "").toUpperCase();
  const countryMismatch = seen.length > 0 && seen !== country.toUpperCase();
  const ok = Boolean(detail.exitIp) && seen === country.toUpperCase();
  return { ...detail, ok, countryMismatch, durationMs: Date.now() - startedAt };
}
