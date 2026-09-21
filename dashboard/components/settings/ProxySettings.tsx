"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  PROVIDERS,
  getProvider,
  type CountryCode,
  type ProviderDef,
} from "@/lib/proxy-providers.generated";
import type { ProxySettingView } from "@/lib/proxySettings";

const COUNTRIES: { code: CountryCode; label: string }[] = [
  { code: "US", label: "ABD" },
  { code: "TR", label: "Türkiye" },
  { code: "AE", label: "BAE" },
];

interface TestResult {
  ok: boolean;
  countryMismatch: boolean;
  exitIp: string | null;
  siteCountry: string | null;
  cacheCountry: string | null;
  error: string | null;
  durationMs: number;
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/proxy", {
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

function formatTest(r: TestResult): string {
  const verdict = r.ok ? "Başarılı" : r.countryMismatch ? "Yanlış ülke" : "Başarısız";
  return [
    verdict,
    `IP: ${r.exitIp ?? "—"}`,
    `site: ${r.siteCountry ?? "—"}`,
    `cache: ${r.cacheCountry ?? "—"}`,
    r.error ? `hata: ${r.error}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function ProviderForm({
  country,
  onDone,
}: {
  country: CountryCode;
  onDone: () => void;
}) {
  const [providerId, setProviderId] = useState<string>(PROVIDERS[0].id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const provider = getProvider(providerId) as ProviderDef;

  function setValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function run(action: "test" | "save") {
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      if (action === "test") {
        const data = await post({
          action: "test",
          country,
          providerId,
          credentials: values,
        });
        setMessage(formatTest(data.result as TestResult));
      } else {
        // Save, then test the saved row so its result is recorded and the
        // provider can be activated -- activation is refused without a pass.
        const saved = await post({
          action: "save",
          country,
          providerId,
          label: label || null,
          credentials: values,
        });
        const data = await post({ action: "test", id: saved.id });
        setMessage(`Kaydedildi. Test: ${formatTest(data.result as TestResult)}`);
        setValues({});
        setLabel("");
        onDone();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-line bg-elev p-4">
      <label className="block text-xs font-medium text-muted">Sağlayıcı</label>
      <select
        value={providerId}
        onChange={(e) => {
          setProviderId(e.target.value);
          setValues({});
          setMessage(null);
          setError(null);
        }}
        className="mt-1 w-full rounded-md border border-line bg-card px-3 py-2 text-sm"
      >
        {PROVIDERS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <p className="mt-2 text-xs text-muted">{provider.setupHint}</p>
      {provider.pricingUrl ? (
        <a
          href={provider.pricingUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs text-brand underline"
        >
          Fiyat sayfası
        </a>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {provider.fields.map((field) => (
          <div key={field.key}>
            <label className="block text-xs font-medium text-muted">
              {field.label}
            </label>
            <input
              type={field.secret ? "password" : "text"}
              value={values[field.key] ?? ""}
              placeholder={field.example ?? ""}
              autoComplete="off"
              onChange={(e) => setValue(field.key, e.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-sm"
            />
            <p className="mt-1 text-[11px] text-faint">{field.help}</p>
          </div>
        ))}
        <div>
          <label className="block text-xs font-medium text-muted">
            Etiket (isteğe bağlı)
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ör. ana hesap"
            className="mt-1 w-full rounded-md border border-line bg-card px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run("test")}
          className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy === "test" ? "Test ediliyor…" : "Bağlantıyı test et"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run("save")}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === "save" ? "Kaydediliyor…" : "Kaydet ve test et"}
        </button>
      </div>

      {message ? <p className="mt-3 text-sm text-ink">{message}</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-[var(--st-bad-fg)]">{error}</p>
      ) : null}
    </div>
  );
}

function SettingRow({
  setting,
  onChanged,
}: {
  setting: ProxySettingView;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const provider = getProvider(setting.providerId);

  async function act(action: "test" | "activate" | "delete") {
    if (action === "delete" && !confirm("Bu proxy kaydı silinsin mi?")) {
      return;
    }
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      const data = await post({ action, id: setting.id });
      if (action === "test") {
        setMessage(formatTest(data.result as TestResult));
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const detail = setting.lastTestDetail;
  return (
    <div className="flex flex-col gap-2 border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{provider?.name ?? setting.providerId}</span>
        {setting.label ? (
          <span className="text-xs text-muted">{setting.label}</span>
        ) : null}
        {setting.isActive ? (
          <span className="rounded-full bg-[var(--st-ok-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--st-ok-fg)]">
            aktif
          </span>
        ) : null}
        <span
          className={
            "rounded-full px-2 py-0.5 text-[11px] " +
            (setting.lastTestOk === true
              ? "bg-[var(--st-ok-bg)] text-[var(--st-ok-fg)]"
              : setting.lastTestOk === false
                ? "bg-[var(--st-bad-bg)] text-[var(--st-bad-fg)]"
                : "bg-[var(--st-none)] text-[var(--st-none-fg)]")
          }
        >
          {setting.lastTestOk === true
            ? "test geçti"
            : setting.lastTestOk === false
              ? "test başarısız"
              : "test edilmedi"}
        </span>
      </div>

      {detail ? (
        <p className="font-mono text-[11px] text-muted">
          IP: {detail.exitIp ?? "—"} · site: {detail.siteCountry ?? "—"} · cache:{" "}
          {detail.cacheCountry ?? "—"}
          {detail.error ? ` · ${detail.error}` : ""}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => act("test")}
          className="rounded-md border border-line px-2.5 py-1 text-xs disabled:opacity-50"
        >
          {busy === "test" ? "Test ediliyor…" : "Test et"}
        </button>
        {!setting.isActive ? (
          <button
            type="button"
            disabled={busy !== null || setting.lastTestOk !== true}
            title={
              setting.lastTestOk === true
                ? undefined
                : "Önce başarılı bir test gerekiyor"
            }
            onClick={() => act("activate")}
            className="rounded-md border border-line px-2.5 py-1 text-xs disabled:opacity-40"
          >
            Aktif et
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy !== null || setting.isActive}
          title={setting.isActive ? "Aktif kayıt silinemez" : undefined}
          onClick={() => act("delete")}
          className="rounded-md border border-line px-2.5 py-1 text-xs text-[var(--st-bad-fg)] disabled:opacity-40"
        >
          Sil
        </button>
      </div>

      {message ? <p className="text-xs text-ink">{message}</p> : null}
      {error ? <p className="text-xs text-[var(--st-bad-fg)]">{error}</p> : null}
    </div>
  );
}

export function ProxySettings({
  settings,
  keyConfigured,
}: {
  settings: ProxySettingView[];
  keyConfigured: boolean;
}) {
  const router = useRouter();
  const [openForm, setOpenForm] = useState<CountryCode | null>(null);
  const refresh = () => router.refresh();

  if (!keyConfigured) {
    return (
      <div className="rounded-xl border border-line bg-card p-6 text-sm">
        <p className="font-medium">SETTINGS_SECRET_KEY tanımlı değil.</p>
        <p className="mt-2 text-muted">
          Proxy kimlik bilgileri bu anahtarla şifrelenip saklanıyor. Anahtar
          olmadan panel hiçbir şey kaydetmez; en az 16 karakterlik bir değeri
          hem panel hem runner servisine ekle, sonra bu sayfayı yenile. Anahtar
          yokken sistem eskisi gibi PROXY_US / PROXY_TR / PROXY_AE değişkenlerini
          kullanmaya devam eder.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {COUNTRIES.map(({ code, label }) => {
        const rows = settings.filter((s) => s.country === code);
        const active = rows.find((s) => s.isActive);
        return (
          <section key={code} className="rounded-xl border border-line bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">
                {label} <span className="font-mono text-xs text-faint">{code}</span>
              </h2>
              <span className="text-xs text-muted">
                {active
                  ? `Aktif: ${getProvider(active.providerId)?.name ?? active.providerId}`
                  : "Aktif sağlayıcı yok — PROXY_" + code + " kullanılıyor"}
              </span>
            </div>

            <div className="mt-2">
              {rows.length === 0 ? (
                <p className="py-3 text-sm text-muted">Henüz kayıtlı sağlayıcı yok.</p>
              ) : (
                rows.map((s) => (
                  <SettingRow key={s.id} setting={s} onChanged={refresh} />
                ))
              )}
            </div>

            {openForm === code ? (
              <ProviderForm
                country={code}
                onDone={() => {
                  setOpenForm(null);
                  refresh();
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setOpenForm(code)}
                className="mt-3 rounded-md border border-line px-3 py-1.5 text-sm"
              >
                Sağlayıcı ekle
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
