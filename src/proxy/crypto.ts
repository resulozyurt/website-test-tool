/**
 * Encryption for stored proxy credentials.
 *
 * Moving credentials out of environment variables and into the database is a
 * deliberate trade: the operator gains the ability to switch providers from
 * the panel without a redeploy, and in exchange the database now holds a
 * secret. So it never holds a readable one -- rows are AES-256-GCM
 * ciphertext, and the key itself stays where secrets belonged all along, in
 * SETTINGS_SECRET_KEY. A database dump on its own is worthless.
 *
 * GCM (not CBC) because it authenticates: a tampered row fails to decrypt
 * instead of yielding a subtly different proxy URL.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;

/**
 * The 32-byte key, derived from SETTINGS_SECRET_KEY so any passphrase length
 * works. Read at call time, not at import, so a process that never touches
 * proxy settings starts fine without the variable.
 */
function key(): Buffer {
  const raw = process.env.SETTINGS_SECRET_KEY?.trim();
  if (!raw) {
    throw new Error(
      "SETTINGS_SECRET_KEY is not set; proxy credentials cannot be read or written",
    );
  }
  if (raw.length < 16) {
    throw new Error("SETTINGS_SECRET_KEY is too short (use at least 16 characters)");
  }
  return createHash("sha256").update(raw).digest();
}

export function isEncryptionConfigured(): boolean {
  const raw = process.env.SETTINGS_SECRET_KEY?.trim();
  return Boolean(raw && raw.length >= 16);
}

/** Encrypts a JSON-serialisable value into `v1.<iv>.<tag>.<ciphertext>`. */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const plain = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/** Reverses encryptJson. Throws if the key is wrong or the row was tampered with. */
export function decryptJson<T>(payload: string): T {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("unrecognised encrypted payload format");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString("utf8")) as T;
}
