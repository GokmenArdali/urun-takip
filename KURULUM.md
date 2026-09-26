# Ürün Takip — Kurulum

Linkini verdiğin ürünün fiyatı düşünce veya istediğin beden stoğa girince e-posta / ntfy bildirimi gönderir.
Tamamen ücretsiz servislerle çalışır, bilgisayarının açık olması gerekmez.

## Nasıl çalışıyor

| Parça | Nerede | Ne yapar |
|---|---|---|
| Panel | Cloudflare (`worker/`) | Arkadaşlarının şifreyle girip ürün eklediği sayfa + veritabanı. Her 5 dakikada bir kontrol zamanı gelen ürün var mı bakar, varsa kontrol programını başlatır. |
| Kontrol programı | GitHub Actions (`checker/`) | Sitelere gerçek Chrome ile girer, fiyat/bedenleri okur, değişiklik varsa bildirim gönderir. |
| Bildirim | Gmail + ntfy | E-posta bot Gmail hesabından gider; ntfy isteyene telefona anında bildirim. |

"Hızlı" işaretli ürünler ~5 dakikada bir, diğerleri ~15 dakikada bir kontrol edilir.

## İlk kurulum

### 1. Cloudflare
1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages**. İlk kez giriyorsan senden bir `workers.dev` alt alan adı seçmeni ister (ör. `gokmen`). Seç ve kaydet.
2. Aynı sayfanın sağ tarafındaki **Account ID** değerini kopyala → bu `CLOUDFLARE_ACCOUNT_ID`.
3. Sağ üstte profil → **My Profile** → **API Tokens** → **Create Token** → **Edit Cloudflare Workers** şablonunu seç (**Use template**).
   - **Permissions** listesine **+ Add more** ile `Account` · `D1` · `Edit` satırını ekle.
   - **Account Resources**: kendi hesabın. **Zone Resources**: All zones.
   - **Continue to summary** → **Create Token** → çıkan değeri kopyala → bu `CLOUDFLARE_API_TOKEN`.

### 2. GitHub erişim anahtarı (panelin kontrol programını başlatabilmesi için)
1. GitHub → sağ üst profil → **Settings** → en altta **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Token name: `urun-takip`. Expiration: izin verilen en uzun süre.
3. Repository access: **Only select repositories** → `urun-takip`.
4. Permissions → **Actions**: **Read and write**.
5. **Generate token** → çıkan değeri kopyala → bu `DISPATCH_TOKEN`.

### 3. Paylaşılan anahtar
Panel ile kontrol programının birbirini tanıması için rastgele bir anahtar. Terminalde:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Çıkan değer → `API_TOKEN`.

### 4. GitHub Secrets
GitHub'da `urun-takip` projesi → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Şunları tek tek ekle:

| Name | Değer |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 1. adımdaki token |
| `CLOUDFLARE_ACCOUNT_ID` | 1. adımdaki Account ID |
| `DISPATCH_TOKEN` | 2. adımdaki GitHub token |
| `API_TOKEN` | 3. adımdaki rastgele anahtar |
| `PANEL_PASSWORD` | Panele giriş şifresi (arkadaşlarınla paylaşacağın) |
| `GMAIL_USER` | Bot Gmail adresi |
| `GMAIL_APP_PASSWORD` | Gmail uygulama şifresi (16 harf) |

### 5. Paneli yükle
1. **Actions** → soldan **Paneli yükle** → **Run workflow**.
2. Bitince çalışmaya tıkla → **Paneli yükle** adımının çıktısında `https://urun-takip.<alt-alan-adın>.workers.dev` adresi yazar. Bu panelin adresi.
3. Bu adresi de secret olarak ekle: Name `API_URL`, değer panel adresi (sonunda `/` olmadan).

### 6. Dene
1. Panel adresini aç, şifreyle gir, adını ve e-postanı kaydet, bir ürün ekle.
2. Birkaç dakika içinde "Takip başladı" e-postası gelmeli. İlk e-postalar **Spam** klasörüne düşebilir: "Spam değil" olarak işaretle.
3. Gelmezse **Actions** → **Kontrol** çalışmalarına bak; kırmızı olan varsa içindeki hata mesajı sorunu söyler.

Arkadaşlarına panel adresini ve şifreyi göndermen yeterli.

## Bakım

- **Şifreyi değiştirmek:** `PANEL_PASSWORD` secret'ını güncelle → **Paneli yükle**'yi tekrar çalıştır.
- **GitHub token süresi dolunca:** Panelin üstünde "Kontrol programı başlatılamıyor" uyarısı çıkar. 2. adımdaki gibi yeni token al, `DISPATCH_TOKEN`'ı güncelle, **Paneli yükle**'yi çalıştır. (Bu sürede kontroller saatte bir yedek zamanlamayla devam eder.)
- **Tüm ürünleri hemen kontrol etmek:** **Actions** → **Kontrol** → **Run workflow** → "tüm ürünler" kutusunu işaretle.
- **Bir site okunamıyorsa:** Site tasarımını değiştirmiş olabilir; `checker/sites/` altındaki ilgili dosyanın güncellenmesi gerekir.

## Geliştirme (bilgisayarda deneme)

```bash
npm ci
npm test                                   # bildirim kuralları testleri
node checker/dene.mjs "<ürün linki>"       # tek bir linki okumayı dene (Chrome açılır)
```

Paneli yerelde çalıştırmak için Node 22+ ve wrangler gerekir (`worker/.dev.vars` içine `PANEL_PASSWORD` ve `API_TOKEN` yaz,
`npx wrangler d1 execute urun-takip --local --file=schema.sql`, `npx wrangler dev`). Kontrol programını yerel panele karşı
bildirim göndermeden çalıştırmak için:

```bash
API_URL=http://localhost:8787 API_TOKEN=<yerel anahtar> NOTIFY_DRY_RUN=1 npm run kontrol
```
