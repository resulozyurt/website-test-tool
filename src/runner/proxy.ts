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