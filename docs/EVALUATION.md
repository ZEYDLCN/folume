# Değerlendirme: neyi ölçüyoruz, neyi ölçemiyoruz

README'deki başarı ölçütleri özellik sayısı değil, gerçek okuma ve öğrenme deneyimi üzerine kurulu.
Bu belge her ölçütün **bu depoda otomatik olarak neyle ölçüldüğünü**, hangi sonucu verdiğini ve
**hangi kısmının ancak gerçek makaleler, gerçek cihazlar ve gerçek kullanıcılarla ölçülebileceğini** açıkça ayırır.
Otomatik sonuçlar yalnızca "ayrıştırıcı ve uygulama, bilinen doğru yapıya sahip girdilerde doğru davranıyor" der;
"ürün gerçek makalelerde iyi çalışıyor" demez.

## 1. README ölçütleri → ölçüm

| README ölçütü | Otomatik vekil (depoda) | Durum | Kullanıcı/gerçek veri gerektiren kısım |
|---|---|---|---|
| **Dönüşüm bütünlüğü** | Metin geri çağırma/kesinlik, tür bulma, tablo hücre doğruluğu, atıf bağlama, **metin defteri** (her karakterin hesabı) — `backend/evals`, `tests/test_parsing.py` | Sentetik, LibreOffice ve Chromium PDF'lerinde ≥ %97 | Gerçek makalelerde (özellikle karmaşık formül, çok sütun, taranmış PDF) oran. **Ölçülmedi.** |
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
| Uygulama akışı | `e2e/app-flow.mjs` | Gerçek API + web derlemesi: içe aktarma → okuma → ayarlar → silme |
| Öğrenme katmanı | `e2e/learn-flow.mjs` | Sahte OpenAI uyumlu model **HTTP üzerinden**: AI kapalıyken hiçbir şey gitmez, önizleme, kaynaklı/kaynaksız ayrımı, not, kavrama testi |
| Bilgi çalışma alanı | `e2e/knowledge-flow.mjs` | İki “cihaz” + gerçek API: arama, etiket, bağlantılar, AI karşılaştırma, tekrar, dışa aktarma, yedek, senkron, silme |

Android ve iOS için `expo export` (Hermes paketleme) başarıyla derlenir; bu **cihazda çalıştırmak değildir**.

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

Sayfa başına yaklaşık 0,4–0,5 s ve 0,4 MB; tepe bellek ≈ 200 MB (6 sayfa). 30 sayfalık bir makale için ~15 s ve ~12 MB beklenir
(**ekstrapolasyon**, ölçülmedi). Her dönüşüm ayrı bir süreçte, varsayılan 300 s ve 4 GB sınırıyla çalışır.
Okuyucu şekil/sayfa görüntülerini tembel yükler; cihaz üzerindeki kaydırma/bellek davranışı **ölçülmedi**.

## 4. Ölçülmeyenler / bilinen sınırlar

- **Gerçek makaleler.** Bu geliştirme ortamında arXiv vb. erişilemiyordu (ağ kısıtlı); hiçbir gerçek akademik PDF ile deneme yapılmadı.
- **Cihaz.** iOS/Android cihazında veya emülatörde çalıştırma yapılmadı; WebView köprüsü (`react-native-webview`) yalnızca web iframe karşılığıyla sınandı. Seçim kulpları, klavye ve dosya seçici gibi cihaz davranışları denenmedi.
- **Gerçek LLM.** Sağlayıcı soyutlaması ve bütün güvenlik/atıf mantığı sahte bir OpenAI uyumlu sunucuyla sınandı; gerçek model çıktılarının biçimi, gecikmesi ve kalitesi sınanmadı.
- **Docling.** İndirme yapılamadığı için denenmedi; ayrıştırıcı arayüzü onu takmaya elverişlidir.
- **Kavram çıkarımı.** Kurallı (kısaltma, tanım kalıpları, vurgulu terimler, anahtar sözcükler, sık geçen isim öbekleri). Sentetik makalelerde sağlıklı çalışıyor; gerçek makalelerde gürültü ve kaçırma beklenir. Arayüz bunu açıkça söyler ve her satırı kaynağa bağlar.
- **Karmaşık düzenler.** Üç ve daha çok sütun, döndürülmüş sayfalar, taranmış PDF (OCR yok): “düzen belirsiz”/“desteklenmiyor” olarak işaretlenir; sessizce yanlış sonuç üretilmez.
- **Sayfa sayfa okuma modu** uygulanmadı (yalnızca kaydırmalı Book View).
- **Senkron.** Sunucu kayıtları düz metin saklar; son yazan kazanır (aynı kaydı iki cihaz eşzamanlı düzenlerse eski kalan kaybolur). Kayıt başına son-yazan-kazanır olduğundan okuma durumunda eşzamanlı yer imleri birleştirilmez.

## 5. Gerçek PDF seti ile doğrulama protokolü (önerilen sonraki adım)

1. 10–20 gerçek makale seç: tek sütun/çift sütun, formül yoğun, tablo yoğun, dipnotlu, arXiv + yayıncı (IEEE/ACM/Springer) PDF'leri.
2. Her biri için `python -m folume.tools.inspect_pdf makale.pdf out/ --text` çalıştır; `out/` içindeki sayfa kaplamalarına bakarak blok türü, okuma sırası ve kaynak bölgelerini işaretle.
3. Dönüşüm raporundaki **kalite notu** ile insan değerlendirmesinin uyuşup uyuşmadığına bak (yanlış “iyi” en pahalı hatadır).
4. Hataları `synth` üreticilerine ya da yeni PDF test fikstürlerine dönüştür (telifli PDF'leri depoya koyma; yalnızca küçük, hak sahibi izinli parçalar).
5. Aynı makaleleri hedef cihazlarda okut; yakınlaştırma/yatay kaydırma sayısını, “orijinale dön” sıklığını ve kullanıcı tercihini kaydet.
