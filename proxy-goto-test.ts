/**
 * Isolated proxy navigation test (relay version).
 *
 * Proves whether Chromium's page.goto works through the authenticated proxy
 * when routed via a local proxy-chain relay -- the same technique now used in
 * the app (see src/runner/proxy.ts). Self-contained: it does not import repo
 * code, so a pass here means the proxy-auth fix itself is sound.
 *
 * It reads PROXY_TR from .env (TR is the geo-correct proxy) and navigates to a
 * neutral site (example.com), so the result reflects proxy + relay + Chromium
 * only, not the target site.
 *
 * Run from the repo root:
 *   npx tsx proxy-goto-test.ts
 *
 * Expected on success:  OK  status=200  title="Example Domain"
 */

import "dotenv/config";
import { chromium } from "playwright";
import { anonymizeProxy, closeAnonymizedProxy } from "proxy-chain";

/** Builds an upstream proxy URL with re-encoded credentials. */
function toUpstreamUrl(raw: string): string {
  const parsed = new URL(raw.trim());
  const base = new URL(`${parsed.protocol}//${parsed.host}`);
  if (!parsed.username) {
    return base.toString();
  }
  const user = encodeURIComponent(decodeURIComponent(parsed.username));
  const pass = encodeURIComponent(decodeURIComponent(parsed.password));
  return `${base.protocol}//${user}:${pass}@${base.host}`;
}

async function main(): Promise<void> {
  const raw = process.env.PROXY_TR;
  if (!raw || raw.trim().length === 0) {
    console.error("PROXY_TR is not set in .env. Cannot run the test.");
    process.exitCode = 1;
    return;
  }

  const upstreamUrl = toUpstreamUrl(raw);
  console.log(`upstream: ${new URL(upstreamUrl).host} (auth: ${new URL(upstreamUrl).username ? "yes" : "no"})`);

  const relayUrl = await anonymizeProxy(upstreamUrl);
  console.log(`local relay: ${relayUrl} -> navigating ...`);

  const browser = await chromium.launch({ proxy: { server: relayUrl } });
  try {
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();

    const response = await page.goto("https://example.com", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    const status = response?.status() ?? 0;
    const title = await page.title();
    console.log(`OK  status=${status}  title="${title}"`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`FAILED  ${message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await closeAnonymizedProxy(relayUrl, true);
  }
}

main().catch((err) => {
  console.error("test crashed:", err);
  process.exitCode = 1;
});