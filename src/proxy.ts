import type { Market } from "./markets.js";

/** Playwright-compatible proxy configuration. */
export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

/**
 * Reads the proxy URL for a market from the environment and converts it into
 * the structure Playwright expects. Returns null when the variable is empty so
 * the caller can report a clear "proxy not configured" result instead of
 * crashing.
 *
 * Accepted input format: http://USERNAME:PASSWORD@HOST:PORT
 */
export function getProxyConfig(market: Market): ProxyConfig | null {
  const raw = process.env[market.proxyEnvKey];
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  const parsed = new URL(raw.trim());
  const server = `${parsed.protocol}//${parsed.host}`;

  const config: ProxyConfig = { server };
  if (parsed.username) {
    config.username = decodeURIComponent(parsed.username);
  }
  if (parsed.password) {
    config.password = decodeURIComponent(parsed.password);
  }
  return config;
}
