import { proxySettingsQuery, readQuery } from "./db";
import { encryptJson, decryptJson } from "./proxyCrypto.generated";
import type { CountryCode } from "./proxy-providers.generated";

/**
 * Proxy provider settings, as the panel reads and writes them.
 *
 * Credentials are encrypted before they reach the database and are decrypted
 * only to run a connectivity test -- they are never included in an API
 * response, so a saved password cannot be read back out of the panel.
 */

export interface ProxyTestDetail {
  exitIp: string | null;
  siteCountry: string | null;
  cacheCountry: string | null;
  httpStatus: number | null;
  error: string | null;
}

export interface ProxySettingView {
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

const COLS = `id,
              country,
              provider_id      as "providerId",
              label,
              is_active        as "isActive",
              last_test_at     as "lastTestAt",
              last_test_ok     as "lastTestOk",
              last_test_detail as "lastTestDetail",
              updated_at       as "updatedAt"`;

export async function listProxySettings(): Promise<ProxySettingView[]> {
  return readQuery<ProxySettingView>(
    `select ${COLS} from proxy_settings order by country, is_active desc, updated_at desc`,
  );
}

/** Credentials for one row, for a test only. Never returned to the browser. */
export async function getProxyCredentials(
  id: number,
): Promise<{ country: CountryCode; providerId: string; credentials: Record<string, string> } | null> {
  const rows = await readQuery<{
    country: CountryCode;
    providerId: string;
    credentials: string;
  }>(
    `select country, provider_id as "providerId", credentials
       from proxy_settings where id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    country: row.country,
    providerId: row.providerId,
    credentials: decryptJson<Record<string, string>>(row.credentials),
  };
}

export async function saveProxySetting(input: {
  id?: number;
  country: CountryCode;
  providerId: string;
  label?: string | null;
  credentials: Record<string, string>;
}): Promise<number> {
  const blob = encryptJson(input.credentials);
  if (input.id) {
    const rows = await proxySettingsQuery<{ id: number }>(
      `update proxy_settings
          set provider_id = $2, label = $3, credentials = $4, updated_at = now()
        where id = $1
    returning id`,
      [input.id, input.providerId, input.label ?? null, blob],
    );
    if (!rows[0]) throw new Error(`Setting #${input.id} not found.`);
    return rows[0].id;
  }
  const rows = await proxySettingsQuery<{ id: number }>(
    `insert into proxy_settings (country, provider_id, label, credentials)
     values ($1, $2, $3, $4) returning id`,
    [input.country, input.providerId, input.label ?? null, blob],
  );
  return rows[0].id;
}

/**
 * Activation is refused unless the row's last test passed. Switching to a
 * provider whose exit country is wrong would leave every check running
 * against the wrong cache bucket while still reporting green, which is worse
 * than having no provider at all.
 */
export async function activateProxySetting(id: number): Promise<void> {
  const rows = await proxySettingsQuery<{ country: string; lastTestOk: boolean | null }>(
    `select country, last_test_ok as "lastTestOk" from proxy_settings where id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`Setting #${id} not found.`);
  if (row.lastTestOk !== true) {
    throw new Error("A connection test has to pass before this can be activated.");
  }
  await proxySettingsQuery(
    `update proxy_settings set is_active = false, updated_at = now()
      where country = $1 and is_active = true`,
    [row.country],
  );
  await proxySettingsQuery(
    `update proxy_settings set is_active = true, updated_at = now() where id = $1`,
    [id],
  );
}

export async function deleteProxySetting(id: number): Promise<void> {
  await proxySettingsQuery(`delete from proxy_settings where id = $1`, [id]);
}

export async function recordProxyTest(
  id: number,
  ok: boolean,
  detail: ProxyTestDetail,
): Promise<void> {
  await proxySettingsQuery(
    `update proxy_settings
        set last_test_at = now(), last_test_ok = $2, last_test_detail = $3::jsonb
      where id = $1`,
    [id, ok, JSON.stringify(detail)],
  );
}
