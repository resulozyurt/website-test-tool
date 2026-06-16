/**
 * Manifest HTTP client. Fetches the secret-protected WordPress endpoint, sends
 * the X-Monitor-Secret header (and the Kinsta-allowlisted monitor user-agent if
 * configured), then validates the JSON against the zod schema.
 *
 * All failures surface as a ManifestError with a clear, actionable message so
 * the CLI and later the sweep can report exactly what to fix.
 */

import { env } from "../config/env.js";
import { ManifestSchema, type Manifest } from "./schema.js";

const DEFAULT_PATH = "/wp-json/fieldpie-monitor/v1/manifest";

export class ManifestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly bodySnippet?: string,
  ) {
    super(message);
    this.name = "ManifestError";
  }
}

export interface FetchManifestOptions {
  /** Bypass the plugin's 30-minute cache (?fresh=1). Default true. */
  fresh?: boolean;
  timeoutMs?: number;
}

/** The effective endpoint URL: MANIFEST_URL if set, else derived from TARGET_BASE_URL. */
export function manifestUrl(fresh = false): string {
  const base =
    (env.MANIFEST_URL ?? "").trim() ||
    new URL(DEFAULT_PATH, env.TARGET_BASE_URL).toString();
  if (!fresh) {
    return base;
  }
  const u = new URL(base);
  u.searchParams.set("fresh", "1");
  return u.toString();
}

export async function fetchManifest(
  options: FetchManifestOptions = {},
): Promise<Manifest> {
  const secret = (env.MANIFEST_SECRET ?? "").trim();
  if (!secret) {
    throw new ManifestError(
      "MANIFEST_SECRET is not set in .env. Use the same secret you saved in WP admin -> Settings -> FieldPie Monitor.",
    );
  }

  const url = manifestUrl(options.fresh ?? true);
  const headers: Record<string, string> = {
    "X-Monitor-Secret": secret,
    Accept: "application/json",
  };
  const ua = (env.MONITOR_USER_AGENT ?? "").trim();
  if (ua) {
    headers["User-Agent"] = ua;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);

  let res: Response;
  try {
    res = await fetch(url, { headers, signal: controller.signal });
  } catch (err) {
    throw new ManifestError(
      `Request to ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  const snippet = text.slice(0, 200).replace(/\s+/g, " ").trim();

  if (res.status === 403) {
    throw new ManifestError(
      "403 from endpoint: the secret was rejected. MANIFEST_SECRET in .env must match the value saved in WP Settings -> FieldPie Monitor.",
      403,
      snippet,
    );
  }
  if (res.status === 503) {
    throw new ManifestError(
      "503 from endpoint: the plugin has no secret configured. Set it in WP Settings -> FieldPie Monitor.",
      503,
      snippet,
    );
  }
  if (!res.ok) {
    throw new ManifestError(`Unexpected HTTP ${res.status} from ${url}.`, res.status, snippet);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ManifestError(
      "Endpoint returned non-JSON (likely a Cloudflare/WAF challenge). Set MONITOR_USER_AGENT in .env to the Kinsta-allowlisted value.",
      res.status,
      snippet,
    );
  }

  const parsed = ManifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new ManifestError(
      `Manifest failed schema validation: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
      res.status,
    );
  }
  return parsed.data;
}
