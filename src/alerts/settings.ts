/**
 * Alert settings: who gets told, how loudly, and with which mailbox.
 *
 * Stored as one row so the panel can edit them without a redeploy, with the
 * SMTP password encrypted exactly like proxy credentials. Environment
 * variables remain a fallback for every field, which is what makes the system
 * configurable before the settings page exists -- and a safety net if the row
 * is ever wiped.
 */

import { pool, withRetry } from "../db/client.js";
import { decryptJson, encryptJson, isEncryptionConfigured } from "../proxy/crypto.js";

export type MinSeverity = "critical" | "major";

export interface AlertSettings {
  enabled: boolean;
  fromAddress: string | null;
  recipients: string[];
  minSeverity: MinSeverity;
  renotifyHours: number;
  smtpHost: string;
  smtpPort: number;
  /** True when a password is stored; the value itself never leaves the server. */
  hasPassword: boolean;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}

interface SettingsRow {
  enabled: boolean;
  fromAddress: string | null;
  recipients: string[] | null;
  minSeverity: MinSeverity;
  renotifyHours: number;
  smtpHost: string;
  smtpPort: number;
  credentials: string | null;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}

const COLS = `enabled,
              from_address    as "fromAddress",
              recipients,
              min_severity    as "minSeverity",
              renotify_hours  as "renotifyHours",
              smtp_host       as "smtpHost",
              smtp_port       as "smtpPort",
              credentials,
              last_test_at    as "lastTestAt",
              last_test_ok    as "lastTestOk",
              last_test_error as "lastTestError"`;

function envRecipients(): string[] {
  return (process.env.ALERT_EMAIL_TO ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter((address) => address.length > 0);
}

async function readRow(): Promise<SettingsRow | null> {
  try {
    const res = await withRetry(
      () => pool.query<SettingsRow>(`select ${COLS} from alert_settings where id = 1`),
      "getAlertSettings",
    );
    return res.rows[0] ?? null;
  } catch {
    // Table missing (migration not run yet) or database unreachable: fall back
    // to the environment rather than taking a run down over its alerting.
    return null;
  }
}

export async function getAlertSettings(): Promise<AlertSettings> {
  const row = await readRow();
  const envFrom = process.env.ALERT_EMAIL_FROM?.trim() || null;
  const envTo = envRecipients();
  const recipients = row?.recipients?.length ? row.recipients : envTo;
  const fromAddress = row?.fromAddress ?? envFrom;
  const hasPassword = Boolean(
    row?.credentials || process.env.ALERT_SMTP_PASSWORD?.trim(),
  );
  // An untouched row (no sender, no recipients) means nobody has used the
  // settings page yet, so the environment decides -- including whether
  // alerting is on at all. Migration 0009 seeds that row with enabled=false,
  // and treating it as authoritative would silently ignore a perfectly good
  // environment configuration, which is exactly how alerting ends up dead
  // without anyone noticing. Once the row carries a sender or recipients it
  // has been configured deliberately and wins.
  const rowConfigured = Boolean(
    row && (row.fromAddress || (row.recipients?.length ?? 0) > 0),
  );

  return {
    enabled: rowConfigured
      ? (row as SettingsRow).enabled
      : Boolean(fromAddress && recipients.length > 0 && hasPassword),
    fromAddress,
    recipients,
    minSeverity: row?.minSeverity ?? "major",
    renotifyHours: row?.renotifyHours ?? 24,
    smtpHost: row?.smtpHost ?? "smtp.gmail.com",
    smtpPort: row?.smtpPort ?? 465,
    hasPassword,
    lastTestAt: row?.lastTestAt ?? null,
    lastTestOk: row?.lastTestOk ?? null,
    lastTestError: row?.lastTestError ?? null,
  };
}

/** The SMTP password, from the encrypted row or the environment. */
export async function getSmtpPassword(): Promise<string | null> {
  const fromEnv = process.env.ALERT_SMTP_PASSWORD?.trim();
  const row = await readRow();
  if (row?.credentials && isEncryptionConfigured()) {
    try {
      const creds = decryptJson<{ password?: string }>(row.credentials);
      if (creds.password) {
        return creds.password;
      }
    } catch {
      // A key rotation leaves an unreadable blob; the environment still works.
    }
  }
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

export interface SaveAlertSettingsInput {
  enabled: boolean;
  fromAddress: string | null;
  recipients: string[];
  minSeverity: MinSeverity;
  renotifyHours: number;
  smtpHost: string;
  smtpPort: number;
  /** Only written when provided, so saving the form does not wipe the password. */
  password?: string;
}

export async function saveAlertSettings(
  input: SaveAlertSettingsInput,
): Promise<void> {
  const credentials =
    input.password && input.password.length > 0
      ? encryptJson({ password: input.password })
      : null;
  await withRetry(
    () =>
      pool.query(
        `update alert_settings
            set enabled        = $1,
                from_address   = $2,
                recipients     = $3,
                min_severity   = $4,
                renotify_hours = $5,
                smtp_host      = $6,
                smtp_port      = $7,
                credentials    = coalesce($8, credentials),
                updated_at     = now()
          where id = 1`,
        [
          input.enabled,
          input.fromAddress,
          input.recipients,
          input.minSeverity,
          input.renotifyHours,
          input.smtpHost,
          input.smtpPort,
          credentials,
        ],
      ),
    "saveAlertSettings",
  );
}

export async function recordAlertTest(
  ok: boolean,
  error: string | null,
): Promise<void> {
  await withRetry(
    () =>
      pool.query(
        `update alert_settings
            set last_test_at = now(), last_test_ok = $1, last_test_error = $2
          where id = 1`,
        [ok, error],
      ),
    "recordAlertTest",
  );
}
