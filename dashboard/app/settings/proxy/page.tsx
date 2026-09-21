import { ProxySettings } from "@/components/settings/ProxySettings";
import { listProxySettings, type ProxySettingView } from "@/lib/proxySettings";

export const dynamic = "force-dynamic";

function keyConfigured(): boolean {
  const raw = process.env.SETTINGS_SECRET_KEY?.trim();
  return Boolean(raw && raw.length >= 16);
}

export default async function ProxySettingsPage() {
  const configured = keyConfigured();
  let settings: ProxySettingView[] = [];
  let loadError: string | null = null;
  if (configured) {
    try {
      settings = await listProxySettings();
    } catch (err) {
      // Most likely migration 0008 has not run yet on this database.
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Proxy providers</h1>
        <p className="mt-1 text-sm text-muted">
          Choose which provider each country goes through. A setting can only
          be activated after its connection test passes: an exit IP the site
          resolves to the wrong country would run every check against the
          wrong cache bucket, reporting green while measuring nothing.
        </p>
      </header>

      {loadError ? (
        <div className="mb-4 rounded-lg border border-line bg-card p-4 text-sm text-[var(--st-bad-fg)]">
          Could not load settings: {loadError}
        </div>
      ) : null}

      <ProxySettings settings={settings} keyConfigured={configured} />
    </main>
  );
}
