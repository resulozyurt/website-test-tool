# FieldPie İzleme & Test Sistemi — Proje Durumu ve Geliştirme Yol Haritası

> **Bu dosyanın amacı:** Yeni bir sohbete/oturuma geçildiğinde projeye 5 dakikada
> tam hakim olmak. Sistemin ne olduğu, nasıl çalıştığı, şu an neyi yapabildiği,
> hayal edilen hedefe göre nelerin eksik olduğu ve bunların hangi sırayla
> tamamlanacağı burada. Son güncelleme: 2026-08-04.

---

## 1. Tek Cümleyle Proje

`fieldpie.com`'u **gerçek bir kullanıcı gibi**, farklı ülkelerden (US / AE / TR)
otomatik ziyaret eden; iş kurallarını (doğru CTA, fiyat görünürlüğü, ülkeye özel
başlık/telefon, dil) ve teknik/görsel/fonksiyonel sağlığı (HTTP, konsol hataları,
bozuk görsel, kayan layout, tıklanamayan buton, ölü link, geo-sızıntı) tarayıp
loglayan; sonuçları bir panelde gösteren **bağımsız** izleme/test sistemi. Test
edilen siteye asla dokunmaz (salt-okunur).

- **Repo:** https://github.com/resulozyurt/website-test-tool
- **Dil/teknoloji:** Node + TypeScript + Playwright (Chromium), PostgreSQL,
  Next.js panel (dashboard), Zod, proxy-chain.
- **Test edilen site:** fieldpie.com — Kinsta + Cloudflare arkasında, sunucu
  tarafı Kinsta Geolocation ile ülke tespiti, Bricks Builder + Polylang.

---

## 2. Hayal Edilen Sistem (Hedef Vizyon)

Kullanıcının hayal ettiği sistemin özü:

1. Bir **AI motoru** websiteyi belirli periyotlarda (ör. 6 saatte bir) gerçek bir
   insan gibi ziyaret etsin.
