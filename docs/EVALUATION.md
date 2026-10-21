# Değerlendirme: neyi ölçüyoruz, neyi ölçemiyoruz

README'deki başarı ölçütleri özellik sayısı değil, gerçek okuma ve öğrenme deneyimi üzerine kurulu.
Bu belge her ölçütün **bu depoda otomatik olarak neyle ölçüldüğünü**, hangi sonucu verdiğini ve
**hangi kısmının ancak gerçek makaleler, gerçek cihazlar ve gerçek kullanıcılarla ölçülebileceğini** açıkça ayırır.
Otomatik sonuçlar yalnızca "ayrıştırıcı ve uygulama, bilinen doğru yapıya sahip girdilerde doğru davranıyor" der;
"ürün gerçek makalelerde iyi çalışıyor" demez.

## 1. README ölçütleri → ölçüm

| README ölçütü | Otomatik vekil (depoda) | Durum | Kullanıcı/gerçek veri gerektiren kısım |
|---|---|---|---|
| **Dönüşüm bütünlüğü** | Metin geri çağırma/kesinlik, tür bulma, tablo hücre doğruluğu, atıf bağlama, **metin defteri** ve **harf harf eksiksizlik denetimi** (bkz. §2.5) — `backend/evals`, `tests/test_parsing.py`, `tests/test_completeness.py` | Sentetik, LibreOffice ve Chromium PDF'lerinde ≥ %97; harf denetiminde 0 eksik / 0 fazla | Gerçek makalelerde (özellikle karmaşık formül, çok sütun, taranmış PDF) oran. **Ölçülmedi.** |
| **Kaynağa dönüş doğruluğu** | Her bloğun `(sayfa, bbox)` kaynağının gerçek konumla örtüşmesi (IoU / içerme); Original↔Book e2e testi | Sentetikte ortalama ≈ 0,99; e2e'de geçiş ve vurgulama doğrulandı | Gerçek makalelerde örtüşme; kullanıcıların "doğru yere gitti" algısı |
| **Okuma verimliliği** | — (vekil yok: ekran başına kaydırma/yakınlaştırma ölçülemez) | Ölçülmedi | Mobil cihazda yakınlaştırma ve yatay kaydırma sayımı, karşılaştırmalı okuma süresi |
| **Anlama kazanımı** | — Kavrama soruları ve tekrar kartları **üretilir ve kaydedilir**; kazanım ölçülmez | Ölçülmedi | Okuma sonrası test, kontrol grubu (mevcut PDF okuyucu) |
| **Kullanıcı tercihi** | — | Ölçülmedi | Yan yana kullanım çalışması |
| **Geri dönüş (2. ve 3. makale)** | Yerel analitik **yoktur** (gizlilik ilkesi); ölçüm kullanıcı görüşmesiyle yapılmalıdır | Ölçülmedi | Takip görüşmeleri / gönüllü kullanım günlüğü |

## 2. Otomatik ölçümler

### 2.1 Sentetik külliyat (`python -m evals.run`)

Üretici (`backend/synth`) IEEE/ACM/arXiv şablonlarında, TeX benzeri matematik yerleşimiyle, kodlu/dipnotlu/geniş şekilli
makaleler üretir ve doğru yapıyı (`truth.json`) birlikte yazar.

```text
document       text_recall text_precis reading_ord source_over source_over citation_re table_cell_  coverage
ieee_ml              1.000       0.999       1.000       0.991       1.000       1.000       1.000     1.000
acm_graph            1.000       0.999       1.000       0.994       1.000       1.000       1.000     1.000
arxiv_bio            1.000       1.000       1.000       0.995       1.000       1.000       1.000     1.000
ieee_math            1.000       0.999       1.000       0.992       1.000       1.000       1.000     1.000
ml_companion         1.000       0.999       1.000       0.996       1.000       1.000       1.000     1.000
```

**Bunun anlamı:** üretici ile ayrıştırıcı aynı kişi tarafından yazıldı; bu sonuçlar ayrıştırıcının *bildiği* düzenleri
doğru çözdüğünü gösterir ve gerileme yakalar. Gerçek dünyadaki başarıyı **kanıtlamaz**.

### 2.2 Bağımsız üreticiler: LibreOffice ve Chromium

Üreticiyle aynı kodu paylaşmayan iki PDF kaynağı eklendi; testler araç kurulu değilse atlanır:

