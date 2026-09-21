import { AlertSettingsForm } from "@/components/settings/AlertSettings";
import {
  getAlertSettings,
  listRecentAlerts,
  type AlertSettingsView,
  type SentAlertView,
} from "@/lib/alertSettings";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

function keyConfigured(): boolean {
  const raw = process.env.SETTINGS_SECRET_KEY?.trim();
  return Boolean(raw && raw.length >= 16);
}

export default async function AlertSettingsPage() {
  let settings: AlertSettingsView | null = null;
  let recent: SentAlertView[] = [];
  let loadError: string | null = null;
  try {
    settings = await getAlertSettings();
    recent = await listRecentAlerts();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Email alerts</h1>
        <p className="mt-1 text-sm text-muted">
          One digest per run, never one message per finding. A new problem is
          sent immediately, an unchanged one repeats at most once per window,
          and a problem that disappears produces a single recovery note.
        </p>
      </header>

      {loadError ? (
        <div className="mb-4 rounded-lg border border-line bg-card p-4 text-sm text-[var(--st-bad-fg)]">
          Could not load settings: {loadError}
        </div>
      ) : null}

      {settings ? (
        <AlertSettingsForm settings={settings} keyConfigured={keyConfigured()} />
      ) : null}

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Recent alert mail</h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing sent yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-card">
            {recent.map((alert) => (
              <li key={alert.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-[11px] " +
                    (alert.delivered
                      ? "bg-[var(--st-ok-bg)] text-[var(--st-ok-fg)]"
                      : "bg-[var(--st-bad-bg)] text-[var(--st-bad-fg)]")
                  }
                >
                  {alert.delivered ? "sent" : "failed"}
                </span>
                <span className="flex-1 truncate">{alert.subject ?? "(no subject)"}</span>
                <span className="font-mono text-xs text-muted">
                  {formatDateTime(alert.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
