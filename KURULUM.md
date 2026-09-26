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

## Özellikler

- **Beden takibi:** Zara, Pull&Bear, Bershka, Stradivarius, Massimo Dutti, Oysho, Lefties, Zara Home, Mango, H&M, Trendyol,
  Hepsiburada, Boyner, Beymen, FashFed, Koton, LC Waikiki, DeFacto, Nike, Adidas. Diğer sitelerde fiyat ve genel stok.
- **Hedef:** TL (ör. `1500`) ya da yüzde (ör. `%30`, takibe alındığı andaki fiyata göre). Boşsa her indirimde bildirim.
- **Fiyat geçmişi:** Panelde 60 günlük grafik; fiyat düşüş bildiriminde "son 30 günün en düşüğü" ya da
  "indirimden önce fiyat şişirilmiş" uyarısı.
- **Zara İstanbul mağaza stoğu:** İstenen beden bir İstanbul mağazasında stoğa girince bildirim.
- **Başka renkte stok:** İstenen beden başka bir renkte stoğa girince bildirim (Zara, Inditex markaları, Hepsiburada, Nike, H&M).
- **Uygulama ve telefon bildirimi:** Panel ana ekrana eklenebilir (PWA). Hesap menüsünden "Bu cihaza bildirim" açılınca
  bildirimler ntfy kurmadan doğrudan telefona/bilgisayara gelir. iPhone'da önce Safari → Paylaş → Ana Ekrana Ekle gerekir (iOS 16.4+).
- **Paylaş menüsü (Android):** Zara/Trendyol uygulamasında Paylaş → Ürün Takip deyince link ekleme formuna gelir.
- **Ben de takip et:** "Herkes" sekmesinde arkadaşının ürününü tek dokunuşla kendi listene eklersin.
- **Beden seçimi:** Bilinen üründe link yapıştırınca bedenler düğme olarak çıkar; kartlardaki bedenlere dokunarak değiştirilir.
- **Düzenleme / durdurma:** Hedef, hızlı takip, mağaza stoğu ve durdurma panelden değiştirilir.
- **E-postadan tek tık:** "Takibi bırak" ve hatırlatmadaki "Takibe devam et" linkleri giriş gerektirmez.
- **Kendiliğinden temizlik:** 60 gün bildirim çıkmayan takip için hatırlatma, 7 gün cevap gelmezse takip durdurulur.
- **Yönetici uyarısı:** Bir sitenin ürünleri toptan okunamazsa ya da bir ürün okunamaz hale gelirse `ADMIN_EMAIL` adresine e-posta.

## İlk kurulum

### 1. Cloudflare
1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages**. İlk kez giriyorsan senden bir `workers.dev` alt alan adı seçmeni ister (ör. `gokmen`). Seç ve kaydet.
2. **Account ID**: Workers & Pages → Account details kısmında yazar. Gizli bir bilgi değil, `worker/wrangler.toml` içindeki `account_id` satırına yazılır (bu projede yazılı).
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
| `DISPATCH_TOKEN` | 2. adımdaki GitHub token |
| `API_TOKEN` | 3. adımdaki rastgele anahtar |
| `PANEL_PASSWORD` | Panele giriş şifresi (arkadaşlarınla paylaşacağın) |
| `GMAIL_USER` | Bot Gmail adresi |
| `GMAIL_APP_PASSWORD` | Gmail uygulama şifresi (16 harf) |
| `ADMIN_EMAIL` | Sistem uyarılarının gideceği kendi e-posta adresin |
| `VAPID_PRIVATE_KEY` | Telefon bildirimlerinin gizli imza anahtarı (aşağıya bak) |

### Telefon bildirimi anahtarı
Anahtar çifti bir kez üretilir: herkese açık olanı `worker/wrangler.toml` içindeki `VAPID_PUBLIC_KEY`, gizli olanı `VAPID_PRIVATE_KEY` secret'ı.
Yeniden üretmek gerekirse (eski abonelikler geçersiz olur, herkes bildirimi tekrar açmalı):

```bash
npx web-push generate-vapid-keys --json > .yerel/vapid.json
node -p "require('./.yerel/vapid.json').privateKey" | clip     # gizli anahtarı panoya kopyalar (Windows)
```

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
- **Bir site okunamıyorsa:** `ADMIN_EMAIL` adresine uyarı gelir. Site tasarımını değiştirmiş olabilir; `checker/sites/` altındaki ilgili dosyanın güncellenmesi gerekir.
- **Veritabanı değişiklikleri:** `worker/migrations/` altına yeni numaralı `.sql` dosyası eklenir; **Paneli yükle** sırayla uygular.

## Geliştirme (bilgisayarda deneme)

```bash
npm ci
npm test                                   # bildirim kuralları testleri
node checker/dene.mjs "<ürün linki>"       # tek bir linki okumayı dene (Chrome açılır)
node checker/dene.mjs --magaza "<Zara linki>"  # mağaza stoğuyla birlikte
```

Paneli yerelde çalıştırmak için Node 22+ ve wrangler gerekir (`worker/.dev.vars` içine `PANEL_PASSWORD` ve `API_TOKEN` yaz,
`npx wrangler d1 migrations apply urun-takip --local`, `npx wrangler dev`). Kontrol programını yerel panele karşı
bildirim göndermeden çalıştırmak için:

```bash
API_URL=http://localhost:8787 API_TOKEN=<yerel anahtar> NOTIFY_DRY_RUN=1 npm run kontrol
```
