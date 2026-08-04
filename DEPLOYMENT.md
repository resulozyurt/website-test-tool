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

## 4. Faz 2 — günlük (24 saatte bir) cron (kurulum)

Runner artık her çalıştığında **tam pipeline**'ı koşar (`npm run cron`):
`migrate → seed → autopilot (öğrenme) → sweep (geo) → healthcheck (tüm site)`.
autopilot/sweep/healthcheck her biri `|| true` ile korunur — biri patlarsa
diğerleri yine çalışır.

**Railway'de yapılacak (runner servisi):**

1. Runner servisi → **Settings → Cron Schedule**: `0 0 * * *` (Railway'in
   **"Daily"** ön ayarı). Günde bir kez 00:00 UTC = 03:00 TR'de çalışır.
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

## 5. Faz 3 — Ekran görüntüsü kalıcılığı (Cloudflare R2)

Runner artık her tam sayfa ekran görüntüsünü R2'ye yükler ve DB'ye object key'i
yazar; panel görseli kendi `/api/screenshot` route'u üzerinden (Basic Auth
arkasında) akıtır. Bucket **private** kalabilir.

### 5.1 Cloudflare'de R2 kurulumu (bir kez)

1. Cloudflare Dashboard → **R2 Object Storage** → **Create bucket**. Bir ad ver
   (ör. `fieldpie-monitor-shots`), konum/depolama sınıfını varsayılan bırak →
   **Create bucket**. (Ücretsiz kademe: 10 GB depolama + aylık milyonlarca
   işlem — bu kullanım için fazlasıyla yeterli.)
2. R2 → **Overview** → **API Tokens** kısmında **Manage** → **Create Account API
   token** → izin olarak **Object Read & Write** seç → oluştur.
3. Çıkan **Access Key ID** ve **Secret Access Key** değerlerini kaydet
   (**Secret bir daha gösterilmez**).
4. **S3 endpoint**: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   (Account ID'yi R2 Overview / hesap ayarlarında bulursun).

### 5.2 Env değişkenleri (HEM runner HEM dashboard servisine)

| Değişken | Değer |
|----------|-------|
| `STORAGE_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `STORAGE_BUCKET` | bucket adı (ör. `fieldpie-monitor-shots`) |
| `STORAGE_ACCESS_KEY_ID` | R2 token'ın Access Key ID'si |
| `STORAGE_SECRET_ACCESS_KEY` | R2 token'ın Secret Access Key'i |

> Dört değişkenin **dördü de** iki serviste olmalı: runner yüklemek, dashboard
> okumak için kullanır. Eksikse runner upload'ı atlar (görüntü kalıcı olmaz),
> panel de görsel göstermez — sistem yine çalışır.

### 5.3 Doğrulama

Env'ler girildikten sonra bir cron/sweep çalıştır; panelde bir run/health-page
detayına gir → **Screenshot** küçük görseli görünmeli, tıklayınca tam boy açılmalı.
Eski (Faz 3 öncesi) kayıtlarda görsel olmaz — bu normaldir.

> İsteğe bağlı: R2 bucket'ında **Object lifecycle** kuralı ile (ör. 30 gün)
> eski görüntüleri otomatik sildirebilirsin (depolamayı düşük tutar).

---

## 6. Sıradaki faz (bilgi)

- **Faz 4 — Gerçek insan gibi tıklama:** health hattında navigasyon-only gerçek
  tıklama testleri.

> Alarm (e-posta/Slack) şimdilik kapsam dışı (kullanıcı tercihi).
