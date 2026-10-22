# Geliştirme planı

Bu belge README'deki ürün tanımının mühendislik karşılığını ve geliştirmenin faz planını içerir.
Mimari kararlar için bkz. [ARCHITECTURE.md](ARCHITECTURE.md).

## Durum

| Faz | Durum | Not |
|---|---|---|
| 0 — Temel ve plan | ✅ tamamlandı | Monorepo, belge modeli v1, araçlar |
| 1 — Reading MVP | ✅ uygulandı, sentetik/araç üretimli PDF'lerle doğrulandı | Gerçek makale ve cihaz denemesi **yapılmadı** (bkz. EVALUATION.md) |
| 2 — Learning Layer | ✅ uygulandı, sahte LLM ile doğrulandı | Gerçek model denemesi **yapılmadı** |
| 3 — Knowledge Workspace | ✅ uygulandı, iki “cihaz” + gerçek API ile doğrulandı | Kurallı kavram çıkarımı gerçek makalelerde sınanmadı |
| 4 — Sertleştirme | ✅ tamamlandı | Bağımsız PDF üreticileri, süreç yalıtımı, belgeler |
| 5 — Eksiksizlik kanıtı | ✅ uygulandı, bağımsız PDF motoruyla doğrulandı | Gerçek makalelerde denenmedi |
| 6 — Linkle içe aktarma | ✅ uygulandı, yerel test sitesiyle doğrulandı | Gerçek arXiv/yayıncı sitelerinde denenmedi |
| 7 — Okuma biçimleri | ✅ uygulandı (Kitap, Dergi, sayfa sayfa, Orijinal), Chromium'da doğrulandı | Cihaz WebView'ında denenmedi |
| 8 — Biçim dönüştürme | ✅ uygulandı (EPUB, HTML, Markdown, TXT), pandoc ve tarayıcıyla doğrulandı | EPUB gerçek e-okuyucularda denenmedi |
| 9 — Kullanım rahatlığı ve hız | ✅ uygulandı (makalede bul, devam et, kalan süre, odak modu; dönüştürücü ≈ %30 hızlandı) | Cihazda ölçülmedi |
| 10 — Tasarım ve marka | ✅ uygulandı (sıcak editoryal tema, serif başlıklar, logo, uygulama simgeleri) | Cihazda görülmedi; Figma erişilemedi, tasarım verilen görselden kuruldu |
| 11 — Okurken | ✅ uygulandı (önizleme, terim, atıfla alıntı, sesli okuma, erişilebilirlik, düzeltme, geri bildirim, kalem, not paylaşımı) | Sesli okuma cihaz seslerinde, kalem gerçek kalemle denenmedi |
| 12 — Araştırma çalışma alanı | ✅ uygulandı (okuma listesi, BibTeX/RIS içe aktarma, projeler ve literatür tablosu, kütüphaneye soru, arXiv takibi) | arXiv takibi gerçek arXiv'e karşı, “soru” gerçek modelle denenmedi |
| 13 — Dışa aktarma ve entegrasyon | ✅ uygulandı (tablo CSV/Excel, Obsidian, Anki, Readwise, işaretli PDF) | Gerçek Obsidian/Anki/Readwise'a aktarılmadı; PDF vurgu konumları tahmin |
| 14 — Folume'a gönder | ✅ uygulandı (PWA paylaşım hedefi, tarayıcı eklentisi, yer imi, derin bağlantı) | Eklenti gerçek tarayıcıya yüklenmedi; yerel paylaşım menüsü denenmedi |
| 15 — İsteğe bağlı OCR | ✅ uygulandı (`FOLUME_OCR=1`), gerçek motorla sınandı | Türkçe karakterler zayıf; sonuç asla “eksiksiz” denmez |

Bilinçli olarak yapılmayanlar ve açık riskler: bu belgenin sonundaki “Kapsam dışı” ve [EVALUATION.md](EVALUATION.md) §4.

## 1. Ürünün özü (ve mühendislik gereksinimleri)

Ürün bir "PDF okuyucu" ya da "AI özetleyici" değil. İddia şu: **makalenin kendisi merkezde kalır,
mobilde rahat okunur hâle gelir, anlamak için gereken yardım makaleden ayrılmadan, kaynağı gösterilerek gelir.**
README'deki beş ilke, doğrudan sınanabilir mühendislik değişmezlerine (invariant) çevrilir:

