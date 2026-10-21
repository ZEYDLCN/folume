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

## 3. Kapsam dışı (bilinçli)

- OCR (taranmış PDF'ler algılanır ve açıkça "desteklenmiyor" diye işaretlenir; sessizce boş belge üretilmez).
- LaTeX üretimi (denklemler görüntü + yaklaşık metin olarak sunulur; hata yerine "yaklaşık" bayrağı).
- Üç ve daha fazla sütunlu düzenlerde güvenilir okuma sırası (sayfa "düzen belirsiz" diye işaretlenir).
- Hesap/oturum sistemi (senkron yalnızca anahtar tabanlıdır).
