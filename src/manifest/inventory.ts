/**
 * Zod schema and read-only client for the per-page inventory endpoint
 * (GET /wp-json/fieldpie-monitor/v1/inventory) added in plugin v0.3.x.
 *
 * The inventory is a faithful structural dump of a page's Bricks tree: each
 * top-level element is a "section" carrying its own conditions plus a flat list
 * of its descendant elements (each with id, name, kind, label, parent, and
 * conditions). The scenario generator (later step) interprets this; here we
 * only validate and fetch.
 *
 * `parent` is optional in the schema so output from v0.3.0 (which lacked it)
 * still validates, but correct per-country logic needs v0.3.1+.
 */

import { z } from "zod";
import { env } from "../config/env.js";
import { ManifestError } from "./client.js";

const INVENTORY_PATH = "/wp-json/fieldpie-monitor/v1/inventory";

export const InventoryConditionSchema = z.object({
  dynamic_data: z.string(),
  op: z.string(),
  value: z.string(),
  is_geo: z.boolean(),
  country: z.string().nullable(),
});

export const InventoryElementSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  label: z.string(),
  parent: z.string().default("0"),
  conditions: z.array(InventoryConditionSchema),
});

export const InventorySectionSchema = InventoryElementSchema.extend({
  elements: z.array(InventoryElementSchema),
});

export const InventoryPageSchema = z.object({
  post_id: z.number(),
  slug: z.string().nullable(),
  language: z.string().nullable(),
  url: z.string(),
  title: z.string(),
  heading: z.string().nullable(),
});

export const InventorySchema = z.object({
  inventory_version: z.string(),
  generated_at: z.string(),
  site: z.string(),
  geo_function: z.string(),
  page: InventoryPageSchema,
  sections: z.array(InventorySectionSchema),
  coverage: z.object({
    element_count: z.number(),
    section_count: z.number(),
    conditional_element_count: z.number(),
  }),
});

export type InventoryCondition = z.infer<typeof InventoryConditionSchema>;
export type InventoryElement = z.infer<typeof InventoryElementSchema>;
export type InventorySection = z.infer<typeof InventorySectionSchema>;
export type InventoryPage = z.infer<typeof InventoryPageSchema>;
export type Inventory = z.infer<typeof InventorySchema>;

export interface FetchInventoryOptions {
  postId?: number;
  url?: string;
  /** Bypass the plugin's 30-minute per-page cache (?fresh=1). Default true. */
  fresh?: boolean;
  timeoutMs?: number;
}

/** Builds the inventory endpoint URL for a post id or a page URL. */
export function inventoryUrl(opts: FetchInventoryOptions): string {
  const url = new URL(INVENTORY_PATH, env.TARGET_BASE_URL);
  if (opts.postId && opts.postId > 0) {
    url.searchParams.set("post_id", String(opts.postId));
  } else if (opts.url) {
    url.searchParams.set("url", opts.url);
  }
  if (opts.fresh ?? true) {
    url.searchParams.set("fresh", "1");
  }
  return url.toString();
}

export async function fetchInventory(
  opts: FetchInventoryOptions,
): Promise<Inventory> {
  const secret = (env.MANIFEST_SECRET ?? "").trim();
  if (!secret) {
    throw new ManifestError("MANIFEST_SECRET is not set in .env.");
  }
  if (!opts.postId && !opts.url) {
    throw new ManifestError("fetchInventory needs a postId or a url.");
  }

  const url = inventoryUrl(opts);
  const headers: Record<string, string> = {
    "X-Monitor-Secret": secret,
    Accept: "application/json",
  };
  const ua = (env.MONITOR_USER_AGENT ?? "").trim();
  if (ua) {
    headers["User-Agent"] = ua;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);
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
    throw new ManifestError("403: the monitor secret was rejected.", 403, snippet);
  }
  if (res.status === 503) {
    throw new ManifestError("503: plugin secret not configured.", 503, snippet);
  }
  if (res.status === 404) {
    throw new ManifestError(
      "404: no published page for that post_id/url.",
      404,
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
      "Endpoint returned non-JSON (likely a WAF challenge). Set MONITOR_USER_AGENT in .env.",
      res.status,
      snippet,
    );
  }

  const parsed = InventorySchema.safeParse(json);
  if (!parsed.success) {
    throw new ManifestError(
      `Inventory failed schema validation: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
      res.status,
    );
  }
  return parsed.data;
}

/**
 * Indexes every element (sections + their descendants) by id, so callers can
 * walk the parent chain. Sections are included as entries too.
 */
export function indexElements(
  inventory: Inventory,
): Map<string, InventoryElement> {
  const byId = new Map<string, InventoryElement>();
  for (const section of inventory.sections) {
    byId.set(section.id, section);
    for (const el of section.elements) {
      byId.set(el.id, el);
    }
  }
  return byId;
}

/**
 * The effective geo condition for an element: its own geo condition if present,
 * otherwise the nearest ancestor's. Returns null when neither the element nor
 * any ancestor is gated on country. `inherited` marks an ancestor source.
 */
export function effectiveGeo(
  elementId: string,
  byId: Map<string, InventoryElement>,
): { op: string; country: string; inherited: boolean } | null {
  let current = byId.get(elementId);
  let inherited = false;
  let guard = 0;
  while (current && guard < 100) {
    const geo = current.conditions.find((c) => c.is_geo && c.country);
    if (geo && geo.country) {
      return { op: geo.op, country: geo.country, inherited };
    }
    if (!current.parent || current.parent === "0") {
      break;
    }
    current = byId.get(current.parent);
    inherited = true;
    guard += 1;
  }
  return null;
}