| İlke | Değişmez | Nasıl zorlanır / sınanır |
|---|---|---|
| Önce kaynak, sonra AI | Her içerik bloğunun en az bir `(sayfa, bbox)` kaynağı vardır. AI cevabı yalnızca kendisine verilen pasaj kimliklerine atıf yapabilir; atıf yoksa cevap "kaynaksız" etiketlenir. AI metni arayüzde hiçbir zaman kaynak metinle aynı görsel katmanda durmaz. | Şema doğrulaması; `ai/grounding.py` atıf doğrulayıcısı ve testleri; UI'da ayrı "Kaynak metin" / "AI yorumu" kartları. |
| Eksikliği gizleme | PDF metin katmanındaki **her karakter** ya bir blokta, ya şekil/tablo içinde, ya da açıklamalı bir kategoride (tekrarlayan üst/alt bilgi, atlanan bölge) hesaplanır: *metin defteri (text ledger)*. Belirsiz bloklar bayrak taşır; yapı güvenilir değilse orijinal görüntü gösterilir. | `quality.py` defter invariantı (testlerde ≥ %99 hesaplanmış karakter); dönüşüm raporu ekranı; blok rozetleri. |
| Okuma akışını bozma | AI kapalıyken okuma, yer imi, vurgu, not, kütüphane ve tekrar çalışır. AI hiçbir yerde otomatik tetiklenmez. | AI yokken (sunucuda sağlayıcı yok / istemcide kapalı) tüm okuma yolu testleri. |
| Öğrenme ≠ özet | Kavrama soruları, aralıklı tekrar ve kavram bağlantıları vardır; ürün "öğrendin" garantisi vermez. | Quiz şeması (kaynak pasaj zorunlu), SM-2 zamanlayıcı testleri. |
| Kullanıcı kontrolü ve gizlilik | Sunucu PDF'yi kalıcı saklamaz (indirilince ya da TTL sonunda silinir). Veri yerel-öncelikli saklanır. AI'ya giden her pasaj, gönderimden önce kullanıcıya listelenir. Senkronizasyon ve görsel paylaşımı varsayılan **kapalı**. | Job TTL/purge testleri; gönderim önizleme ekranı; ayarlarda ayrı anahtarlar. |

### Doğrulanabilirlik sınırları (dürüstlük notu)

Bu geliştirme ortamında **gerçek akademik PDF'ler yoktur** (arXiv/HuggingFace erişilemiyor), LaTeX yoktur ve cihaz/emülatör yoktur.
Bu nedenle:

- Ayrıştırıcı, gerçek LaTeX/Word çıktılarına benzeyecek biçimde üretilmiş **sentetik** çift/tek sütunlu makalelerle (bilinen doğru yapıyla)
  ölçülür. Sentetik üreticinin kendi yanlılığını azaltmak için ayrıca iki **bağımsız üretici** kullanılır: LibreOffice (DOCX → PDF) ve
  Chromium (HTML/MathML → PDF). Gerçek dünya kalitesi README'nin de söylediği gibi küçük bir gerçek PDF setiyle ayrıca doğrulanmalıdır (bkz. `docs/EVALUATION.md`).
- Mobil arayüz, Expo web derlemesi + Chromium ile uçtan uca çalıştırılıp doğrulanır; iOS/Android cihaz denemesi yapılamamıştır.
- LLM çağrıları gerçek bir sağlayıcıya karşı denenemez; sağlayıcı soyutlaması sahte (fake) HTTP sunucusuna karşı sınanır.
- Docling dönüştürücüsü, model ağırlıkları indirilemediği için burada çalıştırılamaz; ayrıştırıcı arayüzü onu ileride takmaya uygun tutulur.

## 2. Faz planı

Her faz sonunda: testler yeşil, tip kontrolleri temiz, README onay kutuları yalnızca **gerçekten uygulanıp doğrulanan** maddeler için işaretlenir.

