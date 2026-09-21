"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AlertSettingsView } from "@/lib/alertSettings";

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/alerts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(data.error ?? `HTTP ${res.status}`));
  }
  return data;
}

export function AlertSettingsForm({
  settings,
  keyConfigured,
}: {
  settings: AlertSettingsView;
  keyConfigured: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [fromAddress, setFromAddress] = useState(settings.fromAddress ?? "");
  const [recipients, setRecipients] = useState(settings.recipients.join(", "));
  const [minSeverity, setMinSeverity] = useState(settings.minSeverity);
  const [renotifyHours, setRenotifyHours] = useState(String(settings.renotifyHours));
  const [smtpHost, setSmtpHost] = useState(settings.smtpHost);
  const [smtpPort, setSmtpPort] = useState(String(settings.smtpPort));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!keyConfigured) {
    return (
      <div className="rounded-xl border border-line bg-card p-6 text-sm">
        <p className="font-medium">SETTINGS_SECRET_KEY is not configured.</p>
        <p className="mt-2 text-muted">
          The app password is encrypted with this key before it is stored, so
          nothing can be saved without it. Set a value of at least 16
          characters on both the panel and the runner service, then reload.
        </p>
      </div>
    );
  }

  async function act(action: "save" | "test") {
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      if (action === "save") {
        await post({
          action: "save",
          enabled,
          fromAddress,
          recipients: recipients.split(",").map((value) => value.trim()),
          minSeverity,
          renotifyHours: Number(renotifyHours),
          smtpHost,
          smtpPort: Number(smtpPort),
          password: password || undefined,
        });
        setPassword("");
        setMessage("Saved.");
        router.refresh();
      } else {
        const data = (await post({ action: "test" })) as {
          result: { ok: boolean; error: string | null };
        };
        setMessage(
          data.result.ok
            ? "Test email sent."
            : `Test failed: ${data.result.error ?? "unknown error"}`,
        );
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Send alert email after every run
      </label>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-muted">Recipients</label>
          <input
            type="text"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="someone@example.com, another@example.com"
            className="mt-1 w-full rounded-md border border-line bg-elev px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-faint">
            Comma separated. Everyone listed gets the same digest.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted">Sender address</label>
          <input
            type="text"
            value={fromAddress}
            onChange={(e) => setFromAddress(e.target.value)}
            placeholder="monitor@example.com"
            className="mt-1 w-full rounded-md border border-line bg-elev px-3 py-2 font-mono text-sm"
          />
          <p className="mt-1 text-[11px] text-faint">
            The Gmail account the mail is sent from.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted">
            App password {settings.hasPassword ? "(stored — leave blank to keep)" : ""}
          </label>
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder={settings.hasPassword ? "••••••••••••" : "16-character app password"}
            className="mt-1 w-full rounded-md border border-line bg-elev px-3 py-2 font-mono text-sm"
          />
          <p className="mt-1 text-[11px] text-faint">
            A Google app password, not the account password. Requires 2-Step
            Verification on that account.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted">Minimum severity</label>
          <select
            value={minSeverity}
            onChange={(e) => setMinSeverity(e.target.value as "critical" | "major")}
            className="mt-1 w-full rounded-md border border-line bg-elev px-3 py-2 text-sm"
          >
            <option value="major">Critical and major</option>
            <option value="critical">Critical only</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted">
            Repeat reminder after (hours)
          </label>
          <input
            type="number"
            min={1}
            value={renotifyHours}
            onChange={(e) => setRenotifyHours(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-elev px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-faint">
            How long an unchanged problem stays quiet before it is repeated.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted">SMTP host</label>
          <input
            type="text"
            value={smtpHost}
            onChange={(e) => setSmtpHost(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-elev px-3 py-2 font-mono text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted">SMTP port</label>
          <input
            type="number"
            value={smtpPort}
            onChange={(e) => setSmtpPort(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-elev px-3 py-2 font-mono text-sm"
          />
          <p className="mt-1 text-[11px] text-faint">465 for SSL, 587 for STARTTLS.</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => act("save")}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => act("test")}
          className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy === "test" ? "Sending…" : "Send test email"}
        </button>
        {settings.lastTestAt ? (
          <span className="text-xs text-muted">
            Last test: {settings.lastTestOk ? "passed" : "failed"}
            {settings.lastTestError ? ` — ${settings.lastTestError}` : ""}
          </span>
        ) : null}
      </div>

      {message ? <p className="mt-3 text-sm text-ink">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-[var(--st-bad-fg)]">{error}</p> : null}
    </div>
  );
}
