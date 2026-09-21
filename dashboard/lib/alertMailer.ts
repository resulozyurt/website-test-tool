import nodemailer from "nodemailer";
import { getAlertSettings, getSmtpPassword } from "./alertSettings";

/**
 * Sends a test message from the settings page, so the mailbox can be proven
 * to work the moment it is configured rather than the next time something
 * breaks. Runs regardless of the enabled switch: verifying a mailbox before
 * turning alerting on is the normal order of operations.
 */
export async function sendTestEmail(): Promise<{ ok: boolean; error: string | null }> {
  const settings = await getAlertSettings();
  const password = await getSmtpPassword();

  const missing: string[] = [];
  if (!settings.fromAddress) missing.push("sender address");
  if (settings.recipients.length === 0) missing.push("recipients");
  if (!password) missing.push("app password");
  if (missing.length > 0) {
    return { ok: false, error: `Missing: ${missing.join(", ")}` };
  }

  const transport = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpPort === 465,
    auth: { user: settings.fromAddress as string, pass: password as string },
  });

  try {
    await transport.sendMail({
      from: `FieldPie Monitor <${settings.fromAddress}>`,
      to: settings.recipients.join(", "),
      subject: "[FieldPie Monitor] Test alert",
      text:
        `This is a test message sent from the monitoring dashboard.\n\n` +
        `Sent at: ${new Date().toISOString()}\n` +
        `SMTP: ${settings.smtpHost}:${settings.smtpPort}\n` +
        `Recipients: ${settings.recipients.join(", ")}\n\n` +
        `If you are reading this, alert delivery works.`,
    });
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    transport.close();
  }
}
