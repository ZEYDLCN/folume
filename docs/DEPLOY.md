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
4. **Environment** sekmesinde `FOLUME_API_KEY`'i herkese açık bir demo için **boş bırak**, özel kullanım için uzun bir parola yaz (bkz. “Herkese açık yayın”). `FOLUME_CORS_ORIGINS`'i 3. adımda dolduracaksın.

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
| `FOLUME_API_KEY` | **Secret** | İsteğe bağlı. Uzun rastgele bir parola: tanımlıysa her istek bunu ister, internetteki herkesin senin işlemcini kullanmasını engeller ve her kullanıcı onu uygulamanın Ayarlar'ına bir kez girer. Herkese açık demoda boş bırak |

Değişken ekleyince sunucu kendiliğinden yeniden başlar.

## 4. Dene

1. `https://<proje-adı>.pages.dev` adresini aç.
2. **Ayarlar → Dönüştürme sunucusu**: adres zaten doludur; **API anahtarı**'na 3. adımdaki parolayı yaz → **Bağlantıyı dene** → sürüm görünmeli. (Anahtar uygulamaya gömülmez; her tarayıcıya bir kez girilir.)
3. Kütüphanede bir PDF seç ya da “bağlantıdan ekle” ile bir arXiv numarası yapıştır; kitap gibi açılmalı.
4. Tarayıcının menüsünden **Ana ekrana ekle / Uygulamayı yükle** ile PWA olarak yükle; paylaşım menünde Folume görünür.

## 5. İsteğe bağlı: ücretsiz AI

AI olmadan her şey çalışır (yanıtlar yalnızca makaleden pasaj olarak gelir). Açmak için herhangi bir OpenAI uyumlu uç nokta yeter. Aşağıdaki adresler ve model adları değişebilir; sağlayıcının sayfasından doğrula. Ücretsiz limitler kaynaklara göre çelişkili ve sık değişiyor, kendi panelinden bak.

| Sağlayıcı | `FOLUME_LLM_BASE_URL` | `FOLUME_LLM_MODEL` | Notlar |
|---|---|---|---|
| **Google Gemini** (önerilen başlangıç) | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-flash-lite-latest` (kararlı takma ad; hızlı, ücretsiz) | Anahtar: <https://aistudio.google.com/apikey> (kart istemez). Türkçe iyi. Ücretsiz katmanda gönderilenler Google'ın ürünlerini geliştirmekte kullanılabilir (politikasını kontrol et). Ücretsiz modeller yoğunlukta 503 verebilir ve eski adlar kapanabilir: aşağıdaki yedek zincirini ekle |
| **Groq** | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | Anahtar: <https://console.groq.com/keys>. Çok hızlı; günlük istek/token sınırı var |
| **NVIDIA** | `https://integrate.api.nvidia.com/v1` | `openai/gpt-oss-120b` | Anahtar `nvapi-…` (<https://build.nvidia.com>). Deneme koşulları; düşünen modeldir: `FOLUME_LLM_REASONING_EFFORT=low` ve `FOLUME_LLM_MAX_TOKENS=4000` ekle |
| **OpenRouter** | `https://openrouter.ai/api/v1` | `:free` ile biten bir model | Ücretsiz modeller sık değişir, dakika/gün sınırları düşük |

Hepsi için `FOLUME_LLM_API_KEY` = sağlayıcının anahtarı (**Secret** olarak gir). **Düşünen modellerde** (gpt-oss, Gemini 2.5 Flash gibi) yanıtın bir kısmı “düşünmeye” gider: yanıt kesilirse `FOLUME_LLM_MAX_TOKENS=4000` ve `FOLUME_LLM_REASONING_EFFORT=low` ekle. Sağlayıcı bu ayarı tanımazsa sunucu isteği ayarsız yineler.

**Yedek modeller.** Ücretsiz katmanlar yük altında 503 verir ya da modeli kapatır. `FOLUME_LLM_FALLBACK_MODELS` virgülle ayrılmış model adlarıdır; ana model hata verirse (503, 404, zaman aşımı) sırayla bunlar denenir. Gemini için denenmiş bir dizilim:

```
FOLUME_LLM_MODEL=gemini-flash-lite-latest
FOLUME_LLM_FALLBACK_MODELS=gemini-3.1-flash-lite,gemini-3.5-flash-lite
FOLUME_LLM_TIMEOUT_SECONDS=25
```

Zaman aşımı model başınadır; 25 sn, takılan bir modelden diğerine zamanında geçmek için yeter. Hepsi başarısız olursa yine makaleden pasajlar gösterilir.

