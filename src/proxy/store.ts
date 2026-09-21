/**
 * Persistence for panel-managed proxy settings.
 *
 * Credentials cross this boundary encrypted in both directions: rows leave the
 * database as ciphertext and are only decrypted for the runner, and the
 * listing used by the panel never carries them at all. That split is the
 * point -- the panel can show and switch providers without ever being able to
 * read back a password it stored.
 */

import { pool, withRetry } from "../db/client.js";
import type { CountryCode } from "../types.js";
import { decryptJson, encryptJson } from "./crypto.js";

export interface ProxyTestDetail {
  exitIp: string | null;
  /** Country the site itself reported for the request (whereami). */
  siteCountry: string | null;
  /** x-geoip-caching header, i.e. which cache bucket this IP lands in. */
  cacheCountry: string | null;
  httpStatus: number | null;
  error: string | null;
}

/** A settings row as the panel sees it: no credentials, ever. */
export interface ProxySettingRow {
  id: number;
  country: CountryCode;
  providerId: string;
  label: string | null;
  isActive: boolean;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  lastTestDetail: ProxyTestDetail | null;
  updatedAt: Date;
}

export interface ProxySettingWithCredentials extends ProxySettingRow {
  credentials: Record<string, string>;
}

const COLS = `id,
              country,
              provider_id      as "providerId",
              label,
              is_active        as "isActive",
              last_test_at     as "lastTestAt",
              last_test_ok     as "lastTestOk",
              last_test_detail as "lastTestDetail",
              updated_at       as "updatedAt"`;

/** Every saved setting, newest first. Safe to show: no credentials included. */
export async function listProxySettings(
  country?: CountryCode,
): Promise<ProxySettingRow[]> {
  const res = await withRetry(
    () =>
      pool.query<ProxySettingRow>(
        `select ${COLS} from proxy_settings
          ${country ? "where country = $1" : ""}
          order by country, is_active desc, updated_at desc`,
        country ? [country] : [],
      ),
    "listProxySettings",
  );
  return res.rows;
}

/** The active setting per country, decrypted, for the runner. */
export async function getActiveProxySettings(): Promise<
  ProxySettingWithCredentials[]
> {
  const res = await withRetry(
    () =>
      pool.query<ProxySettingRow & { credentials: string }>(
        `select ${COLS}, credentials from proxy_settings where is_active = true`,
        [],
      ),
    "getActiveProxySettings",
  );
  return res.rows.map((row) => ({
    ...row,
    credentials: decryptJson<Record<string, string>>(row.credentials),
  }));
}

/** One setting with its credentials, for testing a specific saved row. */
export async function getProxySetting(
  id: number,
): Promise<ProxySettingWithCredentials | null> {
  const res = await withRetry(
    () =>
      pool.query<ProxySettingRow & { credentials: string }>(
        `select ${COLS}, credentials from proxy_settings where id = $1`,
        [id],
      ),
    "getProxySetting",
  );
  const row = res.rows[0];
  if (!row) {
    return null;
  }
  return { ...row, credentials: decryptJson<Record<string, string>>(row.credentials) };
}

export interface SaveProxySettingInput {
  id?: number;
  country: CountryCode;
  providerId: string;
  label?: string | null;
  credentials: Record<string, string>;
}

/** Creates or updates a setting. Never activates it: that is a separate, tested step. */
export async function saveProxySetting(
  input: SaveProxySettingInput,
): Promise<number> {
  const blob = encryptJson(input.credentials);
  if (input.id) {
    const res = await withRetry(
      () =>
        pool.query<{ id: number }>(
          `update proxy_settings
              set provider_id = $2,
                  label       = $3,
                  credentials = $4,
                  updated_at  = now()
            where id = $1
        returning id`,
          [input.id, input.providerId, input.label ?? null, blob],
        ),
      "saveProxySetting.update",
    );
    if (!res.rows[0]) {
      throw new Error(`proxy setting #${input.id} not found`);
    }
    return res.rows[0].id;
  }
  const res = await withRetry(
    () =>
      pool.query<{ id: number }>(
        `insert into proxy_settings (country, provider_id, label, credentials)
         values ($1, $2, $3, $4)
      returning id`,
        [input.country, input.providerId, input.label ?? null, blob],
      ),
    "saveProxySetting.insert",
  );
  return res.rows[0].id;
}

/**
 * Makes one setting the active provider for its country, in a transaction so
 * the country is never left with two active providers or none.
 */
export async function activateProxySetting(id: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query<{ country: string }>(
      "select country from proxy_settings where id = $1",
      [id],
    );
    const country = found.rows[0]?.country;
    if (!country) {
      throw new Error(`proxy setting #${id} not found`);
    }
    await client.query(
      "update proxy_settings set is_active = false, updated_at = now() where country = $1 and is_active = true",
      [country],
    );
    await client.query(
      "update proxy_settings set is_active = true, updated_at = now() where id = $1",
      [id],
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteProxySetting(id: number): Promise<void> {
  await withRetry(
    () => pool.query("delete from proxy_settings where id = $1", [id]),
    "deleteProxySetting",
  );
}

export async function recordProxyTest(
  id: number,
  ok: boolean,
  detail: ProxyTestDetail,
): Promise<void> {
  await withRetry(
    () =>
      pool.query(
        `update proxy_settings
            set last_test_at = now(), last_test_ok = $2, last_test_detail = $3::jsonb
          where id = $1`,
        [id, ok, JSON.stringify(detail)],
      ),
    "recordProxyTest",
  );
}
