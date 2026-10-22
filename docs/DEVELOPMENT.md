# Geliştirme ve işletme rehberi

## Gereksinimler

- Python ≥ 3.11 (3.13 ile geliştirildi), Node ≥ 20 (22 ile geliştirildi)
- İsteğe bağlı: LibreOffice (`soffice`), Chromium ve `pandoc` → bağımsız PDF üreticili ek testler; yoksa bu testler atlanır.
  CI makinelerinde üretici testleri varsayılan olarak çalışmaz (`FOLUME_PRODUCER_TESTS=1` ile açılır). `pandoc` ayrıca dışa aktarma doğrulamasında (`e2e/export-flow.mjs`) kullanılır
- İsteğe bağlı: Playwright'ın Chromium'u (`/opt/pw-browsers/chromium` ya da `CHROMIUM_PATH`) → uçtan uca testler

## Kurulum

```bash
make setup-backend     # backend/.venv + bağımlılıklar (dev dahil)
make setup-mobile      # mobile/node_modules
cd e2e && npm install  # yalnızca uçtan uca testler için
```

## Çalıştırma

```bash
make dev-api                                   # API → http://localhost:8000 (otomatik yeniden yükleme)

cd mobile
EXPO_PUBLIC_API_URL=http://localhost:8000 npm run web      # tarayıcıda
EXPO_PUBLIC_API_URL=http://<bilgisayar-IP>:8000 npm start  # telefonda Expo Go / geliştirme istemcisi
```

Sunucu adresi ve API anahtarı uygulamada **Ayarlar → Dönüşüm sunucusu** altından da değiştirilir
(`EXPO_PUBLIC_API_URL` yalnızca varsayılandır; Android emülatöründe `http://10.0.2.2:8000`).

Tek bir PDF'yi uygulamasız incelemek için:

```bash
cd backend
.venv/bin/python -m folume.tools.inspect_pdf makale.pdf out/ --text   # blok listesi + sayfa kaplamaları (PNG)
.venv/bin/python -m folume.tools.export_bundle makale.pdf paket/      # document.json + görüntüler
```

## Test

```bash
make check          # ruff + tip kontrolü + backend testleri + mobil birim testleri (CI'ın çalıştırdığı)
make test-backend   # yalnızca backend
make test-mobile    # yalnızca mobil birim
```

Uçtan uca (gerçek Chromium; önce mobil derlemeleri):

```bash
cd mobile && npm run build:reader
EXPO_PUBLIC_API_URL=http://localhost:8765 CI=1 npx expo export --platform web   # → mobile/dist
cd ../e2e
node reader-runtime.mjs    # okuyucu runtime'ı
node app-flow.mjs          # içe aktarma → okuma → ayarlar
node learn-flow.mjs        # AI kapalı/açık, önizleme, kaynak çipleri, not, kavrama testi
node knowledge-flow.mjs    # arama, etiket, bağlantılar, tekrar, dışa aktarma, yedek, iki cihazlı senkron
node formats.mjs           # Kitap / Dergi / sayfa sayfa; büyük makale hız bütçesi
node link-flow.mjs         # arXiv/DOI/bağlantı ile içe aktarma (yerel test sitesi)
node export-flow.mjs       # EPUB / HTML / Markdown / TXT indirmeleri; pandoc varsa geri okuma
```

Hepsi için tek komut: `make e2e` (sentetik külliyatı üretir, paketleri dışa aktarır, web derlemesini yapar ve yedi betiği çalıştırır).

Ekran görüntüleri `e2e/out/shots/` altına yazılır. Her betik kendi API'sini (ve gerekirse sahte LLM'ini) başlatıp kapatır.
Sentetik külliyat ve ölçüm: `cd backend && .venv/bin/python -m evals.run`.

### Marka ve tasarım

