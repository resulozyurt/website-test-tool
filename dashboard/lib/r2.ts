/**
 * Read-only R2 (S3-compatible) access for serving screenshots.
 *
 * The runner uploads full-page screenshots to R2 and stores the object KEY in
 * the database. The dashboard streams the image back through its own
 * `/api/screenshot` route (see app/api/screenshot/route.ts) so images stay
 * behind the dashboard's Basic Auth and the bucket can remain private.
 *
 * Uses aws4fetch (tiny SigV4 signer) — the same approach as the runner. When
 * the STORAGE_* env vars are absent, isStorageConfigured() is false and the
 * route returns 404 (the UI simply shows no screenshot).
 */

import { AwsClient } from "aws4fetch";

interface StorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function config(): StorageConfig | null {
  const endpoint = process.env.STORAGE_ENDPOINT;
  const bucket = process.env.STORAGE_BUCKET;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

export function isStorageConfigured(): boolean {
  return config() !== null;
}

let client: AwsClient | null = null;
function getClient(cfg: StorageConfig): AwsClient {
  if (!client) {
    client = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      region: "auto",
      service: "s3",
    });
  }
  return client;
}

function objectUrl(cfg: StorageConfig, key: string): string {
  const base = cfg.endpoint.replace(/\/+$/, "");
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${base}/${cfg.bucket}/${encodedKey}`;
}

/**
 * GETs an object from R2. Returns the raw fetch Response (caller streams the
 * body) on success, or null when storage is unconfigured or the object is
 * missing. Never throws.
 */
export async function fetchObject(key: string): Promise<Response | null> {
  const cfg = config();
  if (!cfg) {
    return null;
  }
  try {
    const res = await getClient(cfg).fetch(objectUrl(cfg, key), { method: "GET" });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}
