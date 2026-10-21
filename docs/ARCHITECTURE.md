# Mimari

```text
┌────────────────────────── Mobil uygulama (Expo / React Native) ──────────────────────────┐
│  Kütüphane · Okuyucu (WebView/iframe runtime) · Orijinal görünüm · Learn · Notlar · Tekrar │
│  Yerel depo: KV (ayarlar, kütüphane, notlar, kartlar)  +  Blob (belge JSON, sayfa/şekil     │
│  görüntüleri, orijinal PDF)                                                                │
│  İstemci tarafı: BM25 retrieval, kavram çıkarımı, SM-2, dışa aktarma, senkron birleştirme   │
└───────────────┬───────────────────────────────┬───────────────────────────┬──────────────┘
                │ PDF yükle / sonucu indir      │ seçilmiş pasajlar (izinle) │ değişiklik kayıtları
                ▼                               ▼                           ▼  (opsiyonel)
┌─────────── FastAPI ────────────────────────────────────────────────────────────────────────┐
│  /v1/documents + /v1/jobs   PDF → yapılandırılmış belge (durumsuz, TTL'li geçici iş dizini) │
│  /v1/ai/*                   LLM geçidi: istem + atıf doğrulama; içerik saklanmaz            │
│  /v1/sync/*                 Anahtar tabanlı kayıt senkronu (SQLite), varsayılan kapalı      │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Temel kararlar

| Karar | Gerekçe |
|---|---|
| **Sunucu durumsuz, veri yerel-öncelikli.** İş dizini indirilince veya TTL (varsayılan 1 saat) sonunda silinir. | README'deki "ilk aşamada yerel depolama" + gizlilik ilkesi. Sunucuda kalıcı PDF/belge deposu yok. |
| **Belge modeli = bloklar + kaynak bölgeleri (sayfa, bbox).** Pydantic → JSON Schema → TS tipleri. | "Her bloğu orijinal konumla ilişkilendir" hedefi; tek doğruluk kaynağı. |
| **Sayfa görüntüleri pakete dahil** (JPEG, 2×). Orijinal görünüm bu görüntüler + bbox ile çizilir. | Cihazda PDF render modülü (native, Expo Go dışı) gerektirmez; web'de de çalışır. Seçilebilir metin yerine sadakat. |
| **Şekil / tablo / denklem kırpıntıları sayfa render'ından üretilir** (denklemler şeffaf PNG). | Sadakatli sunum; PDF'de formül LaTeX olmadığı için görüntü + yaklaşık metin birlikte verilir. |
| **Ayrıştırma: `pdfplumber` (MIT) + `pypdfium2` (Apache/BSD).** PyMuPDF kullanılmaz. | PyMuPDF AGPL-3.0'dır; kapalı kaynak kurumsal backend'de lisans riski. Docling, arayüz arkasında ileride takılabilir. |
| **Okuyucu = WebView'da çalışan TypeScript runtime** (web'de iframe). | Gerçek metin seçimi (DOM Range) → kaynağa bağlı vurgu/not/açıklama; tipografi üzerinde tam kontrol; Chromium'da test edilebilir. |
| **Retrieval istemcide (BM25)**; sunucuya yalnızca kullanıcının onayladığı pasajlar gider. | Gizlilik: tüm belge asla AI servisine gitmez; gönderilecekler önizlemede listelenir. |
| **LLM sağlayıcısı soyut.** OpenAI uyumlu HTTP istemcisi + AI'sız "extractive" yedek. | Herhangi bir sağlayıcıya/yerel modele bağlanabilir; AI kapalıyken de ürün çalışır. |
| **Senkron kayıt-bazlıdır**: `(koleksiyon, id, updated_at, deleted, payload)`; son-yazan-kazanır. | Hesap sistemi gerektirmeden cihazlar arası senkron; PDF'ler varsayılan olarak dışarıda. |

## Belge paketi (sunucu → istemci)

```text
GET /v1/jobs/{id}/document        → document.json      (Document, bkz. schema/document.schema.json)
GET /v1/jobs/{id}/assets/pages/p001.jpg
GET /v1/jobs/{id}/assets/figures/f0003.png
GET /v1/jobs/{id}/assets/equations/e0007.png
GET /v1/jobs/{id}/assets/tables/t0002.png
```

İstemci tüm dosyaları indirir, yerelde saklar, ardından `DELETE /v1/jobs/{id}` çağırır.

## Ayrıştırma hattı

```text
PDF bytes
 → raw.py        karakterler (font, boyut, bbox), çizgiler/dikdörtgenler/eğriler, gömülü görüntüler
 → furniture.py  tekrarlayan üst/alt bilgi + sayfa numarası  → "omitted" defteri
 → regions.py    şekil (raster + vektör kümeleri), tablo adayları, görüntü denklemleri → nesneler
 → layout.py     satır parçaları → sütun (gutter) tespiti → okuma sırası (tam genişlik öğeler bantları böler)
 → structure.py  başlık / paragraf / liste / dipnot / altyazı; sütun ve sayfa sürekliliği; tireleme
 → refs.py       kaynakça girdileri; metin içi atıfları girdilere bağlama
 → quality.py    blok güveni, bayraklar, sayfa düzeni güveni, metin defteri, genel not
 → render.py     sayfa görüntüleri + kırpıntılar
 → Document + assets
```

## Güvenlik ve gizlilik özeti

- API anahtarı (`FOLUME_API_KEY`) tanımlıysa tüm `/v1` uçları `X-API-Key` ister.
- Yükleme sınırları: boyut, sayfa sayısı, `%PDF` imzası; işlem zaman aşımı.
- AI geçidi içerik loglamaz; istek gövdeleri hata günlüklerine yazılmaz.
- Mobil istemci: AI ve görsel paylaşımı ayrı anahtarlar, varsayılan **kapalı**; ilk kullanımda açık onay.