Sonra uygulamada **Ayarlar → Bağlantıyı dene**: “Sunucuda AI açıklamaları: açık” yazmalı; **Ayarlar → Yapay zekâ ve gizlilik**'i aç. Pasajlar gönderilmeden önce her zaman önizlenir. Sağlayıcı kotayı doldurursa ya da hata verirse uygulama bozulmaz: o istek için makaleden pasajlar gösterilir.

## Herkese açık yayın (LinkedIn vb.)

**Ziyaretçi hiçbir şey kurmaz:** linke tıklar ve kullanır; hesap ya da anahtar gerekmez. Yukarıdaki adımlar yalnızca senin bir kez yaptığın kurulumdur. Makaleler, notlar, kartlar her ziyaretçinin **kendi tarayıcısında** durur; sunucu hiçbir şey saklamaz ve ziyaretçiler birbirinin verisini göremez.

Herkese açık bir demo için:

1. **API anahtarını kaldır:** Render'da `FOLUME_API_KEY` değişkenini sil (ya da boş bırak). Anahtar varsa her ziyaretçi onu uygulamaya girmek zorunda kalır. Anahtarsız sunucu şu sınırlarla korunur: aynı anda tek dönüşüm, kuyrukta en çok 4 iş, en çok 40 sayfa, 50 MB, bağlantılardan indirme yalnızca herkese açık adreslerden. Biri kötüye kullanırsa anahtarı geri koyman yeter; ücretsiz planda para harcanmaz, sunucu yalnızca yavaşlar.
2. **Uyanma beklemesini azalt:** Render'ın ücretsiz sunucusu 15 dakika boş kalınca uyur. Uygulama açılır açılmaz sunucuyu uyandırır ve makale eklerken “Sunucu uyanıyor…” diyerek bekler; yine de ilk ziyaretçi bir dakikaya kadar bekleyebilir. Bunu bitirmek için ücretsiz <https://cron-job.org> hesabında `https://<sunucu-adresin>/v1/health` adresini **her 14 dakikada** açan bir iş kur.
3. **Paylaşım önizlemesi:** LinkedIn gibi sitelerde link, `mobile/public/index.html` içindeki başlık, açıklama ve `og-image.png` ile görünür (görsel adresi `https://folume.2103013235.workers.dev/og-image.png`; farklı bir adres kullanırsan oradaki iki satırı güncelle). LinkedIn önizlemeyi önbelleğe alır; değiştirince <https://www.linkedin.com/post-inspector/> ile yenile.
4. **Sınırlar, dürüstçe:** ücretsiz sunucu 512 MB bellekli tek örnektir; çok kişi aynı anda büyük makale yüklerse sıra bekler. Ağır kullanım gelirse Render'ın ücretli planına geçmek tek tıktır. OCR kapalıdır.
5. **Gizlilik cümlesi (paylaşımda kullanabilirsin):** “Makalelerin ve notların yalnızca tarayıcında durur. Sunucu PDF'i bellekte dönüştürür ve saklamaz.” (AI açık değildir; açarsan sağlayıcıya gidenler önizlenir.)

## Bilmen gerekenler

- **İlk istek yavaş olabilir:** sunucu boş kalınca uyur (Render 15 dk, HF 48 saat); ilk istek onu uyandırır (30 sn – 2 dakika). Uygulama bu sürede “sunucuya ulaşılamadı” der; biraz sonra yeniden dene. Uyutmamak için `…/v1/health` adresini düzenli açan ücretsiz bir zamanlayıcı (ör. cron-job.org) yeter: HF için günde bir, Render için 14 dakikada bir (Render'ın ücretsiz saatleri ayda 750 saattir, tek servis için tüm ayı karşılar).
- **OCR kapalı:** ücretsiz sunucuda OCR imajı büyük ve yavaştır; taranmış PDF'ler “desteklenmiyor” der. Açmak için `FOLUME_OCR=1` ve `pip install ".[ocr]"` gerekir (bkz. DEVELOPMENT.md).
- **Senkron kapalı** (yukarıya bak). Yedeği uygulamadan al.
- **Güncelleme:** Render ve Cloudflare dala her push'ta kendiliğinden yeniden derler; HF Space için `publish.sh`'ı yeniden çalıştır.
- **Kendi alan adın** varsa Cloudflare Pages'te **Custom domains** ekler; `FOLUME_CORS_ORIGINS`'i yeni adrese göre güncellemeyi unutma (birden çok adres virgülle ayrılır).
