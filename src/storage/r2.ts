/**
 * Object storage (Cloudflare R2, S3-compatible) for screenshots.
 *
 * Screenshots are captured to the container's local disk, which is EPHEMERAL on
 * Railway — the files vanish the moment a cron job exits. To keep visual
 * evidence, each screenshot is uploaded to R2 and the object KEY (not a local
 * path) is stored in the database; the dashboard streams the image back from R2
 * on demand.
 *
 * Uses aws4fetch (a tiny SigV4 request signer) rather than the full AWS SDK, to
 * keep the runner image small. R2 speaks the S3 API, so a signed PUT to
 *   {endpoint}/{bucket}/{key}
 * with region "auto" is all that is required.
 *
 * Fully optional: when the STORAGE_* env vars are absent, isStorageConfigured()
 * returns false and callers fall back to recording the local path (useful in
 * local dev) without uploading. A failed upload NEVER fails a sweep/crawl —
 * visual evidence is best-effort next to the authoritative findings.
 */

import { readFile } from "node:fs/promises";
import { AwsClient } from "aws4fetch";
import { env } from "../config/env.js";

let client: AwsClient | null = null;

/** True only when every R2 credential/endpoint is present. */
export function isStorageConfigured(): boolean {
  return Boolean(
    env.STORAGE_ENDPOINT &&
      env.STORAGE_BUCKET &&
      env.STORAGE_ACCESS_KEY_ID &&
      env.STORAGE_SECRET_ACCESS_KEY,
  );
}

function getClient(): AwsClient {
  if (!client) {
    client = new AwsClient({
      accessKeyId: env.STORAGE_ACCESS_KEY_ID as string,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY as string,
      region: "auto",
      service: "s3",
    });
  }
  return client;
}

/** Absolute object URL for a key: {endpoint}/{bucket}/{key} (path-encoded). */
function objectUrl(key: string): string {
  const endpoint = (env.STORAGE_ENDPOINT as string).replace(/\/+$/, "");
  const bucket = env.STORAGE_BUCKET as string;
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${endpoint}/${bucket}/${encodedKey}`;
}

/**
 * Uploads a local file to R2 under `key`. Returns the key on success, or null
 * on any failure or when storage is not configured. Never throws.
 */
export async function uploadFile(
  localPath: string,
  key: string,
  contentType = "image/png",
): Promise<string | null> {
  if (!isStorageConfigured()) {
    return null;
  }
  try {
    const body = await readFile(localPath);
    const res = await getClient().fetch(objectUrl(key), {
      method: "PUT",
      body,
      headers: { "content-type": contentType },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `  r2 upload failed (${res.status}) for ${key}: ${text.slice(0, 160)}`,
      );
      return null;
    }
    return key;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  r2 upload error for ${key}: ${msg}`);
    return null;
  }
}
