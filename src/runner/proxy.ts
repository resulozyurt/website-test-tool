import { anonymizeProxy, closeAnonymizedProxy } from "proxy-chain";
import type { CountryCode } from "../types.js";

/** Playwright-compatible proxy configuration. */
export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

/** Environment variable name holding a country's proxy URL (PROXY_US, ...). */
export function proxyEnvKey(country: CountryCode): string {
  return `PROXY_${country}`;
}

/**
 * Reads the proxy URL for a country from the environment and converts it into
 * the structure Playwright expects. Returns null when the variable is empty so
 * the caller can record a clear "proxy not configured" result instead of
 * crashing.
 *
 * Accepted input format: http://USERNAME:PASSWORD@HOST:PORT
 * (DataImpulse encodes country + sticky session inside the username.)
 */
export function resolveProxy(country: CountryCode): ProxyConfig | null {
  const raw = process.env[proxyEnvKey(country)];
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  const parsed = new URL(raw.trim());
  const config: ProxyConfig = { server: `${parsed.protocol}//${parsed.host}` };
  if (parsed.username) {
    config.username = decodeURIComponent(parsed.username);
  }
  if (parsed.password) {
    config.password = decodeURIComponent(parsed.password);
  }
  return config;
}

/**
 * DataImpulse pins a sticky IP via ";sessid.<id>" in the username. Replacing
 * the id (or appending one) forces a different exit IP, which lets us tell
 * whether a block is specific to one IP or affects the whole country pool.
 * Reserved for a future retry path; exported so later steps can use it.
 */
export function withFreshSession(proxy: ProxyConfig): ProxyConfig {
  if (!proxy.username) {
    return proxy;
  }
  const token = `r${Math.random().toString(36).slice(2, 10)}`;
  const hasSession = /;sessid\.[^;]+/.test(proxy.username);
  const username = hasSession
    ? proxy.username.replace(/;sessid\.[^;]+/, `;sessid.${token}`)
    : `${proxy.username};sessid.${token}`;
  return { ...proxy, username };
}

/**
 * Rebuilds the full upstream proxy URL (with credentials) from a ProxyConfig.
 * resolveProxy stores the username/password already decoded, so we re-encode
 * each component once; proxy-chain decodes them back when it authenticates to
 * the upstream. Building the string by hand avoids the URL setter's broader
 * userinfo encode set and keeps the round-trip unambiguous.
 */
function toUpstreamUrl(proxy: ProxyConfig): string {
  const base = new URL(proxy.server);
  if (!proxy.username) {
    return base.toString();
  }
  const user = encodeURIComponent(proxy.username);
  const pass = encodeURIComponent(proxy.password ?? "");
  return `${base.protocol}//${user}:${pass}@${base.host}`;
}

/**
 * Starts a local, unauthenticated forwarding proxy (proxy-chain) that points at
 * the authenticated upstream, and returns its local URL (http://127.0.0.1:PORT).
 *
 * Why: recent Chromium builds fail authenticated proxy navigation with
 * net::ERR_PROXY_AUTH_UNSUPPORTED -- the browser cannot complete the proxy auth
 * handshake even though Node's HTTP client can. Pointing Chromium at a local
 * proxy with no auth removes the handshake entirely; proxy-chain adds the
 * upstream credentials on the Node side (which works). The sticky session is
 * preserved because the upstream username (including ";sessid.<id>") is passed
 * through unchanged for the relay's lifetime.
 *
 * One relay is opened per page visit and must be closed with closeProxyRelay.
 */
export async function openProxyRelay(proxy: ProxyConfig): Promise<string> {
  return anonymizeProxy(toUpstreamUrl(proxy));
}

/** Stops a relay started by openProxyRelay and frees its local port. */
export async function closeProxyRelay(localUrl: string): Promise<void> {
  await closeAnonymizedProxy(localUrl, true);
}