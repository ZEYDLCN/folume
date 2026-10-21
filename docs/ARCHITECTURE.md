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
 → audit.py      eksiksizlik denetimi: PDF metin katmanı ile belge arasında harf/rakam çok kümesi karşılaştırması
 → render.py     sayfa görüntüleri + kırpıntılar
 → Document + assets
```

## Eksiksizlik denetimi

Karşılaştırma birimi, Unicode NFKC sonrası harf ve rakamdır (büyük/küçük harf korunur). Boşluk, satır sonu, tire ve noktalama düzen sayılır
(tireleme onarımı bir tireyi kaldırabilir; “ﬁ” ligatürü ile “fi” aynı metindir). Çok kümesi karşılaştırması sıralama oyunlarıyla sağlanamaz.

- **Referans:** görünür karakterler + görünmez (< 0,5 pt) + üst üste basılmış kopyalar (sahte kalın). Son ikisi belgeye girmez ama sayılır ve raporlanır.
- **Çıktı tarafı:** `prefix + text + inner_text` (her blok) + atlanan üst/alt bilginin metni (`OmittedRegion.text`).
- **Kayıp yok:** bloklara yerleşmeyen karakterler `text_recovered` bayraklı bloklara geri konur; denetim yine de eksik/fazla harf bulursa `quality.completeness.problems` farkı bloğa (kaynak bbox'larıyla) atfeder.
- **Bağımsız doğrulama:** testlerde belgenin harfleri pdfium'un okuduğu harflerle karşılaştırılır; denetimin kendisi de bozulmuş belgeyle sınanır (silinen metin yakalanır).
- Taranmış PDF'de (metin katmanı yok) `complete=false` döner; “tamamdır” denmez.

## Bağlantıdan içe aktarma

```text
istemci → POST /v1/documents/from-url {url}  →  iş (job)  →  çözümleyici → indirici → (açılış sayfasıysa citation_pdf_url) → dönüştürücü
```

- `fetch.resolve_source`: arXiv (`abs/pdf/numara`), DOI (`10.x/...`, `doi:` öneki), OpenReview, ACL Anthology, bioRxiv/medRxiv ve düz bağlantılar PDF adaylarına çevrilir.
- `Fetcher`: yalnızca `http(s)`; ad çözülür, **yalnızca herkese açık IP'lere** bağlanılır (özel, döngü, bağlantı-yerel, bulut meta veri adresleri reddedilir), bağlantı çözülen IP'ye sabitlenir (Host/SNI korunur),
  her yönlendirme yeniden doğrulanır, boyut ve süre sınırı vardır, hata iletileri adresi yankılamaz. Yerel test için `FOLUME_ALLOW_PRIVATE_URLS=1`.
- Sunucu yine hiçbir şey saklamaz: indirilen PDF bellekte dönüştürülür, sonuç istemci indirince silinir.

## Okuma biçimleri (okuyucu runtime'ı)

İki bağımsız eksen: **düzen** (`book` | `magazine`, CSS sınıfı) ve **akış** (`scroll` | `paged`). Sayfa sayfa akışta `#book` bir CSS sütun satırıdır (her ekran bir sütun),
çevirme `scrollLeft` ile yapılır; konum bir blok çapasıyla taşınır, bu yüzden punto, düzen ve akış değişince kaldığın yer korunur. Orijinal görünüm sayfa görüntüleridir.
Metin seçimi, vurgu ve bulma işaretleri DOM Range ile çalıştığından her biçimde aynıdır; blok metni her biçimde aynıdır (testle sabitlenmiştir).

## Biçim dönüştürme (dışa aktarma)

