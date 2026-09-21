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
        <h1 className="text-xl font-semibold">Proxy sağlayıcıları</h1>
        <p className="mt-1 text-sm text-muted">
          Her ülke için hangi sağlayıcının kullanılacağını buradan seç. Bir kayıt
          ancak bağlantı testi geçtikten sonra aktifleştirilebilir: testi geçmeyen
          bir çıkış IP&apos;si, tüm kontrolleri yanlış ülke kovasına karşı çalıştırır
          ve her şey yeşil görünürken sonuçlar anlamsızlaşır.
        </p>
      </header>

      {loadError ? (
        <div className="mb-4 rounded-lg border border-line bg-card p-4 text-sm text-[var(--st-bad-fg)]">
          Ayarlar okunamadı: {loadError}
        </div>
      ) : null}

      <ProxySettings settings={settings} keyConfigured={configured} />
    </main>
  );
}
