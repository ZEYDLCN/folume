# Ücretsiz yayına alma (adım adım)

İki parça vardır ve ikisi de ücretsiz kalır:

| Parça | Nerede | Ücretsiz sınır |
|---|---|---|
| **Sunucu** (PDF → belge, bağlantıdan ekleme, arXiv takibi, isteğe bağlı AI) | Hugging Face Space (Gradio türü) ya da **Render** | Render: 512 MB, 15 dk boş kalınca uyur; HF: uyur, **kalıcı disk yok** |
| **Uygulama** (web, kurulabilir PWA) | **Cloudflare** (Workers statik varlıklar / Pages) | Statik dosyalar için ücretsiz ve sınırsız; ayda 500 derleme |

Sunucu hiçbir şey saklamaz (PDF bellekte dönüştürülür, sonuç indirilince silinir); makaleler, notlar ve kartlar **kullanıcının tarayıcısında** durur. Bu yüzden kalıcı diske ihtiyaç yoktur. Cihazlar arası senkron kapalı kalmalıdır (kayıtlar sunucu yeniden başlayınca silinir); yedek için uygulamadaki **Veri → Yedek** kullanılır.

## 1. Sunucu

Hugging Face artık **Docker Space'ini yeni hesaplarda ücretli** gösteriyor ([forum](https://discuss.huggingface.co/t/docker-sdk-now-marked-as-paid-when-creating-a-new-space/177580)); Gradio'da da CPU Basic çoğu zaman PRO istiyor. Üç yol var, sırayla dene:

### 1-A. Hugging Face, Gradio türü Space (hesabın uygunsa; denemesi bedava)

Gradio'nun yalnızca “kılıf” olduğu bir Space: `app.py` bizim API'yi başlatır, Gradio sayfası yoktur. Ücretsiz donanım olarak yalnızca **ZeroGPU** sunulabilir; bu hesabın 30 günden eski ve e-postasının doğrulanmış olmasını ister. Olmazsa 1-B'ye geç.

1. <https://huggingface.co/join> ile hesap aç, e-postanı doğrula.
2. <https://huggingface.co/new-space> → **Space name** `folume-api`, **SDK: Gradio → Blank**, donanım: **CPU Basic** seçilebiliyorsa onu, değilse **ZeroGPU**; **Public**. Oluştur.
3. <https://huggingface.co/settings/tokens> → **Create new token** → **Write**. Token'ı kopyala.
4. Bu deponun kökünde:

   ```bash
   deploy/huggingface/publish.sh <kullanıcı-adın>/folume-api gradio
   ```

   Git kullanıcı adı olarak HF kullanıcı adını, parola olarak **token'ı** ister. Yalnızca sunucu dosyaları gönderilir.
5. Space **Running** olunca `https://<kullanıcı-adın>-folume-api.hf.space/v1/health` → `{"status":"ok",…}`.

Ayarlar (Space → **Settings → Variables and secrets**): `FOLUME_CORS_ORIGINS` (Variable) ve `FOLUME_API_KEY` (**Secret**), bkz. 3. adım. 48 saat kullanılmazsa uyur; kalıcı disk yoktur.

### 1-B. Render (kart istemez; en sağlam ücretsiz yol)

Render'ın ücretsiz web servisi: 512 MB bellek, paylaşımlı işlemci, 15 dakika boş kalınca uyur (uyanması 30–50 sn). **Ölçüm:** boşta sunucu ≈ 95 MB; 3 sayfalık makale ≈ 285 MB; 30 sayfalık makale ≈ 410 MB tepe (12 sn). Bu yüzden `render.yaml` aynı anda tek dönüşüm ve en çok 40 sayfa ayarlar; daha uzun makale, instance'ı düşürmek yerine açık bir hatayla reddedilir.