Cihazda, saf TypeScript'te (`mobile/src/core/export`): `paperShared` (okuma sırası, başlık→bölüm, altyazı bağlama, güvenli metin), `paperHtml` (XHTML üretimi; HTML ve EPUB aynı işaretlemeyi kullanır),
`paperEpub` (EPUB 3: `mimetype` ilk ve sıkıştırmasız, `container.xml`, OPF, nav + sayfa listesi, bölüm başına XHTML, resimler), `paperMarkdown` (Markdown + düz metin), `zip` (CRC32'li saklamalı ZIP yazıcı/okuyucu).

- Çıktı **eksiksizdir**: aynı harf çok kümesi; ürünün eklediği sözcükler (daralan şekil metni etiketi, “çıkarılanlar” başlığı) `chrome` olarak bildirilir ve testte fazlalığı tam açıklamalıdır.
- Sayfa sınırları metin eklemeden işaretlenir (`doc-pagebreak`, EPUB sayfa listesi, Markdown yorumu). Denklemler resim + `alt` metni; şekil içi yazı `<details>` içinde.
- Güvenlik: XML'de geçersiz karakterler atılır (harf değildir), tüm metin kaçışlanır, yalnızca `http(s)`/`mailto` bağlantıları yazılır, betik yoktur.

## Bilgi katmanı (istemci)

Tamamı cihazda, saf TypeScript'te (`mobile/src/core`):

- **Kavramlar** (`knowledge/concepts.ts`): tanımlı kısaltmalar (“Large Language Model (LLM)”), açık tanımlar (“We define X as…”), vurgulu terimler,
  anahtar sözcükler, başlıklar ve sık geçen isim öbekleri. Her kavram tanım cümlesini, kaynak bloğunu ve sayfasını taşır; hiçbir şey uydurulmaz.
- **Bağlantılar** (`knowledge/connections.ts`): iki makalenin ortak kavramları (kısaltma uzun biçimiyle eşleşir). İlişki yalnızca makalelerin
  kendi söylediğinden çıkar: *ortak*, *tamamlayıcı* (yalnızca biri tanımlıyor), *ikisi de tanımlıyor*. “Çelişiyor mu?” sorusu yalnızca kullanıcı isterse,
  iki makaleden seçilen pasajlarla ve kaynak doğrulamalı AI karşılaştırmasıyla yanıtlanır.
- **Arama** (`knowledge/search.ts`): tüm makaleler üzerinde BM25; sonuç blok ve sayfaya götürür.
- **Aralıklı tekrar** (`learning/srs.ts`): SM-2; kaçırılan sorular ve tanımlı kavramlar kart olur, kartın arkası yazarın cümlesidir ve kaynağa bağlıdır.
- **Dışa aktarma** (`export/`): BibTeX, RIS, CSL-JSON (PDF yayın yerini söylemiyorsa `@misc`; alan uydurulmaz), makalenin kendi kaynakçası, Markdown notlar.

## Kayıtlar, yedek ve senkron

Kullanıcıya ait her şey (notlar, vurgular, okuma durumu, test sonuçları, tekrar kartları, etiketler) anahtarlı **kayıt**tır:

```text
ann/{docId}/{id}   state/{docId}   quiz/{docId}/{id}   card/{docId}/{id}   tags/{docId}
{ key, updatedAt, deleted, data }
```

`docId`, PDF'nin SHA-256 özetinin ilk 16 karakteridir; aynı PDF her cihazda aynı kimliği alır, bu yüzden notlar yeniden içe aktarılan makaleye kendiliğinden oturur.

- **Birleştirme** (`data/records.ts`): kayıt başına son yazan kazanır; silmeler “mezar taşı” olarak taşınır; yeni bir düzenleme eski bir silmeyi geçer, eski bir kopya silineni geri getirmez.
  Dışarıdan gelen her kayıt anahtarı, şekli ve içindeki kimliklerle doğrulanır; geçersizler hiç yazılmaz.
- **Yedek**: aynı kayıtların JSON dosyası (ayarlar, API/senkron anahtarı ve PDF'ler yoktur). Geri yükleme cihazdaki daha yeni işi ezmez.
- **Senkron** (`services/syncEngine.ts`, `routes/sync.py`): önce çek, birleştir, sonra değişenleri gönder. İstemci anahtardan `sha256("folume-sync-v1:" + anahtar)` türetir;
  sunucu yalnızca bu özeti görür (ad alanı). Sunucu kayıtları anlamsız JSON olarak saklar, sıra numarası (`seq`) verir, gelecek tarihli (> 5 dk) saatleri kırpar,
  boyut/adet sınırı uygular ve içerik yankılamaz. Varsayılan **kapalı**; PDF'ler ve makale metni senkronlanmaz.
  Bir makaleyi cihazdan silmek notlarını diğer cihazlardan silmez (“burada sil”).

## Dönüşüm süreçleri

Sunucudaki her dönüşüm ayrı bir süreçte (`forkserver`) çalışır: ana süreç PDF baytlarını bir boruyla gönderir, ilerlemeyi borudan okur,
çocuk sonuçları geçici iş dizinine yazar. Zaman aşımında ya da bellek sınırı aşıldığında süreç öldürülür, iş `timeout`/`too_complex` ile başarısız olur,
dizin temizlenir ve sunucu etkilenmez. PDF diske yazılmaz.

## Güvenlik ve gizlilik özeti

- API anahtarı (`FOLUME_API_KEY`) tanımlıysa tüm `/v1` uçları `X-API-Key` ister.
- Yükleme sınırları: boyut, sayfa sayısı, sayfa boyutu, `%PDF` imzası; dönüşüm başına süreç yalıtımı, zaman aşımı ve bellek sınırı.
- AI geçidi içerik loglamaz; istek gövdeleri hata günlüklerine yazılmaz.
- Mobil istemci: AI ve görsel paylaşımı ayrı anahtarlar, varsayılan **kapalı**; ilk kullanımda açık onay.