2. Hata / bug var mı diye tarasın, **logları kaydedip panelde listelesin**.
3. **Ülke bazlı içerik farklarını kendisi öğrensin** (bazı içerik ABD'ye
   gösterilip TR'ye gösterilmiyor vb.) ki bunları hata sanmasın.
4. Şu testleri yapsın: görsel yüklenmemiş mi, buton tıklanmıyor mu, buton
   metni ile linki uyumsuz mu, layout'ta kayma var mı, ABD'de görünmesi gereken
   bir event TR'de görünüyor mu (geo-sızıntı) vb.
5. Hata olunca **uyarı (alarm)** göndersin.

---

## 3. Mevcut Sistemin Genel Mimarisi

Sistem **iki bağımsız test hattı (lane)** + bir **öğrenme/besleme boru hattı** +
bir **panel** olarak kurgulanmış.

```
                         ┌──────────────────────────────────────────┐
   fieldpie.com  ◄───────┤  Ülke hedefli proxy (US / AE / TR)        │
   (Kinsta+CF,           │  Playwright Chromium — salt-okunur ziyaret│
    Bricks+Polylang)     └──────────────────────────────────────────┘
        ▲                          │                      │
        │ salt-okunur              │                      │
        │                 ┌────────▼─────────┐   ┌────────▼──────────┐
        │                 │  GEO SWEEP hattı  │   │  HEALTH CRAWL hattı│
        │                 │  (src/runner/)    │   │  (src/health/)     │
        │                 └────────┬─────────┘   └────────┬──────────┘
        │                          │                      │
   ┌────┴─────────┐        ┌───────▼──────────────────────▼────────┐
   │ WP Manifest  │        │        PostgreSQL (Railway)            │
   │ + Inventory  │───────▶│  sweeps/runs/checks + health_* + ...   │
   │ (REST, gizli │        └───────────────────┬────────────────────┘
   │  secret)     │                            │
   └──────────────┘                    ┌───────▼────────┐
   Öğrenme boru hattı                  │  Next.js Panel │
   (discover→scenarios→                │  (dashboard/)  │
    manifest→learn, orchestrate.ts)    └────────────────┘
```

### 3.1 GEO SWEEP hattı — `src/runner/`
Her **market × sayfa** (US/AE/TR × home/pricing) kombinasyonunu ilgili ülke
proxy'siyle ziyaret eder ve **deterministik** kontroller yapar:
- `http_health`, `geo` (site hangi ülkeyi algıladı), `cache_header`
  (`x-kinsta-cache` HIT ve doğru ülke kovası mı), `cross_country` (farklı ülke →
  farklı içerik mi; "TR'ye sessiz düşme" arızası), `language`, `cta`, `price`,
  `heading`, `phone`.
- `scenario`: Bricks görünürlük kuralları (bir öğe US'te **present**, TR'de
  **absent** olmalı gibi) canlı DOM'da doğrulanır. Para-kritik senaryolar
  (fiyat/plan/CTA) ayrıca işaretlenir.
- `security_passive`: HTTPS, güvenlik header'ları, cookie flag'leri, versiyon
  sızıntısı, monitörün kendi token'ının HTML'e yansımaması.
- `interaction`: **submit etmeyen** güvenli etkileşimler (popup aç, görünür mü,
  alanı lokal doldur). PROD'da asla yan etki oluşturmaz.
- `ai_semantic`: Ekran görüntüsü + beklenti Claude'a gönderilir, **danışman**
  (advisory) görsel doğrulama verdikt'i alınır — asla pass/fail'i değiştirmez.

### 3.2 HEALTH CRAWL hattı — `src/health/`
Sitedeki **her keşfedilmiş sayfayı** (dil başına, ilgili ülke proxy'siyle)
gezer ve uçtan uca sağlık çıkarır:
- **Teknik:** HTTP durumu, boş/blank sayfa, konsol hataları (first-party JS
  hatası **gating**; üçüncü parti/CORS gürültüsü **advisory**), başarısız kaynak
  istekleri (first-party 4xx/5xx gating; abort/blocked/üçüncü parti advisory),
  410 Gone ayrı ele alınır.
- **Görsel (deterministik):** bozuk görsel (`broken_image`), yatay taşma
  (`horizontal_overflow`), viewport dışına taşan öğe, font yükleme durumu, **CLS
  (layout kayması)**, scroll sonrası yüklenmeyen görsel, **çakışan/üst üste
  binen öğeler** (`element_overlap`).
- **Fonksiyonel:** link/buton tıklanabilirliği (geometrik: görünür, boyutlu,
  üstü kapalı değil, disabled değil), boş/`#`/`javascript:` href (`dead_href`),
  **iç link erişilebilirlik probu** (HEAD→GET, ölü link `dead_link` gating),
  **buton metni ↔ hedef link uyumu** (`link_coherence` — "Pricing" yazıp ana
  sayfaya gidiyorsa), market'in **beklenen CTA'sı var mı ve tıklanabilir mi**
  (`cta_missing`/`cta_unclickable`), input üretmeyen formlar, hover'da açılmayan
  menüler.
- **AI görsel (opsiyonel, advisory):** uzun sayfa okunabilir dilimlere kesilir,
  tüm dilimler tek Claude çağrısında gönderilir, objektif görsel kusur raporu
  alınır. Varsayılan **kapalı** (maliyet kontrolü); talep üzerine açılır.

> Not: Health crawl gerçek tıklama **yapmaz** (PROD salt-okunur). Tıklanabilirlik
> geometrik olarak ölçülür. Gerçek submit testi staging işidir (henüz yok).

### 3.3 Öğrenme / besleme boru hattı
- **`src/discovery/`**: Sitemap'i okur (salt-okunur GET), tüm URL'leri sınıflar
  (dil, slug, test dışı mı) ve `discovered_pages` envanterini günceller.
- **`src/scenarios/`**: WP inventory endpoint'inden Bricks koşullarını okuyup
  **ülke bazlı görünürlük senaryoları** üretir (present/absent), para-kritikleri
  işaretler.
- **`src/manifest/`**: WP MU/plugin REST manifest'ini (`/wp-json/fieldpie-monitor/
  v1/manifest`, gizli secret ile) çeker; geo kuralları, plan kataloğu, sayfa
  başlıklarını `expectations` tablosuna senkronlar.
- **`src/learn/`**: Sayfaları canlı render edip beklenti önerileri üretir. Öncelik
  **manual > auto > manifest**. `orchestrate.ts` (autopilot) tüm zinciri sırayla
  çalıştırır: discover → scenarios → reconcile → manifest sync → learn(auto).

### 3.4 Panel — `dashboard/` (Next.js)
Postgres'i salt-okunur okur (RSC içinde, `DATABASE_URL` tarayıcıya sızmaz), HTTP
Basic Auth arkasında. Ayrı bir Railway servisi olarak deploy edilir. Gösterdiği:
son sweep'ler ve durum rozetleri, sweep run'ları (ülke×sayfa, HTTP/cache/exit-vs-
site country/dil), deterministik kontroller + AI verdikt, health run'ları ve
sayfa bazlı bulgular (severity/status filtreli), pass-rate trend ve bulgu dağılım
grafikleri.

### 3.5 Veritabanı — `src/db/migrations/`
- `0001_init`: environments, markets, pages, expectations, sweeps, runs, checks,
  ai_verdicts.
- `0002_discovery`: discovered_pages envanteri.
- `0003_scenarios`: ülke bazlı görünürlük senaryoları.
- `0004_inventory_flag`: sayfanın kendi Bricks içeriği var mı.
- `0005_health`: health_runs / health_pages / health_findings.

---

## 4. Komut Referansı (`package.json`)

| Komut | İş |
|-------|-----|
| `npm run migrate` | DB şemasını kurar/güncelller |
| `npm run seed` | markets/pages/environments başlangıç verisi |
| `npm run discover` | sitemap'ten sayfa envanteri |
| `npm run inventory` | WP inventory'den Bricks koşulları |
| `npm run scenarios:gen` | görünürlük senaryoları üret |
| `npm run pages:reconcile` | senaryolu sayfaları sweep listesine ekle |
| `npm run manifest:sync` | manifest → expectations |
| `npm run learn` / `learn:apply` / `learn:auto` | canlı render öğrenme |
| `npm run autopilot` | tüm öğrenme zinciri uçtan uca |
| `npm run sweep` | GEO SWEEP hattını çalıştır |
| `npm run healthcheck` | HEALTH CRAWL hattını çalıştır |
| `npm run typecheck` | TS tip kontrolü |

Ortam değişkenleri `.env` (bkz. `.env.example` ve `src/config/env.ts`): proxy'ler
(US/AE/TR), manifest secret, DATABASE_URL, ANTHROPIC_API_KEY ve (henüz kod
tarafında **kullanılmayan** ama tanımlı) STORAGE_* (R2), ALERT_EMAIL_*,
RESEND_API_KEY.

---

## 5. Hayal ↔ Mevcut: Fark (Gap) Analizi

| # | Hayal edilen yetenek | Durum | Nerede |
|---|----------------------|-------|--------|
| 1 | Görsel yüklenmemiş mi | ✅ Var | `visual.ts` broken_image / image_not_loaded |
| 2 | Buton tıklanmıyor mu | ✅ Var (geometrik) | `functional.ts` clickable, cta_unclickable |
| 3 | Buton metni ↔ link uyumsuz | ✅ Var | `coherence.ts` link_coherence |
| 4 | Layout'ta kayma | ✅ Var | `visual.ts` CLS, overflow, overlap |
| 5 | Geo-sızıntı (US içeriği TR'de) | ✅ Var | `scenarios` present/absent + cross_country |
| 6 | "TR'ye sessiz düşme" arızası | ✅ Var | GEO sweep cross-country |
| 7 | Ülke farklarını **kendi öğrenmesi** | 🟡 Kısmi | manifest/inventory'e bağımlı; manifestsiz saf render-diff yok |
| 8 | Gerçek insan gibi **tıklama/gezinme** | 🟡 Kısmi | sweep'te submit-etmeyen tık; health'te sadece geometrik |
| 9 | **Periyodik otomatik çalışma** (6 saatte bir) | ❌ Yok | zamanlayıcı/cron kodu yok |
| 10 | **Hata olunca alarm** (e-posta/Slack) | ❌ Yok | sadece env placeholder, kod yok |
| 11 | **Ekran görüntüsü kalıcılığı** (R2) + panelde gösterim | ❌ Yok | lokal path saklanıyor, panelde gösterilmiyor |
| 12 | **Deployment** (Docker + Railway) | ❌ Yok | repoda Dockerfile/railway config yok |

**Özet:** Sistemin **test/algılama zekâsı beklenenden çok daha olgun** — hayal
edilen kontrollerin neredeyse tamamı deterministik + AI advisory olarak mevcut.
Asıl eksikler "**operasyonel omurga**"da: otomatik çalışma, alarm, ekran görüntüsü
kalıcılığı ve deployment. Bunlar tamamlanınca sistem "kur ve unut" hâline gelir.

---

## 6. Geliştirme Yol Haritası (Öncelikli)

Prensip: en yüksek değeri en düşük riskle veren "operasyonel omurga" önce.
Her faz bağımsız test edilebilir ve canlı siteye dokunmaz.

### Faz A — Ekran Görüntüsü Kalıcılığı (R2) + Panelde Gösterim
- S3-uyumlu istemci (Cloudflare R2) ekle; sweep ve health ekran görüntülerini
  yükle, DB'de anahtarı sakla (şu an lokal path).
- Panelde run/sayfa detayında ekran görüntüsünü göster.
- Retention/temizlik politikası (ör. 30 gün).
- **Çıktı:** her bulgunun görsel kanıtı panelden görülebilir.

### Faz B — Alarm Sistemi (E-posta ve/veya Slack)
- Bir sweep/health run başarısız (fail) olunca özet uyarı gönder: hangi
  market/sayfa, hangi bulgular, panel linki, ekran görüntüsü linki.
- Resend (e-posta) ve/veya Slack webhook; env değerleri zaten tanımlı.
- Gürültü kontrolü: sadece gating (critical/major) bulgularda alarm; tekrarlayan
  aynı hatayı bastırma (dedupe/eşikleme).
- **Çıktı:** "hata olunca haber ver" gerçekleşir.

### Faz C — Zamanlama / Periyodik Otomatik Çalışma
- Railway Cron ile 6 saatte bir: `autopilot` (öğrenme) → `sweep` → `healthcheck`
  zinciri, `trigger='cron'`.
- Kilit/çakışma koruması (önceki koşu bitmeden yenisi başlamasın).
- Kalıcı hata eskalasyonu: aynı hedef ardışık koşularda başarısızsa yükselt.
- **Çıktı:** sistem insan müdahalesi olmadan düzenli çalışır.

### Faz D — Deployment / Paketleme
- Runner için Dockerfile (Playwright Chromium dahil), Railway servis tanımı.
- Panel ayrı Railway servisi (kök `dashboard/`).
- Migrasyonların deploy'da otomatik çalışması; secret yönetimi.
- **Çıktı:** repo'dan tek adımda çalışan canlı sistem.

### Faz E — Daha Derin "İnsan Gibi" Etkileşim (Health)
- Health hattında **gerçek tıklama** modu (güvenli, navigasyon-only): kritik
  butonlara tıkla, hedefe gerçekten ulaşıyor mu doğrula (geometrik değil).
- Menü/aç-kapa, sekme, akordeon gibi etkileşimlerin gerçek testi.
- İsteğe bağlı: staging hattı ile gerçek form submit (yan etkili) testleri.
- **Çıktı:** "buton tıklanınca gerçekten çalışıyor mu" kanıtlanır.

### Faz F — Manifestsiz Geo Öğrenme (Sağlamlaştırma)
- WP manifest'e bağımlı olmadan, aynı sayfanın ülkeler arası render'larını
  karşılaştırıp **anlamlı içerik farklarını otomatik keşfetme** (sadece Bricks
  kuralı olan değil, gerçekte değişen her şey).
- AI ile fark sınıflandırma: "beklenen geo-fark" mı yoksa "muhtemel hata" mı.
- **Çıktı:** öğrenme WP eklentisi olmadan da çalışır, kör nokta azalır.

### Faz G — Hardening / İzlenebilirlik
- Yapısal loglama, koşu metrikleri, maliyet takibi (AI $), sağlık/uptime.
- Test kapsamı: kritik yardımcılar için birim testleri, tip kontrolü CI.
- Maliyet hedefi (~15-30 $/ay) doğrulama ve proxy kullanımının izlenmesi.

> **Not:** WordPress tarafındaki MU-plugin / REST manifest endpoint'i bu repoda
> **yok** (WP kurulumunda ayrı yaşıyor). Faz F dışında yol haritası bu eklentiye
> dokunmadan ilerler; dokunulması gerekirse ayrıca ele alınır.

---

## 7. Önerilen Çalışma Sırası ve Onay Akışı

Kullanıcının kuralı gereği: **önce plan, sonra açık onay, sonra faz faz ilerleme.**
Önerilen sıra: **A → B → C → D** (operasyonel omurga) ardından **E → F → G**
(derinleşme/sağlamlaştırma). Her faz sonunda çıktı onaya sunulur, sonra diğerine
geçilir. Fazlar bağımsızdır; öncelik kullanıcı isteğine göre değiştirilebilir
(ör. önce alarm istenirse B öne alınabilir).

---

## 8. Yeni Sohbet İçin Hızlı Başlangıç Notu

Bir sonraki oturumda: bu dosyayı oku, sonra `README.md`, `package.json`,
`src/config/*` ve ilgili hattın (`src/runner/` veya `src/health/`) kaynağına bak.
Canlı siteye **asla** yazma; tüm değişiklikler kendi DB/servislerimizde olur.
Yeni ülke/dil eklemek = ilgili config dizisine tek satır (`targets.ts`,
`health.ts`). Kod stili: yorumlar niyeti anlatır, `page.evaluate` gövdelerinde
adlandırılmış fonksiyon **kullanma** (esbuild `__name` sorunu).