Logo (`mobile/assets/brand/folume-mark.svg`, tek renkli sürüm `folume-mark-mono.svg`): kalem ucunun üstünde bir mezuniyet kepi; uç, açık bir kitap gibi açılır.
Uygulama içinde `mobile/src/ui/Logo.tsx` aynı yolları çizer. Simgeleri yeniden üretmek için (Chromium gerekir):

```bash
cd e2e && node brand-assets.mjs   # icon, android ön/arka plan/tek renkli, splash, favicon → mobile/assets
```

Renkler `mobile/src/ui/palette.ts` içindedir (şeftali/teracotta, koyu kahve metin; koyu tema ayrı); `palette.test.ts` metin ve düğme kontrastını (WCAG AA) sınar.
Başlıklar serif, gövde sistem sans'ıdır (`theme.ts`).

### Şema ve tip üretimi

Belge modeli tek doğruluk kaynağıdır (`backend/src/folume/model.py`). Değiştirince:

```bash
make schema                    # backend/schema/*.json
cd mobile && npm run gen:types # mobile/src/core/types.generated.ts, ai/types.generated.ts
```

`mobile/src/core/schema.test.ts` JSON Schema'yı gerçek ayrıştırıcı çıktısına karşı doğrular; model ile TS tipleri ayrışırsa test düşer.
Okuyucu runtime'ını (`mobile/reader/src`) değiştirince `npm run build:reader` ile `readerHtml.generated.ts` yeniden üretilir.

## Depo yapısı

```text
backend/
  src/folume/
    model.py            belge modeli v1 (Pydantic)
    parsing/            PDF → bloklar (raw, furniture, regions, layout, structure, tables, refs, quality, audit, render, pipeline)
    fetch.py            bağlantı çözümleyici ve güvenli indirici (SSRF korumalı)
    ai/                 LLM geçidi (istemler, atıf doğrulama, çevrimdışı yedek, sağlayıcılar)
    routes/             documents · ai · sync
    jobs.py             iş yöneticisi (süreç yalıtımı, zaman aşımı, TTL)
    sync_store.py       kayıt tabanlı senkron deposu (SQLite)
  synth/                sentetik makale üreticileri (reportlab, LibreOffice/DOCX, Chromium/HTML)
  evals/                ölçüm harness'ı
mobile/
  src/app/              ekranlar (expo-router): kütüphane, okuyucu, rapor, notlar, quiz, arama, tekrar, bağlantılar, veri, ayarlar
  src/core/             saf TypeScript: belge modeli, retrieval, kavramlar, bağlantılar, arama, SM-2, kayıt tipleri,
                        completeness (harf sayımı), find (makalede bul), link, export/ (EPUB, HTML, Markdown, TXT, zip)
  src/data/             yerel depolar (KV, blob, kütüphane, notlar, kartlar, kayıt birleştirme, yedek)
  src/services/         API istemcisi, içe aktarma, bilgi servisi, senkron motoru
  reader/               WebView/iframe içinde çalışan okuyucu runtime'ı (esbuild ile tek HTML)
e2e/                    Playwright betikleri
docs/                   ROADMAP · ARCHITECTURE · EVALUATION · DEVELOPMENT
```

## Sunucu ayarları (ortam değişkenleri)

