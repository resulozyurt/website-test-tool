import { chromium, type Browser, type BrowserContext } from "playwright";
import { env } from "../config/env.js";
import type { ProxyConfig } from "./proxy.js";

const MONITOR_USER_AGENT = (env.MONITOR_USER_AGENT ?? "").trim();
const MONITOR_HEADER_NAME = (env.MONITOR_HEADER_NAME ?? "").trim();
const MONITOR_HEADER_VALUE = (env.MONITOR_HEADER_VALUE ?? "").trim();

/** Registrable host the monitor overrides are scoped to (e.g. "fieldpie.com"). */
const TARGET_HOST_SUFFIX = hostSuffix(env.TARGET_BASE_URL);

function hostSuffix(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export interface LaunchedContext {
  browser: Browser;
  context: BrowserContext;
}

/**
 * Launches a Chromium browser routed through the given proxy and returns a
 * fresh context configured like a real desktop visitor. The owner allowlist
 * user-agent and/or header (which let the monitor through the Cloudflare bot
 * challenge) are attached ONLY to requests aimed at the target host, so the
 * identifying token never leaks to third parties (IP service, analytics, etc.).
 */
export async function launchContext(
  proxy: ProxyConfig,
): Promise<LaunchedContext> {
  const browser = await chromium.launch({ proxy });
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1366, height: 900 },
  });
  await attachMonitorOverrides(context);
  return { browser, context };
}

/**
 * Adds the allowlist header and/or custom user-agent to requests aimed at the
 * target host only. No-op when neither is configured. Note: this routes page
 * requests; the APIRequestContext (used for the exit-IP probe) is intentionally
 * not affected, so the token is never sent to the IP service.
 */
async function attachMonitorOverrides(context: BrowserContext): Promise<void> {
  const hasHeader = Boolean(MONITOR_HEADER_NAME && MONITOR_HEADER_VALUE);
  const hasUserAgent = Boolean(MONITOR_USER_AGENT);
  if (!hasHeader && !hasUserAgent) {
    return;
  }

  await context.route("**/*", async (route) => {
    const request = route.request();
    let host = "";
    try {
      host = new URL(request.url()).hostname;
    } catch {
      host = "";
    }

    const onTarget =
      TARGET_HOST_SUFFIX.length > 0 &&
      (host === TARGET_HOST_SUFFIX || host.endsWith(`.${TARGET_HOST_SUFFIX}`));

    if (!onTarget) {
      await route.continue();
      return;
    }

    const headers = { ...request.headers() };
    if (hasHeader) {
      headers[MONITOR_HEADER_NAME.toLowerCase()] = MONITOR_HEADER_VALUE;
    }
    if (hasUserAgent) {
      headers["user-agent"] = MONITOR_USER_AGENT;
    }
    await route.continue({ headers });
  });
}