### Faz 0 — Temel ve plan
- Monorepo: `backend/` (Python + FastAPI), `mobile/` (Expo + TypeScript), `docs/`.
- Belge modeli v1 (Pydantic → JSON Schema → TypeScript tipleri; tek doğruluk kaynağı backend).
- Geliştirici araçları: `Makefile`, lint/test komutları, `.gitignore`.

### Faz 1 — Reading MVP (README Faz 1)

**1A — Backend ayrıştırma ve API**
1. Ham çıkarım katmanı: `pdfplumber` karakterleri + `pypdfium2` render (izinli lisanslar; PyMuPDF AGPL olduğu için kullanılmaz).
2. Sayfa düzeni: tekrarlayan üst/alt bilgi ayıklama, sütun (gutter) tespiti, XY-cut benzeri okuma sırası, tam genişlik öğeler.
3. Yapı: başlık hiyerarşisi (numara + punto + kalın), paragraf/liste birleştirme, sütun/sayfa sürekliliği, tireleme onarımı, ligatür normalizasyonu.
4. Özel öğeler: şekil (raster + vektör kümeleme) ve başlıkları; tablo (yapı güvenilirliği + görüntü yedeği); görüntü denklemleri ve satır içi matematik; dipnotlar.
5. Atıflar ve kaynakça: kaynakça girdileri, numaralı ve yazar-yıl atıflarının girdilere bağlanması.
6. Kalite: blok güvenilirliği, bayraklar, sayfa düzeni güveni, **metin defteri**, taranmış/OCR'sız PDF tespiti.
7. API: iş (job) tabanlı yükleme/izleme/indirme/silme, boyut-sayfa sınırları, isteğe bağlı API anahtarı, TTL temizliği.
8. Sentetik külliyat üretici + değerlendirme harness'ı (metin geri çağırma, okuma sırası, tür tespiti, kaynağa dönüş IoU).

**1B — Mobil okuyucu**
1. Expo + expo-router iskeleti, tema, i18n (tr/en), ayar deposu.
2. Yerel depolama soyutlaması (KV + blob; native, web, bellek gerçeklemeleri) ve kütüphane indeksi.
3. İçe aktarma akışı: dosya seç → yükle → ilerleme → indir → yerelde sakla → sunucudaki işi sil.
4. Okuyucu runtime'ı (WebView / web'de iframe): Book View tipografisi, tema/punto/satır aralığı/yazı tipi, şekil/tablo/denklem görüntüleri (tembel yüklenir), atıf ve kaynakça bağlantıları, bayrak rozetleri.
5. Original ↔ Book: bloktan orijinal sayfa görüntüsüne (kaynak bbox vurgulu) ve geri geçiş.
6. Okuma ilerlemesi (blok çapası + yüzde), yer imleri, içindekiler.
7. Dönüşüm raporu ekranı (neyin, neden işaretlendiği; atlanan bölgeler).

### Faz 2 — Learning Layer (README Faz 2)
1. Backend AI geçidi: sağlayıcı soyutlaması (OpenAI uyumlu HTTP + çevrimdışı "extractive" yedek), istem şablonları, atıf doğrulama, içerik loglamama.
2. İstemci tarafı retrieval (BM25, Türkçe/İngilizce tokenizasyon): seçili pasaj + bağlam + ilgili pasajlar; gönderim önizlemesi ve onay.
3. Learn paneli: bağlamsal açıklama, "bu bölümde neden önemli?", terim/formül açıklaması, çeviri, düzey seçenekleri; kaynak çipleri → bloğa git / orijinale git.
4. Figure & Equation Companion: şekil/denklem görüntüsü (izinle) + başlık + atıf yapan paragraflar ile adım adım açıklama.
5. Smart Notes: seçime dayalı vurgu (blok + karakter aralığı + alıntı), not, etiket; kaynak konumu; Markdown dışa aktarma.
6. Understanding Check: bölüm sonu soruları (kavrayış odaklı, kaynak pasajlı); AI yoksa kural tabanlı boşluk-doldurma yedeği; sonuç kaydı.

