import { explainFailure, ogImage, open, poll, sleep, withPage } from '../browser.mjs';

const IN_STOCK = new Set(['in_stock', 'low_on_stock']);
const cleanSize = (name) => String(name).replace(/\s*\(.*\)\s*$/, '');

// İstanbul'daki mağazalar bir çalıştırma boyunca bir kez alınır
let istanbulStores = null;

const isIstanbul = (s) => !s.isOnlyForEmployees && /İSTANBUL|ISTANBUL/i.test(s.city ?? '');

function parseStoreStock(stores, availability) {
  const names = new Map(stores.map((s) => [s.id, String(s.name).replace(/^ZARA\s+/i, '')]));
  return (availability.sizesAvailableAndLocationsByPhysicalStores ?? [])
    .filter((s) => names.has(s.physicalStoreId))
    .map((s) => ({
      id: s.physicalStoreId,
      name: names.get(s.physicalStoreId),
      sizes: (s.sizesAvailability ?? []).filter((z) => z.stock > 0).map((z) => ({ name: cleanSize(z.size), stock: z.stock })),
    }))
    .filter((s) => s.sizes.length);
}

// Önce doğrudan sorgu denenir; bot koruması reddederse (genelde reddediyor) sitenin kendi
// "Mağazadaki stok durumu" akışı tıklanarak aynı veri alınır.
async function storeStock(page, productId, sizeNames) {
  try {
    return await queryStoreStock(page, productId);
  } catch {
    return storeStockViaUi(page, sizeNames);
  }
}

async function storeStockViaUi(page, sizeNames) {
  const storesRes = page.waitForResponse((r) => r.url().includes('/stores-locator/extended/search'), { timeout: 30000 });
  const stockRes = page.waitForResponse((r) => r.url().includes('/store-product-availability'), { timeout: 30000 });
  storesRes.catch(() => {});
  stockRes.catch(() => {});

  // Çerez bandı varsa kapat, sayfada biraz gezin (bot koruması insan etkileşimi bekliyor)
  await page.getByRole('button', { name: /tümünü reddet|reddet/i }).first().click({ timeout: 3000 }).catch(() => {});
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, 300);
  await sleep(1200);

  const link = page.getByText(/mağazadaki stok/i).last();
  await link.scrollIntoViewIfNeeded({ timeout: 5000 });
  const box = await link.boundingBox();
  if (!box) throw new Error('"Mağazadaki stok durumu" bağlantısı bulunamadı');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  // Açılan panelde tüm bedenleri seçip sorgula ("Sorgula" beden seçilene kadar pasif)
  const query = page.getByRole('button', { name: /sorgula/i });
  const panel = page.locator('div, aside, section').filter({ hasText: /hangi bedeni/i }).filter({ has: query }).last();
  await panel.waitFor({ timeout: 10000 });
  for (const name of sizeNames) {
    await panel.getByText(name, { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
    await sleep(150);
  }
  await query.first().click({ timeout: 8000 });

  const [stores, stock] = await Promise.all([storesRes, stockRes]);
  if (!stock.ok()) throw new Error(`mağaza stoğu HTTP ${stock.status()}`);
  istanbulStores ??= (await stores.json()).filter(isIstanbul).map((s) => ({ id: s.id, name: s.commercialName || s.name }));
  return parseStoreStock(istanbulStores, await stock.json());
}

async function queryStoreStock(page, productId) {
  const result = await page.evaluate(
    async ({ productId, cached }) => {
      let stores = cached;
      if (!stores) {
        const res = await fetch(
          '/tr/tr/stores-locator/extended/search?lat=41.0082&lng=28.9784&isDonationOnly=false&showOnlyPickup=false&radius=40&showStoresCapacity=false&ajax=true',
          { headers: { accept: 'application/json' } },
        );
        if (!res.ok) throw new Error(`mağaza listesi HTTP ${res.status}`);
        stores = (await res.json())
          .filter((s) => !s.isOnlyForEmployees && /İSTANBUL|ISTANBUL/i.test(s.city ?? '')) // isIstanbul ile aynı
          .map((s) => ({ id: s.id, name: s.commercialName || s.name }));
      }
      const ids = stores.map((s) => `physicalStoreIds=${s.id}`).join('&');
      const res = await fetch(`/tr/tr/store-product-availability?productId=${productId}&${ids}&ajax=true`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`mağaza stoğu HTTP ${res.status}`);
      return { stores, availability: await res.json() };
    },
    { productId, cached: istanbulStores },
  );
  istanbulStores = result.stores;
  return parseStoreStock(result.stores, result.availability);
}

export default {
  name: 'Zara',
  match: (host) => /(^|\.)zara\.com$/.test(host),
  storeStock: true,

  async check(url, { browser, storeStock: wantStores }) {
    // v1 parametresi seçili rengin ürün numarası
    const wantedId = new URL(url).searchParams.get('v1');
    const availability = new Map();

    return withPage(browser, url, async (page) => {
      // Sayfa beden stoklarını ayrıca canlı olarak çeker, onu yakalıyoruz
      page.on('response', async (res) => {
        const m = res.url().match(/\/products\/id\/(\d+)\/availability/);
        if (m && res.ok()) availability.set(m[1], await res.json().catch(() => null));
      });
      await open(page, url);

      const product = await poll(() => page.evaluate(() => window.zara?.viewPayload?.product ?? null));
      if (!product) throw new Error(await explainFailure(page, 'Zara ürün verisi okunamadı'));

      const colors = product.detail?.colors ?? [];
      const color = colors.find((c) => String(c.productId) === wantedId) ?? colors[0];
      if (!color) throw new Error('Üründe renk/beden bilgisi yok');

      const live = await poll(() => availability.get(String(color.productId)), { timeout: 8000 });
      const liveBySku = new Map((live?.sizes ?? []).map((s) => [s.sku, s.availability]));
      // Mağaza stoğu okunamazsa ürünün kendisi yine de takip edilir
      const stores = wantStores
        ? await storeStock(page, color.productId, (color.sizes ?? []).map((s) => s.name)).catch((e) => {
            console.error(`Zara mağaza stoğu okunamadı: ${e.message}`);
            return null;
          })
        : null;

      return {
        title: product.name,
        color: color.name,
        image: await ogImage(page),
        price: color.price / 100,
        listPrice: color.oldPrice > color.price ? color.oldPrice / 100 : null,
        stores,
        sizes: (color.sizes ?? []).map((s) => ({
          name: cleanSize(s.name),
          available: IN_STOCK.has(liveBySku.get(s.sku) ?? s.availability),
          price: (s.price ?? color.price) / 100,
        })),
      };
    });
  },
};
