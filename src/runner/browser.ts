import { chromium, type Browser, type BrowserContext } from "playwright";
import { env } from "../config/env.js";
import type { ProxyConfig } from "./proxy.js";
import type { BlockedWrite } from "./interaction.js";

const MONITOR_USER_AGENT = (env.MONITOR_USER_AGENT ?? "").trim();
const MONITOR_HEADER_NAME = (env.MONITOR_HEADER_NAME ?? "").trim();
const MONITOR_HEADER_VALUE = (env.MONITOR_HEADER_VALUE ?? "").trim();

/** Monitor identifiers that must never appear in served content (leak canary). */
export const MONITOR_TOKENS: string[] = [
  MONITOR_USER_AGENT,
  MONITOR_HEADER_VALUE,
].filter((t) => t.length > 0);

/** Registrable host the monitor overrides + guard are scoped to. */
const TARGET_HOST_SUFFIX = hostSuffix(env.TARGET_BASE_URL);

function hostSuffix(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * Read-only guard. When `active` is true, any non-GET/HEAD request to the
 * target host is aborted at the network layer so no write can reach the live
 * site. Toggled on only during the interaction phase (see capture.ts).
 */
export interface ReadOnlyGuard {
  active: boolean;
  blockedWrites: BlockedWrite[];
}

export interface LaunchedContext {
  browser: Browser;
  context: BrowserContext;
}

/**
 * Launches Chromium through the given proxy and returns a fresh desktop-like
 * context. The allowlist user-agent/header are attached only to target-host
 * requests (the token never leaks to third parties), and the optional guard
 * blocks writes to the target host while it is active.
 */
export async function launchContext(
  proxy: ProxyConfig,
  guard?: ReadOnlyGuard,
): Promise<LaunchedContext> {
  const browser = await chromium.launch({ proxy });
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1366, height: 900 },
  });
  await attachRoutes(context, guard);
  return { browser, context };
}

async function attachRoutes(
  context: BrowserContext,
  guard?: ReadOnlyGuard,
): Promise<void> {
  const hasHeader = Boolean(MONITOR_HEADER_NAME && MONITOR_HEADER_VALUE);
  const hasUserAgent = Boolean(MONITOR_USER_AGENT);
  const needsOverrides = hasHeader || hasUserAgent;
  if (!needsOverrides && !guard) {
    return;
  }

  await context.route("**/*", async (route) => {
    const request = route.request();
    const host = hostOf(request.url());
    const onTarget =
      TARGET_HOST_SUFFIX.length > 0 &&
      (host === TARGET_HOST_SUFFIX || host.endsWith(`.${TARGET_HOST_SUFFIX}`));

    if (!onTarget) {
      await route.continue();
      return;
    }

    const method = request.method().toUpperCase();
    if (guard && guard.active && method !== "GET" && method !== "HEAD") {
      guard.blockedWrites.push({ url: request.url(), method });
      await route.abort("blockedbyclient");
      return;
    }

    if (!needsOverrides) {
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