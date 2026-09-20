# Günlük kritik tarama — canlı doğrulama listesi

Bu değişiklikler (günlük 4 huni sayfası + haftalık tam tarama) ağ erişimi olan
bir makinede doğrulanmalı: proxy'ler (DataImpulse), Railway Postgres ve
fieldpie.com geliştirme oturumundan erişilemiyordu. Aşağıdaki adımlar sırayla
çalıştırılır; her adımın beklenen çıktısı yazılı.

## 0. Ön koşul — şema

```bash
npm run migrate        # 0006_critical_scope, 0007_sweep_scope uygulanmalı
npm run seed           # 4 sayfa is_critical=true olarak yazılır
```

Beklenen: `applying 0006_critical_scope.sql`, `applying 0007_sweep_scope.sql`,
ardından `page home/pricing/demo/free-trial -> #N (active=true)`.

Kontrol:

```sql
select page_key, is_critical from pages order by id;
-- home, pricing, demo, free-trial => true; reconcile'ın eklediği satırlar => false
```

## 1. Keşif — sitemap dışı sayfa envanterde kalıyor mu

```bash
npm run discover
```

Beklenen: `/fieldpie-free-trial/` satırı `source=fixed` ile listede; discovery
tekrar tekrar çalıştırıldığında **pasifleşmemeli**.

```sql
select url, source, is_active from discovered_pages where path = '/fieldpie-free-trial/';
-- fixed / true
```

## 2. Health crawl — kritik kapsam

```bash
npm run healthcheck -- --country=TR
```

Beklenen çıktı başlığı: `healthcheck start (scope=critical, country=TR, ...)`
ve `health run #N TR/tr [critical]: 4 page(s)`.

Doğrulanacaklar:

- [ ] 4 sayfa taranıyor (tüm site değil): `/tr/`, `/tr/fiyatlandirma/`,
      `/tr/demo-talebi/`, `/fieldpie-free-trial/`
- [ ] TR sayfalarında **`cta_forbidden` bulgusu YOK** (trial CTA'sı zaten gizli)
- [ ] free-trial sayfasında da `cta_forbidden` YOK — o sayfada yasak liste
      bilerek kalkıyor (TR'nin doğrudan erişmesi beklenen davranış)
- [ ] `cta_missing` YOK: TR sayfalarında demo / fiyat teklifi / satış
      yollarından en az biri bulunmalı. Çıkarsa, `src/config/cta.ts` içindeki
      `WAYS_FORWARD.tr` listesi sitedeki gerçek metinlerle güncellenmeli.

Aynısı US ve AE için:

```bash
npm run healthcheck -- --country=US
npm run healthcheck -- --country=AE
```

## 3. Geo sweep — kritik kapsam

```bash
npm run sweep
```

Beklenen: `sweep #N started (... scope=critical, trigger=manual, pages=4)`,
3 pazar × 4 sayfa = **12 run** (free-trial dahil; TR pazarı da aynı İngilizce
URL'i ziyaret eder).

Doğrulanacaklar:

- [ ] `price` kontrolü: US/pricing `pass` (fiyat görünür), TR/pricing `pass`
      (fiyat gizli). TR'de fiyat görünürse `critical/fail` — para-kritik alarm.
- [ ] `cta` kontrolü: TR sayfalarında `pass` (yasak CTA yok); free-trial
      sayfasında `cta` kontrolü hiç çıkmamalı (o sayfanın beklentisi yalnız dil).
- [ ] `language` / `content_language`: TR sayfaları `tr`, free-trial `en`
      (üç pazarda da) — TR pazarında free-trial için dil hatası çıkmamalı.
- [ ] `cache_header`: her pazarda `HIT` bekleniyor. `BYPASS`/`MISS` gelirse
      `minor/warn` düşer; ilk koşuda cache ısınıyor olabilir, ikinci koşuda da
      sürüyorsa Kinsta cache kovası incelenmeli.
- [ ] `cross_country`: TR parmak izi US/AE'den farklı olmalı. Aynı çıkarsa
      "TR'ye sessiz düşme" arızası yakalanmış demektir.
- [ ] AE/pricing için fiyat kontrolü **çıkmamalı** (beklenti bilerek yazılmadı).
      AE'nin fiyat gören mi yoksa teklif isteyen bir kitle mi olduğu bu koşunun
      ekran görüntüsünden karara bağlanır, sonra `expectations.ts`'e yazılır.

## 4. Zamanlama

```bash
# Bugün Pazar değilken:
sh scripts/cron.sh          # -> "daily (critical) pipeline"
FULL_CRAWL_DOW=$(date -u +%u) sh scripts/cron.sh   # -> "weekly (full) pipeline"
```

Railway'de: runner servisi **Cron Schedule = `0 0 * * *`**. İlk Pazar
koşusundan sonra panelde kapsamı `full site` olan bir sweep ve health run
görünmeli; diğer günler `funnel`.

## 5. Panel

- [ ] `/` ve `/health` listelerinde her satırda kapsam rozeti (`funnel` /
      `full site`) görünüyor
- [ ] Run detay başlığında kapsam yazıyor
- [ ] Yeni bulgu tipi `cta_forbidden` panelde okunur etiketle geliyor
      ("Forbidden CTA visible")

## 6. Maliyet kontrolü

Günlük: 3 pazar × 4 sayfa = 12 sayfa yüklemesi (health) + 12 (sweep).
Haftalık: buna ek olarak tam envanter (~120 sayfa/dil) + autopilot.
Proxy kullanımı bu orana göre düşmeli; düşmediyse `healthcheck`'in `--scope`
bayrağı olmadan çalıştırılmadığından emin ol (varsayılan `critical`).