1. <https://render.com> ile hesap aç (GitHub ile giriş en kolayı), GitHub deposuna erişim ver.
2. **New → Blueprint** → `folume` deposunu seç → Render `render.yaml`'ı okur → **Apply**. (Blueprint çıkmazsa **New → Web Service → Docker** ile elle: *Dockerfile path* `backend/Dockerfile`, *Docker build context* `backend`, *Instance type* Free, ortam değişkenleri `render.yaml`'daki gibi.)
3. İlk derleme birkaç dakika sürer. Bitince adres `https://folume-api-xxxx.onrender.com` olur; `/v1/health` adresini aç.
4. **Environment** sekmesinde `FOLUME_API_KEY`'in değerini oku (Render üretmiştir); 4. adımda uygulamaya yazacaksın. `FOLUME_CORS_ORIGINS`'i 3. adımda dolduracaksın.

### 1-C. Kendi bilgisayarın (tamamen bedava, ama yalnızca açıkken)

```bash
make setup-backend && make dev-api            # http://localhost:8000
cloudflared tunnel --url http://localhost:8000 # herkese açık geçici bir https adresi verir
```

Bilgisayarın açık olduğu sürece çalışır; adres her başlatışta değişir. Kendin ve birkaç kişi için yeter.

## 2. Uygulama: Cloudflare

Cloudflare'in kurulum sihirbazı artık “Workers” diye açılır (Pages'in yeni hali); depodaki `wrangler.jsonc` yayınlanacak klasörü (`mobile/dist`) ve tek sayfalık uygulama ayarını söyler.

1. <https://dash.cloudflare.com/sign-up> ile hesap aç (kart istemez).
2. **Workers & Pages → Create → Import a repository (Git)** → GitHub'ı bağla, `folume` deposunu seç.
3. Ayarlar:
   - **Project name:** `folume`
   - **Build command:** `cd mobile && npm ci && npx expo export --platform web`
   - **Deploy command:** `npx wrangler deploy` (varsayılan)
   - **Advanced settings → Production branch:** kodun olduğu dal (`main`, birleştirmeden önce `feat/academic-deep-reading`)
   - **Advanced settings → Build variables and secrets:**
     - `NODE_VERSION` = `22`
     - `CI` = `1`
     - `EXPO_PUBLIC_API_URL` = sunucunun adresi (ör. `https://folume-api.onrender.com`; sonunda `/` olmadan)
4. **Deploy**. Bitince adres `https://folume.<hesap-adın>.workers.dev` olur.

## 3. İkisini birbirine tanıt (CORS ve anahtar)

Sunucu panelinde (HF: Space → **Settings → Variables and secrets**; Render: servis → **Environment**):

| Ad | Tür | Değer |
|---|---|---|
| `FOLUME_CORS_ORIGINS` | Variable | `https://<proje-adı>.pages.dev` (uygulamanın adresi) |
| `FOLUME_API_KEY` | **Secret** | Uzun rastgele bir parola (Render'da zaten üretilmiştir). Tanımlıysa her istek bunu ister; internetteki herkesin senin işlemcini kullanmasını engeller |

Değişken ekleyince sunucu kendiliğinden yeniden başlar.

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

- **İlk istek yavaş olabilir:** sunucu boş kalınca uyur (Render 15 dk, HF 48 saat); ilk istek onu uyandırır (30 sn – 2 dakika). Uygulama bu sürede “sunucuya ulaşılamadı” der; biraz sonra yeniden dene. Uyutmamak için `…/v1/health` adresini düzenli açan ücretsiz bir zamanlayıcı (ör. cron-job.org) yeter: HF için günde bir, Render için 14 dakikada bir (Render'ın ücretsiz saatleri ayda 750 saattir, tek servis için tüm ayı karşılar).
- **OCR kapalı:** ücretsiz sunucuda OCR imajı büyük ve yavaştır; taranmış PDF'ler “desteklenmiyor” der. Açmak için `FOLUME_OCR=1` ve `pip install ".[ocr]"` gerekir (bkz. DEVELOPMENT.md).
- **Senkron kapalı** (yukarıya bak). Yedeği uygulamadan al.
- **Güncelleme:** Render ve Cloudflare dala her push'ta kendiliğinden yeniden derler; HF Space için `publish.sh`'ı yeniden çalıştır.
- **Kendi alan adın** varsa Cloudflare Pages'te **Custom domains** ekler; `FOLUME_CORS_ORIGINS`'i yeni adrese göre güncellemeyi unutma (birden çok adres virgülle ayrılır).