### Faz 3 — Knowledge Workspace (README Faz 3)
1. Kütüphane: liste, arama (tam metin), etiket, okuma durumu, silme.
2. Kavram çıkarımı (terim/kısaltma/tanım) ve makaleler arası bağlantılar (ortak / tamamlayıcı); "çelişen" için isteğe bağlı AI karşılaştırma.
3. Aralıklı tekrar: SM-2, kavram ve kaçırılan soru kartları, günlük tekrar ekranı.
4. Dışa aktarma: BibTeX, RIS, CSL-JSON, Markdown notları, tam yedek (JSON); DOI/üst veri çıkarımı.
5. İsteğe bağlı senkronizasyon: kendi sunucunda, anahtar tabanlı, kayıt-bazlı son-yazan-kazanır birleştirme; PDF'ler varsayılan olarak senkronlanmaz.

### Faz 4 — Sertleştirme (yapıldı)
- Uçtan uca web akışları (Playwright, dört betik), performans notları (EVALUATION.md §3).
- Bağımsız PDF üreticileri (LibreOffice, Chromium) ile ayrıştırıcıda bulunan ve düzeltilen hatalar (EVALUATION.md §2.2).
- Sunucu: her dönüşüm ayrı süreçte, zaman aşımı + bellek sınırı + aşırı büyük sayfa reddi; Dockerfile ve CI iş akışı.
- Android/iOS paketleme denemesi (derleniyor; cihazda çalıştırılmadı), kullanılamayan ağ nedeniyle gerçek makale denemesi yapılamadı.
- `docs/EVALUATION.md`: başarı ölçütlerinin hangileri otomatik ölçülüyor, hangileri kullanıcı testi gerektiriyor.
- README durumunun dürüst güncellenmesi, commit geçmişi taraması.

### Faz 5 — Eksiksizlik kanıtı
- `parsing/audit.py`: PDF metin katmanındaki harf ve rakamların (NFKC, büyük/küçük harf korunur) çok kümesi ile belgedeki (önek + metin + şekil/tablo içi metin + atlanan üst/alt bilgi) çok kümesi karşılaştırılır; fark `quality.completeness` olarak raporlanır, farkın yeri bloklara atfedilir.
- Metin kaybolmaz: bloğa yerleşmeyen karakterler `text_recovered` bayraklı bloklara döner; şekil/tablo içindeki yazı `inner_text` olarak seçilebilir kalır; tablo hücreleri harf kaybederse resim + metin gösterilir.
- Testler: motordan bağımsız doğrulama (pdfium), hasar tespiti (silinen metin raporlanır), 5 sentetik + 6 üretici PDF'i için sıfır eksik/fazla harf.

### Faz 6 — Linkle içe aktarma
- `POST /v1/documents/from-url`: arXiv numarası, DOI, OpenReview/ACL/bioRxiv bağlantıları ve genel PDF/açılış sayfası bağlantıları çözülür; sunucu indirir ve dönüştürür.
- SSRF koruması: yalnızca herkese açık IP'ler, IP sabitleme (Host/SNI korunur), her yönlendirme yeniden doğrulanır, boyut/süre sınırı, adres yankılanmaz.

### Faz 7 — Okuma biçimleri
- Düzen: Kitap | Dergi (CSS); akış: kaydırma | sayfa sayfa (CSS sütunlarından oluşan ekran dizisi, JS ile çevirme/yerleşme/çapalama); Orijinal sayfa görüntüleri.

### Faz 8 — Biçim dönüştürme
- Cihazda üretilir (`mobile/src/core/export/paper*.ts`): EPUB 3 (bölümler, içindekiler, sayfa listesi, resimler), tek dosya HTML, Markdown (+ ZIP), düz metin. Her biçim PDF metninin her harfini taşır; testler dosyaları XML ayrıştırıcı, markdown-it ve pandoc ile okuyup harf çok kümesini belgeyle karşılaştırır.

### Faz 9 — Kullanım rahatlığı ve hız
- Makalede bul, “Okumaya devam et” kartı, kalan süre, odak modu, ilerlemenin sayfa/uygulama kapanırken kaydedilmesi.
- Dönüştürücüde ikinci dereceden bir boyut hesabı kaldırıldı, parça metni bir kez hesaplanıyor (≈ %30, çıktı bayt bayt aynı). Hız bekçileri: dönüştürücü (`tests/test_performance.py`) ve 90 sayfalık makale için okuyucu bütçesi (`e2e/formats.mjs`).

