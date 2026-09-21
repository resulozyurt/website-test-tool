/**
 * Sending the alert mail.
 *
 * Gmail over SMTP with an app password: no domain, no third-party service,
 * and the account's own sending limits are far above anything this system
 * produces. An app password (not the account password) is required, which in
 * turn requires 2-Step Verification on that Google account.
 *
 * Every send is recorded in the `alerts` table -- including failures, because
 * a monitoring system whose alerting has quietly died is worse than one that
 * never had any.
 */

import nodemailer from "nodemailer";
import { pool, withRetry } from "../db/client.js";
import { getAlertSettings, getSmtpPassword, type AlertSettings } from "./settings.js";

export interface SendResult {
  ok: boolean;
  skipped: boolean;
  error: string | null;
  recipients: string[];
}

export interface AlertMail {
  subject: string;
  text: string;
  severity: "critical" | "major" | "info";
  sweepId?: number | null;
  runId?: number | null;
}

function missingPieces(settings: AlertSettings, password: string | null): string[] {
  const missing: string[] = [];
  if (!settings.fromAddress) missing.push("sender address");
  if (settings.recipients.length === 0) missing.push("recipients");
  if (!password) missing.push("app password");
  return missing;
}

async function logAlert(
  mail: AlertMail,
  delivered: boolean,
  body: string,
): Promise<void> {
  try {
    await withRetry(
      () =>
        pool.query(
          `insert into alerts (sweep_id, run_id, channel, severity, subject, body, delivered)
           values ($1, $2, 'email', $3, $4, $5, $6)`,
          [
            mail.sweepId ?? null,
            mail.runId ?? null,
            mail.severity,
            mail.subject,
            body,
            delivered,
          ],
        ),
      "logAlert",
    );
  } catch {
    // The email matters more than its audit row; never fail a send over this.
  }
}

/**
 * Sends one alert. Returns rather than throws: alerting runs at the end of a
 * monitoring run, and a broken mailbox must not turn a successful run into a
 * failed one.
 */
export async function sendAlert(
  mail: AlertMail,
  options: { ignoreEnabled?: boolean } = {},
): Promise<SendResult> {
  const settings = await getAlertSettings();
  const password = await getSmtpPassword();

  if (!settings.enabled && !options.ignoreEnabled) {
    return { ok: false, skipped: true, error: "alerting is disabled", recipients: [] };
  }

  const missing = missingPieces(settings, password);
  if (missing.length > 0) {
    const error = `alert settings incomplete: ${missing.join(", ")}`;
    await logAlert(mail, false, `${mail.text}\n\n[not sent: ${error}]`);
    return { ok: false, skipped: true, error, recipients: settings.recipients };
  }

  const transport = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: settings.smtpPort === 465,
    auth: { user: settings.fromAddress as string, pass: password as string },
  });

  try {
    await transport.sendMail({
      from: `FieldPie Monitor <${settings.fromAddress}>`,
      to: settings.recipients.join(", "),
      subject: mail.subject,
      text: mail.text,
    });
    await logAlert(mail, true, mail.text);
    return { ok: true, skipped: false, error: null, recipients: settings.recipients };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await logAlert(mail, false, `${mail.text}\n\n[send failed: ${error}]`);
    return { ok: false, skipped: false, error, recipients: settings.recipients };
  } finally {
    transport.close();
  }
}
