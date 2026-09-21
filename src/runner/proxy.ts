import { anonymizeProxy, closeAnonymizedProxy } from "proxy-chain";
import {
  buildProxy,
  getProvider,
  newSessionId,
  type SessionSpec,
} from "../config/proxy-providers.js";
import { isEncryptionConfigured } from "../proxy/crypto.js";
import type { CountryCode } from "../types.js";

/** Playwright-compatible proxy configuration. */
export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
  /**
   * Where this provider keeps its sticky-session id, when the config came
   * from the catalogue. Lets withFreshSession rotate the session without
   * guessing at the format.
   */
  session?: SessionSpec;
  /** Catalogue id, for logging which provider a run actually used. */
  providerId?: string;
}

/**
 * Active per-country settings loaded from the database, when the operator has
 * configured providers in the panel. Empty until loadProxyOverrides runs, so
 * a caller that forgets simply gets the environment variables -- the previous
 * behaviour -- rather than no proxy at all.
 */
const overrides = new Map<CountryCode, ProxyConfig>();

export interface ProxyOverrideReport {
  loaded: CountryCode[];
  errors: string[];
}

/**
 * Loads the panel-managed providers into memory. Best-effort by design: this
 * runs at the start of every sweep and crawl, and a settings table that is
 * unreachable (or an unset SETTINGS_SECRET_KEY) must not take the monitoring
 * down -- it falls back to PROXY_* and says so.
 */
export async function loadProxyOverrides(): Promise<ProxyOverrideReport> {
  const report: ProxyOverrideReport = { loaded: [], errors: [] };
  overrides.clear();
  if (!isEncryptionConfigured()) {
    return report;
  }
  let rows;
  try {
    const store = await import("../proxy/store.js");
    rows = await store.getActiveProxySettings();
  } catch (err) {
    report.errors.push(
      `could not read proxy settings: ${err instanceof Error ? err.message : String(err)}`,
    );
    return report;
  }
  for (const row of rows) {
    const provider = getProvider(row.providerId);
    if (!provider) {
      report.errors.push(`${row.country}: unknown provider "${row.providerId}"`);
      continue;
    }
    try {
      const built = buildProxy(provider, row.credentials, row.country);
      overrides.set(row.country, {
        server: built.server,
        username: built.username,
        password: built.password,
        session: provider.session,
        providerId: provider.id,
      });
      report.loaded.push(row.country);
    } catch (err) {
      report.errors.push(
        `${row.country}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return report;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Environment variable name holding a country's proxy URL (PROXY_US, ...). */
export function proxyEnvKey(country: CountryCode): string {
  return `PROXY_${country}`;
}

/**
 * The proxy for a country: the provider configured in the panel when there is
 * one, otherwise the PROXY_* environment variable. Stays synchronous so every
 * existing call site is unchanged; loadProxyOverrides fills the panel layer in
 * once per run.
 *
 * Environment variable format: http://USERNAME:PASSWORD@HOST:PORT, with the
 * provider's country and session parameters already embedded by hand.
 */
export function resolveProxy(country: CountryCode): ProxyConfig | null {
  const override = overrides.get(country);
  if (override) {
    return override;
  }
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
 * Forces a different exit IP by rotating the sticky-session id, which tells us
 * whether a block is specific to one IP or affects the whole country pool.
 *
 * A config that came from the catalogue knows where its session id lives and
 * how long it may be (IPRoyal, for one, rejects anything but 8 characters).
 * Configs that came from a hand-written PROXY_* variable fall back to
 * recognising the two formats this project has used.
 */
export function withFreshSession(proxy: ProxyConfig): ProxyConfig {
  if (proxy.session) {
    const spec = proxy.session;
    const id = newSessionId(spec.length);
    const current = spec.field === "username" ? proxy.username : proxy.password;
    if (current && spec.prefix && current.includes(spec.prefix)) {
      const pattern = new RegExp(
        `${escapeRegExp(spec.prefix)}[^${spec.suffix ? escapeRegExp(spec.suffix[0]) : "\\s"}]*`,
      );
      const replaced = current.replace(pattern, `${spec.prefix}${id}`);
      return spec.field === "username"
        ? { ...proxy, username: replaced }
        : { ...proxy, password: replaced };
    }
  }

  const token = `r${Math.random().toString(36).slice(2, 10)}`;

  // Evomi: session lives in the password (..._session-XXXX)
  if (proxy.password && /_session-[^_]+/.test(proxy.password)) {
    return {
      ...proxy,
      password: proxy.password.replace(/_session-[^_]+/, `_session-${token}`),
    };
  }

  // DataImpulse: session lives in the username (;sessid.<id>)
  if (!proxy.username) {
    return proxy;
  }
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