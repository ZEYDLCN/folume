# Ücretsiz yayına alma (adım adım)

İki parça vardır ve ikisi de ücretsiz kalır:

| Parça | Nerede | Ücretsiz sınır |
|---|---|---|
| **Sunucu** (PDF → belge, bağlantıdan ekleme, arXiv takibi, isteğe bağlı AI) | Hugging Face **Space** (Docker) | 2 vCPU, 16 GB bellek; 48 saat kimse girmezse uyur; **kalıcı disk yok** |
| **Uygulama** (web, kurulabilir PWA) | Cloudflare **Pages** | Sınırsız bant genişliği, ayda 500 derleme |

Sunucu hiçbir şey saklamaz (PDF bellekte dönüştürülür, sonuç indirilince silinir); makaleler, notlar ve kartlar **kullanıcının tarayıcısında** durur. Bu yüzden kalıcı diske ihtiyaç yoktur. Cihazlar arası senkron kapalı kalmalıdır (kayıtlar sunucu yeniden başlayınca silinir); yedek için uygulamadaki **Veri → Yedek** kullanılır.

## 1. Sunucu: Hugging Face Space

1. <https://huggingface.co/join> ile hesap aç (e-posta yeterli).
2. <https://huggingface.co/new-space> → **Space name** `folume-api`, **SDK: Docker** (boş şablon), **Hardware: CPU basic · Free**, **Public**. Oluştur.
3. <https://huggingface.co/settings/tokens> → **Create new token** → türü **Write**. Token'ı kopyala (bir kez görünür).
4. Bilgisayarında bu deponun kökünde:

   ```bash
   deploy/huggingface/publish.sh <kullanıcı-adın>/folume-api
   ```

   Git kullanıcı adı olarak Hugging Face kullanıcı adını, parola olarak **token'ı** ister. Betik yalnızca sunucu dosyalarını (`pyproject.toml`, `src/`, `Dockerfile`, `README.md`) gönderir; deponun geçmişini göndermez.
5. Space sayfasında **Building** → birkaç dakika sonra **Running**. Şunu aç: `https://<kullanıcı-adın>-folume-api.hf.space/v1/health` → `{"status":"ok",…}` görmelisin.

## 2. Uygulama: Cloudflare Pages

1. <https://dash.cloudflare.com/sign-up> ile hesap aç (kart istemez).
2. **Workers & Pages → Create → Pages → Connect to Git** → GitHub'ı bağla, `folume` deposunu seç.
3. Ayarlar:
   - **Production branch:** kodun olduğu dal (`main`, birleştirmeden önce `feat/academic-deep-reading`)
   - **Framework preset:** None
   - **Build command:** `cd mobile && npm ci && npx expo export --platform web`
   - **Build output directory:** `mobile/dist`
   - **Environment variables:**
     - `NODE_VERSION` = `22`
     - `CI` = `1`
     - `EXPO_PUBLIC_API_URL` = `https://<kullanıcı-adın>-folume-api.hf.space` (sunucunun adresi, sonunda `/` olmadan)
4. **Save and Deploy**. Bitince adres `https://<proje-adı>.pages.dev` olur.

## 3. İkisini birbirine tanıt (CORS ve anahtar)

Space sayfasında **Settings → Variables and secrets**:

| Ad | Tür | Değer |
|---|---|---|
| `FOLUME_CORS_ORIGINS` | Variable | `https://<proje-adı>.pages.dev` (uygulamanın adresi) |
| `FOLUME_API_KEY` | **Secret** | Uzun rastgele bir parola. Tanımlıysa her istek bunu ister; internetteki herkesin senin işlemcini kullanmasını engeller |

Değişken ekleyince Space kendiliğinden yeniden başlar.

## 4. Dene

1. `https://<proje-adı>.pages.dev` adresini aç.
2. **Ayarlar → Dönüştürme sunucusu**: adres zaten doludur; **API anahtarı**'na 3. adımdaki parolayı yaz → **Bağlantıyı dene** → sürüm görünmeli. (Anahtar uygulamaya gömülmez; her tarayıcıya bir kez girilir.)
3. Kütüphanede bir PDF seç ya da “bağlantıdan ekle” ile bir arXiv numarası yapıştır; kitap gibi açılmalı.
4. Tarayıcının menüsünden **Ana ekrana ekle / Uygulamayı yükle** ile PWA olarak yükle; paylaşım menünde Folume görünür.

## 5. İsteğe bağlı: ücretsiz AI

AI olmadan her şey çalışır (yanıtlar yalnızca makaleden pasaj olarak gelir). Açmak için herhangi bir OpenAI uyumlu uç nokta yeter; çoğu sağlayıcının ücretsiz katmanı vardır. Space'e ekle:

| Ad | Tür |
|---|---|
| `FOLUME_LLM_BASE_URL` | Variable (ör. sağlayıcının `…/v1` adresi) |
| `FOLUME_LLM_MODEL` | Variable |
| `FOLUME_LLM_API_KEY` | Secret |

Sonra uygulamada **Ayarlar → Yapay zekâ ve gizlilik**'yı aç. Pasajlar gönderilmeden önce her zaman önizlenir; sağlayıcının saklama ve eğitim politikasını kendin değerlendirmelisin.

## Bilmen gerekenler

- **İlk istek yavaş olabilir:** Space 48 saat kullanılmazsa uyur; ilk istek onu uyandırır (1–2 dakika). Uygulama bu sürede “sunucuya ulaşılamadı” der; biraz sonra yeniden dene. Uyutmamak için her gün bir kez `…/v1/health` adresini açan ücretsiz bir zamanlayıcı (ör. cron-job.org) yeter.
- **OCR kapalı:** ücretsiz Space'te OCR imajı büyük ve yavaştır; taranmış PDF'ler “desteklenmiyor” der. Açmak için `FOLUME_OCR=1` ve `pip install ".[ocr]"` gerekir (bkz. DEVELOPMENT.md).
- **Senkron kapalı** (yukarıya bak). Yedeği uygulamadan al.
- **Güncelleme:** kodu değiştirince sunucu için `publish.sh`'ı yeniden çalıştır; uygulama için dala push etmen yeter (Cloudflare kendiliğinden derler).
- **Kendi alan adın** varsa Cloudflare Pages'te **Custom domains** ekler; `FOLUME_CORS_ORIGINS`'i yeni adrese göre güncellemeyi unutma (birden çok adres virgülle ayrılır).