| Değişken | Varsayılan | Anlamı |
|---|---|---|
| `FOLUME_API_KEY` | — | Tanımlıysa tüm `/v1` uçları `X-API-Key` ister |
| `FOLUME_MAX_UPLOAD_MB` / `FOLUME_MAX_PAGES` | 50 / 300 | Yükleme sınırları |
| `FOLUME_JOB_TTL_SECONDS` | 3600 | Sonuç dosyalarının ömrü (istemci indirince silinir) |
| `FOLUME_WORKERS` / `FOLUME_MAX_QUEUED_JOBS` | 2 / 16 | Eşzamanlı dönüşüm / kuyruk sınırı |
| `FOLUME_ISOLATE_JOBS` | 1 | Her dönüşüm ayrı süreçte çalışır |
| `FOLUME_JOB_TIMEOUT_SECONDS` | 300 | Dönüşüm zaman aşımı |
| `FOLUME_MAX_MEMORY_MB` | 4096 | Dönüşüm sürecinin adres alanı sınırı (0 = sınırsız) |
| `FOLUME_DATA_DIR` | sistem geçici dizini | Geçici iş dizinleri (açılışta temizlenir) |
| `FOLUME_CORS_ORIGINS` | — | Virgülle ayrılmış izinli kökenler (yalnızca web istemcisi için) |
| `FOLUME_LLM_BASE_URL` / `FOLUME_LLM_MODEL` / `FOLUME_LLM_API_KEY` | — | OpenAI uyumlu sağlayıcı; yoksa AI uçları yalnızca “kaynak pasajları” yedeğiyle yanıt verir |
| `FOLUME_LLM_VISION`, `FOLUME_LLM_TIMEOUT_SECONDS` | 0, 60 | Görsel girdiyi destekliyor mu, istek zaman aşımı |
| `FOLUME_AI_RATE_LIMIT` | 40 | İstemci başına dakikada AI isteği |
| `FOLUME_URL_IMPORT` | 1 | Bağlantıdan içe aktarma (`POST /v1/documents/from-url`) açık mı |
| `FOLUME_ALLOW_PRIVATE_URLS` | 0 | 1 ise sunucu özel/yerel adreslerden de indirir (**yalnızca yerel test**; kapalıyken SSRF koruması vardır) |
| `FOLUME_URL_TIMEOUT_SECONDS` | 60 | İndirme zaman aşımı |
| `FOLUME_SYNC_ENABLED` / `FOLUME_SYNC_DB` | 0 / `var/sync.sqlite3` | İsteğe bağlı senkron ve SQLite dosyası |

## Dağıtım

```bash
docker build -t folume-api backend
docker run -p 8000:8000 -e FOLUME_API_KEY=... -v folume-data:/data folume-api
```

> `backend/Dockerfile` bu geliştirme ortamında **derlenemedi** (Docker daemon yok); yayına almadan önce bir kez derleyip
> `GET /v1/health` ile deneyin.

Dikkat edilecekler:

- API'yi internete açıyorsanız TLS arkasında çalıştırın ve `FOLUME_API_KEY` tanımlayın. Anahtar, mobil uygulamada güvenli depolamada (`expo-secure-store`) tutulur.
- Sunucu PDF'leri **diske yazmaz**; yalnızca sonuç dosyaları geçici iş dizinine yazılır ve istemci indirince ya da TTL dolunca silinir.
  İstek gövdeleri ve belge metni günlüklere girmez.
- AI için gönderilen pasajlar kullanıcı onayından geçer; sunucu bunları saklamaz. Sağlayıcınızın kendi saklama/eğitim politikası ayrıca değerlendirilmelidir.
- Senkron açıksa `FOLUME_SYNC_DB` dosyasını yedekleyin; kayıtlar düz metindir (PDF'ler ve makale metni yoktur: notlar, vurgular, okuma konumu, etiket, kart ve test sonuçları).

## Sorun giderme

- **Android emülatörü API'ye ulaşamıyor:** `localhost` yerine `http://10.0.2.2:8000` kullanın; gerçek cihazda bilgisayarın yerel IP'si.
- **Web'de CORS hatası:** API'de `FOLUME_CORS_ORIGINS=http://localhost:8081` (web istemcisinin kökeni).
- **“Taranmış görünüyor” uyarısı:** PDF'in metin katmanı yok; OCR bu sürümün kapsamında değildir.
- **Dönüşüm `timeout`/`too_complex` ile bitiyor:** PDF çok büyük ya da karmaşık; `FOLUME_JOB_TIMEOUT_SECONDS` / `FOLUME_MAX_MEMORY_MB` değerlerini yükseltin veya dosyayı bölün.
