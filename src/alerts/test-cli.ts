/**
 * Sends a test alert, so the mailbox can be verified on its own -- no proxies,
 * no crawl, no waiting for something to break.
 *
 *   npm run alert:test
 *
 * Runs even when alerting is switched off, since that is exactly the state
 * you are in while setting it up, and records the outcome so the panel can
 * show whether the mailbox last worked.
 */

import { closePool } from "../db/client.js";
import { sendAlert } from "./mailer.js";
import { getAlertSettings, recordAlertTest } from "./settings.js";

async function main(): Promise<void> {
  const settings = await getAlertSettings();
  console.log(
    `alert settings: enabled=${settings.enabled} from=${settings.fromAddress ?? "(none)"} ` +
      `to=${settings.recipients.join(", ") || "(none)"} ` +
      `smtp=${settings.smtpHost}:${settings.smtpPort} password=${settings.hasPassword ? "set" : "missing"}`,
  );

  const now = new Date().toISOString();
  const result = await sendAlert(
    {
      subject: "[FieldPie Monitor] Test alert",
      severity: "info",
      text:
        `This is a test message from the FieldPie monitoring system.\n\n` +
        `Sent at: ${now}\n` +
        `SMTP: ${settings.smtpHost}:${settings.smtpPort}\n` +
        `Recipients: ${settings.recipients.join(", ")}\n\n` +
        `If you are reading this, alert delivery works.`,
    },
    { ignoreEnabled: true },
  );

  try {
    await recordAlertTest(result.ok, result.error);
  } catch {
    // The settings row may not exist yet when running purely from environment
    // variables; the send result below is what matters.
  }

  if (result.ok) {
    console.log(`sent to ${result.recipients.join(", ")}`);
    return;
  }
  console.error(`not sent: ${result.error}`);
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("alert:test failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