- **LibreOffice** (`synth/docx_paper.py`, `tests/test_libreoffice.py`): gerçek iki sütunlu bölümler, tam ızgaralı tablolar, çalışan başlık ve sayfa numarası.
- **Chromium** (`synth/html_paper.py`, `tests/test_chromium.py`): CSS sütunları, gerçek MathML denklemleri, tarayıcının varsayılan sayfa üst/alt bilgisi (başlık, tarih, dosya yolu, sayfa x/y).

Bu üreticiler sentetik külliyatın yakalamadığı **gerçek hataları** ortaya çıkardı; hepsi düzeltildi ve testlere bağlandı:

| Bulgu | Düzeltme |
|---|---|
| Tam genişlikli paragrafın (özet) kısa son satırı, tek sütuna düştüğü için ayrı paragraf oldu | `continues_spanning` |
| Cümle sütun/sayfa sonunda sayı ya da virgülle devam edince (“… by” / “14%, …”) bölündü; girintili belgelerde yeni sütunun girintisiz ilk satırı önceki paragrafa eklenmedi | Devam kuralı, belgenin girinti biçimini öğrenir |
| Tam ızgaralı tablolarda sarılmış hücre metni satır sayısını bozdu; hücre hücre çizilen kenarlıklar ayrı tablolar saydı | Çizgilerden hücre çıkarımı; eşdoğrultulu çizgi parçalarını birleştirme |
| Ortalanmış altyazının ikinci satırı gövde metnine kaydı | Altyazı devamı kuralı |
| Uzun yinelenen alt bilgi (dosya URL'si) metnin ortasına sızdı | Yinelenen satırlar için daha geniş uzunluk sınırı |
| PDF “Author” alanı (`python-docx`) yazar listesi oldu; “Ad, Enstitü, Üniversite” satırında yazar kayboldu | Alan yalnızca kişi adı gibi görünüyorsa kullanılır; satır parça parça ayrıştırılır |

### 2.3 Uygulama testleri

| Katman | Komut | Kapsam |
|---|---|---|
| Backend | `make test-backend` | Model, ayrıştırma, API, iş izolasyonu (zaman aşımı/bellek/büyük sayfa), AI geçidi (sahte LLM), senkron |
| Mobil birim | `make test-mobile` | Belge modeli + şema sözleşmesi (ajv), kütüphane/not/kart depoları, import, BM25, kavram çıkarımı, bağlantılar, arama, SM-2, atıf/yedek dışa aktarma, kayıt birleştirme, senkron motoru |
| Okuyucu runtime | `e2e/reader-runtime.mjs` | Gerçek Chromium: tüm blok türleri, atıflar, Original↔Book, seçim/vurgu, tema |
| Okuma biçimleri | `e2e/formats.mjs` | Kitap/Dergi/sayfa sayfa: aynı metin, konum korunumu, seçim; 90 sayfalık makale için hız bütçesi |
| Dönüştürme | `e2e/export-flow.mjs` | Uygulamadan gerçek indirmeler; pandoc/tarayıcı/ZIP doğrulaması (`e2e/verify_exports.py`) |
| Linkle içe aktarma | `e2e/link-flow.mjs` | Yerel “yayıncı” sitesi: PDF, yönlendirme, açılış sayfası, hata iletileri, iç adres reddi |
| Uygulama akışı | `e2e/app-flow.mjs` | Gerçek API + web derlemesi: içe aktarma → okuma → ayarlar → silme |
| Öğrenme katmanı | `e2e/learn-flow.mjs` | Sahte OpenAI uyumlu model **HTTP üzerinden**: AI kapalıyken hiçbir şey gitmez, önizleme, kaynaklı/kaynaksız ayrımı, not, kavrama testi |
| Bilgi çalışma alanı | `e2e/knowledge-flow.mjs` | İki “cihaz” + gerçek API: arama, etiket, bağlantılar, AI karşılaştırma, tekrar, dışa aktarma, yedek, senkron, silme |

Android ve iOS için `expo export` (Hermes paketleme) başarıyla derlenir; bu **cihazda çalıştırmak değildir**.

### 2.5 Eksiksizlik ve biçim dönüştürme

**Metin katmanı eksiksizliği** (`tests/test_completeness.py`): belgenin harf/rakam çok kümesi PDF metin katmanıyla karşılaştırılır; sonuç `quality.completeness`.
Ayrıca pdfium (hiçbir kodu paylaşmayan bir motor) PDF'ten okunan harfleri verir; belgede eksik harf yoktur (yalnızca üst üste basılmış kopyalar sayılır).
Sonuç: 5 sentetik + LibreOffice (3) + Chromium (3) PDF'inde **0 eksik, 0 fazla harf**. Denetimin kendisi sınanır: bir paragrafın yarısını silmek ya da metin eklemek raporlanır;
bir satırı düşüren hat, karakterleri `text_recovered` bloğu olarak geri koyar.
**Sınır:** bu, PDF'in *metin katmanı* içindir. Metni eğriye çevrilmiş ya da tarama PDF'lerinde harf yoktur; bunlar “eksiksiz” denmez. Gerçek makalelerde denenmedi.

**Biçim dönüştürme** (`mobile/src/core/export/paper.test.ts`, `e2e/export-flow.mjs`): her biçim (EPUB, HTML, Markdown, TXT) × 3 fikstür × (çıkarılanlar bölümü açık/kapalı) × (resimli/resimsiz) için:
XML ayrıştırıcıyla (HTML ve EPUB iyi biçimli olmalı), markdown-it ile (Markdown) okunan harf çok kümesi belgeyle aynıdır; fazlalık yalnızca bildirilen etiketlerdir.
Tarayıcı senaryosu uygulamadan gerçek indirmeleri alır ve **pandoc** ile (EPUB/HTML/Markdown'ı kendi okuyucusuyla) geri okur: 8 dosyanın tamamında eksik harf yok; EPUB paketi (mimetype ilk ve sıkıştırmasız, manifest↔dosyalar, spine, XHTML iyi biçimliliği, görüntü imzaları) Python ile,
her bölüm gerçek bir tarayıcıyla (`application/xhtml+xml`, `parsererror` yok) doğrulanır. Kötü niyetli/tuhaf metin (`<script>`, `]]>`, kontrol karakterleri, yalnız vekil çift, `javascript:` bağlantısı) iyi biçimli çıktı verir.
**Sınır:** EPUB gerçek e-okuyucularda (Apple Books, Kindle, Kobo) ve epubcheck ile denenmedi.

### 2.4 Dayanıklılık

- `tests/test_robustness.py`: kesik, bozuk, şifreli, boş ve anlamsız dosyalar; kontrol karakterli/çok dilli/çok küçük metin; çok sayfalı küçük PDF.
  Beklenti: ya açık bir hata kodu (`unreadable_pdf`, …) ya da dürüstçe işaretlenmiş bir belge; asla çökme.
- Tek seferlik tarama (testlere eklenmedi): sentetik, LibreOffice ve Chromium PDF'lerinden türetilmiş 210 rastgele bozulmuş dosya (bayt çevirme, kesme, sıfırlama):
  115'i `unreadable_pdf` ile reddedildi, 95'i ayrıştırıldı, **0 çökme**.
- Belge bağlantıları sunucudan gelen veridir: yalnızca `http(s)`, `mailto` ve DOI bağlantıları açılır (`mobile/src/core/links.ts`); okuyucu runtime'ı belge metnini hiçbir yerde HTML olarak yorumlamaz (`innerHTML` yok).
- `tests/test_isolation.py`: zaman aşımı, bellek sınırı ve aşırı büyük sayfa; sunucu ve disk temiz kalır.

## 3. Performans notları (ölçüldü)

Sentetik IEEE makaleleri, 2 çekirdekli geliştirme konteyneri:

| Makale | Sayfa | PDF | Dönüşüm | Paket (JSON + görüntüler) |
|---|---|---|---|---|
| Kısa | 3 | 140 KB | 1,2 s | ≈ 1,1 MB |
| Uzun | 6 | 420 KB | 3,1 s | ≈ 2,6 MB |

(Bu tablo Faz 9'daki hızlandırmadan önce ölçüldü; aynı altı sentetik PDF'in (biri taranmış örnek) toplam dönüşüm süresi 5,8 s → 4,1 s'ye indi, çıktı bayt bayt aynı. Kalan süre çoğunlukla `pdfplumber` karakter çıkarımındadır.)

Sayfa başına yaklaşık 0,3–0,45 s ve 0,4 MB; tepe bellek ≈ 200 MB (6 sayfa). 30 sayfalık bir makale için ~15 s ve ~12 MB beklenir
(**ekstrapolasyon**, ölçülmedi). Her dönüşüm ayrı bir süreçte, varsayılan 300 s ve 4 GB sınırıyla çalışır.
Okuyucu şekil/sayfa görüntülerini tembel yükler. 90 sayfalık (1.680 bloklu) bir makale masaüstü Chromium'da ≈ 0,25 s'de ilk konumu bildirir, sona atlama ≈ 0,1–0,15 s sürer
(bütçe: 2,5 s / 1,5 s); makalede bul 1.700 blokta < 0,5 s. Cihaz WebView'ındaki gerçek süre ve bellek **ölçülmedi** (masaüstünden birkaç kat yavaş beklenir).

## 4. Ölçülmeyenler / bilinen sınırlar

- **Gerçek makaleler.** Bu geliştirme ortamında arXiv vb. erişilemiyordu (ağ kısıtlı); hiçbir gerçek akademik PDF ile deneme yapılmadı.
- **Cihaz.** iOS/Android cihazında veya emülatörde çalıştırma yapılmadı; WebView köprüsü (`react-native-webview`) yalnızca web iframe karşılığıyla sınandı. Seçim kulpları, klavye ve dosya seçici gibi cihaz davranışları denenmedi.
- **Gerçek LLM.** Sağlayıcı soyutlaması ve bütün güvenlik/atıf mantığı sahte bir OpenAI uyumlu sunucuyla sınandı; gerçek model çıktılarının biçimi, gecikmesi ve kalitesi sınanmadı.
- **Docling.** İndirme yapılamadığı için denenmedi; ayrıştırıcı arayüzü onu takmaya elverişlidir.
- **Kavram çıkarımı.** Kurallı (kısaltma, tanım kalıpları, vurgulu terimler, anahtar sözcükler, sık geçen isim öbekleri). Sentetik makalelerde sağlıklı çalışıyor; gerçek makalelerde gürültü ve kaçırma beklenir. Arayüz bunu açıkça söyler ve her satırı kaynağa bağlar.
- **Karmaşık düzenler.** Üç ve daha çok sütun, döndürülmüş sayfalar, taranmış PDF (OCR yok): “düzen belirsiz”/“desteklenmiyor” olarak işaretlenir; sessizce yanlış sonuç üretilmez.
- **Dergi stili ve sayfa sayfa okuma** yalnızca Chromium'da sınandı; cihaz WebView'ında (özellikle CSS sütunları ve `dvh` birimleri) davranış doğrulanmadı.
- **Linkle içe aktarma** gerçek arXiv/yayıncı sitelerine karşı denenmedi (ağ kısıtlı): çözümleyici kuralları ve indirici, yerel bir test sitesi ve sahte DNS ile sınandı. Yayıncı sitelerinin bot korumaları ve giriş duvarları “indirilemedi” hatası verir.
- **Senkron.** Sunucu kayıtları düz metin saklar; son yazan kazanır (aynı kaydı iki cihaz eşzamanlı düzenlerse eski kalan kaybolur). Kayıt başına son-yazan-kazanır olduğundan okuma durumunda eşzamanlı yer imleri birleştirilmez.

## 5. Gerçek PDF seti ile doğrulama protokolü (önerilen sonraki adım)

1. 10–20 gerçek makale seç: tek sütun/çift sütun, formül yoğun, tablo yoğun, dipnotlu, arXiv + yayıncı (IEEE/ACM/Springer) PDF'leri.
2. Her biri için `python -m folume.tools.inspect_pdf makale.pdf out/ --text` çalıştır; `out/` içindeki sayfa kaplamalarına bakarak blok türü, okuma sırası ve kaynak bölgelerini işaretle.
3. Dönüşüm raporundaki **kalite notu** ile insan değerlendirmesinin uyuşup uyuşmadığına bak (yanlış “iyi” en pahalı hatadır).
4. Hataları `synth` üreticilerine ya da yeni PDF test fikstürlerine dönüştür (telifli PDF'leri depoya koyma; yalnızca küçük, hak sahibi izinli parçalar).
5. Aynı makaleleri hedef cihazlarda okut; yakınlaştırma/yatay kaydırma sayısını, “orijinale dön” sıklığını ve kullanıcı tercihini kaydet.
