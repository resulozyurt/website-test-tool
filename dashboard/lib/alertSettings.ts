import { alertSettingsQuery, readQuery } from "./db";
import { decryptJson, encryptJson } from "./proxyCrypto.generated";

/**
 * Alert settings as the panel reads and writes them.
 *
 * The app password follows the same rule as proxy credentials: written
 * encrypted, never returned. Leaving the password field blank on save keeps
 * the stored one, so editing the recipient list does not silently wipe the
 * mailbox.
 */

export type MinSeverity = "critical" | "major";

export interface AlertSettingsView {
  enabled: boolean;
  fromAddress: string | null;
  recipients: string[];
  minSeverity: MinSeverity;
  renotifyHours: number;
  smtpHost: string;
  smtpPort: number;
  hasPassword: boolean;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}

interface Row extends Omit<AlertSettingsView, "hasPassword" | "recipients"> {
  recipients: string[] | null;
  credentials: string | null;
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

export async function getAlertSettings(): Promise<AlertSettingsView> {
  const rows = await readQuery<Row>(
    `select ${COLS} from alert_settings where id = 1`,
  );
  const row = rows[0];
  return {
    enabled: row?.enabled ?? false,
    fromAddress: row?.fromAddress ?? null,
    recipients: row?.recipients ?? [],
    minSeverity: row?.minSeverity ?? "major",
    renotifyHours: row?.renotifyHours ?? 24,
    smtpHost: row?.smtpHost ?? "smtp.gmail.com",
    smtpPort: row?.smtpPort ?? 465,
    hasPassword: Boolean(row?.credentials),
    lastTestAt: row?.lastTestAt ?? null,
    lastTestOk: row?.lastTestOk ?? null,
    lastTestError: row?.lastTestError ?? null,
  };
}

/** The stored password, for sending a test. Never leaves the server. */
export async function getSmtpPassword(): Promise<string | null> {
  const rows = await readQuery<{ credentials: string | null }>(
    `select credentials from alert_settings where id = 1`,
  );
  const blob = rows[0]?.credentials;
  if (!blob) {
    return process.env.ALERT_SMTP_PASSWORD?.trim() || null;
  }
  try {
    return decryptJson<{ password?: string }>(blob).password ?? null;
  } catch {
    return process.env.ALERT_SMTP_PASSWORD?.trim() || null;
  }
}

export interface SaveAlertInput {
  enabled: boolean;
  fromAddress: string;
  recipients: string[];
  minSeverity: MinSeverity;
  renotifyHours: number;
  smtpHost: string;
  smtpPort: number;
  password?: string;
}

export async function saveAlertSettings(input: SaveAlertInput): Promise<void> {
  const credentials =
    input.password && input.password.length > 0
      ? encryptJson({ password: input.password })
      : null;
  await alertSettingsQuery(
    `update alert_settings
        set enabled = $1, from_address = $2, recipients = $3, min_severity = $4,
            renotify_hours = $5, smtp_host = $6, smtp_port = $7,
            credentials = coalesce($8, credentials), updated_at = now()
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
  );
}

export async function recordAlertTest(
  ok: boolean,
  error: string | null,
): Promise<void> {
  await alertSettingsQuery(
    `update alert_settings set last_test_at = now(), last_test_ok = $1, last_test_error = $2
      where id = 1`,
    [ok, error],
  );
}

export interface SentAlertView {
  id: number;
  severity: string;
  subject: string | null;
  delivered: boolean;
  createdAt: Date;
}

/** Recent alert mail, delivered or not, so a dead mailbox is visible. */
export async function listRecentAlerts(limit = 10): Promise<SentAlertView[]> {
  return readQuery<SentAlertView>(
    `select id, severity, subject, delivered, created_at as "createdAt"
       from alerts
      where channel = 'email'
      order by created_at desc
      limit $1`,
    [limit],
  );
}
