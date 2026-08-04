# Railway Deployment — Adım Adım (Faz 1: Canlıya Alma)

> Tek GitHub reposundan **iki ayrı Railway servisi** kurulur:
> **1) runner** (test motoru — batch iş) ve **2) dashboard** (gezilebilir panel).
> Postgres zaten Railway projesinde mevcut. Test edilen siteye asla dokunulmaz.

## 0. Neden iki servis?
Runner bir web sunucusu **değildir** — komutunu çalıştırır, işini yapar ve çıkar.
Panel ise gerçek bir web servisidir (herkese açık URL). Bu yüzden Railpack ilk
denemede "No start command" hatası verdi. Aşağıdaki Dockerfile'lar bunu çözer.

Railway'in ilk otomatik açtığı (repo kökünü işaret eden) servis **runner** olacak.
Panel için **ikinci bir servis** ekleyeceğiz.

---

## 1. Runner servisi (mevcut, hatalı olan servis)

Bu, GitHub'ı bağlayınca açılan servistir. Artık kökteki `Dockerfile` +
`railway.json` sayesinde doğru derlenecek.

**Settings:**
- **Root Directory:** `/` (boş/kök — varsayılan).
- Build otomatik olarak kökteki `Dockerfile`'ı kullanır (railway.json bunu söyler).
- Restart Policy: `NEVER` (railway.json'da ayarlı — iş bitince çıkması normaldir).

**Variables (env) — şu değişkenleri ekle** (değerler yereldeki `.env`'de):

| Değişken | Not |
|----------|-----|
| `DATABASE_URL` | **Öneri:** Railway referansı `${{Postgres.DATABASE_URL}}` (iç ağ, hızlı/güvenli). |
| `TARGET_BASE_URL` | `https://www.fieldpie.com` |
| `PROXY_US` | ABD proxy URL'i |
| `PROXY_AE` | BAE proxy URL'i |
| `PROXY_TR` | TR proxy URL'i |
| `MONITOR_USER_AGENT` | Kinsta allowlist bypass user-agent |
| `MANIFEST_SECRET` | WP manifest secret |
| `MANIFEST_URL` | WP manifest endpoint URL'i |
| `ANTHROPIC_API_KEY` | AI görsel doğrulama için |
| `SETTLE_MS` | (opsiyonel) örn. 4000 |
| `NAV_TIMEOUT_MS` | (opsiyonel) örn. 45000 |

> `${{Postgres.DATABASE_URL}}` referansını kullanırsan `DATABASE_SSL` gerekmez.
> Eğer public bağlantı (`DATABASE_PUBLIC_URL`) kullanırsan ve SSL hatası alırsan
> `DATABASE_SSL=true` ekle.

**Ne yapar:** Her deploy'da sırayla `migrate` → `seed` → `sweep` çalıştırır,
Postgres'e sonuç yazar ve çıkar. Deploy loglarında sweep tablosunu görürsün.
Servis "çalışıyor" kalmaz, iş bitince durur — **bu beklenen davranıştır**.

> Not: Şu an her push'ta bir sweep koşar (canlı proof için). Faz 2'de (12 saatlik
> cron) start komutu sadeleştirilip sweep zamanlamaya taşınacak.

---

## 2. Dashboard servisi (yeni ekle)

**New → GitHub Repo → aynı repoyu seç** (`website-test-tool`). Sonra:

**Settings:**
- **Root Directory:** `dashboard`  ← **en kritik ayar**. Bunu ayarlayınca Railway
  `dashboard/Dockerfile` ve `dashboard/railway.json`'ı kullanır.
- **Networking → Generate Domain:** herkese açık panel URL'i oluştur.

**Variables (env):**

| Değişken | Not |
|----------|-----|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (runner ile aynı DB) |
| `DASHBOARD_USER` | Panel Basic Auth kullanıcı adı |
| `DASHBOARD_PASSWORD` | Panel Basic Auth şifresi |
| `DATABASE_SSL` | (yalnızca public URL + SSL hatası olursa) `true` |

**Ne yapar:** Next.js paneli derler ve `$PORT`'ta yayınlar. URL'e girince Basic
Auth sorar; runner'ın yazdığı sweep/health sonuçlarını gösterir.

---

## 3. Doğrulama (deploy sonrası)

1. **Runner** deploy loglarında: `migrate` migrasyonları uyguladı, `seed`
   market/sayfaları yazdı, `sweep` US/AE/TR × home/pricing koştu ve
   `sweep … -> pass/warn/fail` özetiyle bitti.
2. **Dashboard** URL'ini aç → Basic Auth gir → **Overview**'da yeni sweep görünmeli.
3. Sweep detayına gir: her run'ın HTTP durumu, `x-kinsta-cache` kovası, exit-vs-site
   country ve dil + deterministik kontroller görünür.

Sorun olursa:
- Build hatası → ilgili servisin **Build Logs**'una bak (Dockerfile adımı).
- DB bağlantı hatası → `DATABASE_URL` referansı doğru mu; gerekiyorsa `DATABASE_SSL=true`.
- Sweep 0 sonuç → proxy env'leri eksik/yanlış olabilir.

---

## 4. Faz 2 — 12 saatlik cron (kurulum)

Runner artık her çalıştığında **tam pipeline**'ı koşar (`npm run cron`):
`migrate → seed → autopilot (öğrenme) → sweep (geo) → healthcheck (tüm site)`.
autopilot/sweep/healthcheck her biri `|| true` ile korunur — biri patlarsa
diğerleri yine çalışır.

**Railway'de yapılacak (runner servisi):**

1. Runner servisi → **Settings → Cron Schedule** alanına: `0 */12 * * *`
   (UTC; her gün 00:00 ve 12:00'de çalışır).
2. **Restart Policy** zaten `NEVER` (railway.json). Cron servisi işini bitirince
   durur — bu normaldir.
3. Değişiklikleri push et (aşağıdaki commit). Railway yeni imajı build eder.
   Cron bir sonraki tetik saatinde (00:00/12:00 UTC) çalışır; hemen bir sonuç
   görmek istersen servisin **⋯ → Restart/Redeploy** ile bir kez elle tetikle.

**Doğrulama:** Cron çalıştıktan sonra panelde hem yeni bir **sweep** hem de yeni
bir **health run** görünmeli. Runner'ın Deploy Logs'unda
`autopilot … done`, `sweep … -> …`, `health run #N … finished` satırları olur.

> Not: Tüm siteyi 3 ülke proxy'siyle gezen health crawl en yüksek proxy
> maliyetli adımdır. Maliyet yükselirse `src/config/health.ts` içindeki
> `maxPagesPerCountry` ile sınırlayabilir ya da cron sıklığını düşürebiliriz.

---

## 5. Sıradaki fazlar (bilgi)

- **Faz 3 — Ekran görüntüsü (R2):** görüntüler Cloudflare R2'ye yüklenip panelde
  gösterilir.
- **Faz 4 — Gerçek insan gibi tıklama:** health hattında navigasyon-only gerçek
  tıklama testleri.

> Alarm (e-posta/Slack) şimdilik kapsam dışı (kullanıcı tercihi).