### Faz 10 — Tasarım ve marka
- `mobile/src/ui/palette.ts` (şeftali/teracotta, koyu tema, WCAG AA kontrastı testli), serif başlıklar, krem yuvarlak kartlar, arama hapı, tarih çipli kütüphane, `Logo.tsx` + simgeler (`e2e/brand-assets.mjs`).

### Faz 11 — Okurken
- Şekil/tablo/denklem/kaynak önizlemesi ve “geri dön”, terim ve kısaltma açıklamaları, atıfla alıntı kopyalama, sesli okuma (cümle cümle, hız, durdur/sürdür), disleksi dostu yazı tipleri, aralık, okuma cetveli.
- Yanlış dönüşümü düzeltme (blok metni/türü/gizleme/birleştirme; PDF tarafı değişmez, düzeltmeler eşzamanlanır), “yanlış dönüşümü bildir” paketi, orijinal sayfaya kalem/fosforlu kalem notları, notları dosyayla paylaşma.

### Faz 12 — Araştırma çalışma alanı
- Okuma listesi: BibTeX/RIS/CSL-JSON içe aktarma, elle DOI/arXiv/başlık, “kütüphaneye ekle”, okundu işareti, okurken kaynakçadan listeye ekleme.
- Projeler ve literatür tablosu (`core/matrix.ts`): her makale bir satır, her soru bir sütun; hücre için makalenin **kendi cümlesi** sayfasıyla önerilir (uydurma yok); CSV/Excel/Markdown.
- Kütüphaneye soru (`/ask`): BM25 ile tüm makalelerden pasajlar, kaynak doğrulamalı AI yanıtı (gönderilecekler önizlenir); AI kapalıyken eşleşen pasajlar listelenir.
- arXiv takibi (`feed.py`, `/v1/feed/arxiv`): kategori ve/veya anahtar sözcük, “yeni” işareti, okuma listesine/kütüphaneye ekle; takip edilen konular senkronlanan `sub` kaydıdır.

### Faz 13 — Dışa aktarma ve entegrasyon
- `core/export/notebooks.ts`: Obsidian kasası (özellikler, sayfalı alıntılar, ilgili makalelere `[[bağlantılar]]`, kartlar), Anki (kararlı kimlikli TSV), Readwise CSV.
- `core/export/annotatedPdf.ts`: orijinal sayfa görüntüleri + gerçek PDF açıklamaları (vurgu, not, kalem) + bölümlerden yer imleri; pdfium ve poppler ile doğrulanır.

### Faz 14 — Folume'a gönder
- Web: manifest + `share_target` (GET) + hizmet işçisi; `?import=`/`?url=&text=&title=` ve `/import?url=` (derin bağlantı) kütüphanede ekleme penceresini hazır açar.
- `extension/` (MV3, yalnızca `activeTab`, `contextMenus`, `storage`) ve Ayarlar'dan kopyalanan yer imi.

### Faz 15 — İsteğe bağlı OCR
- `parsing/ocr.py` (RapidOCR/ONNX, `pip install -e ".[ocr]"`): metin katmanı olmayan PDF'ler sayfa görüntüsünden okunur; satırlar kutularına karakter karakter yayılır, başlıklardaki kaybolan boşluklar onarılır (harf eklenmez). `quality.ocr`, `completeness.source = "ocr"`, `ocr_text` uyarısı; not üst sınırı 0,84 (asla “iyi”).

## 3. Kapsam dışı (bilinçli)

- Makalenin tamamının Türkçe↔İngilizce yan yana çevirisi (istenmedi; seçili metin için çeviri vardır).
- OCR'de şekil/tablo algılama, sayfası yan dönmüş taramalar, metin ve tarama karışık PDF'ler (yalnızca neredeyse hiç metni olmayan PDF'ler OCR'lenir).
- LaTeX üretimi (denklemler görüntü + yaklaşık metin olarak sunulur; hata yerine "yaklaşık" bayrağı).
- Üç ve daha fazla sütunlu düzenlerde güvenilir okuma sırası (sayfa "düzen belirsiz" diye işaretlenir).
- Hesap/oturum sistemi (senkron yalnızca anahtar tabanlıdır).
