// Tanımadığımız siteler: önce Akinon JSON'u dener, olmazsa sayfadaki standart ürün bilgisini
// (schema.org JSON-LD) okur. Bu durumda beden takibi olmaz, sadece fiyat ve genel stok.
import { explainFailure, ldJsonTexts, ogImage, open, poll, withPage } from '../browser.mjs';
import { fetchAkinon, parseAkinon } from './akinon.mjs';
import { findLdProduct, firstImage } from './http.mjs';

const inStock = (offer) => /InStock|LimitedAvailability|OnlineOnly|PreSale/i.test(offer?.availability ?? '');

function offerPrice(offers) {
  const list = [].concat(offers ?? []);
  const prices = list.map((o) => Number(o.price ?? o.lowPrice)).filter((p) => p > 0);
  return { price: prices.length ? Math.min(...prices) : null, available: list.some(inStock) };
}

export default {
  name: 'Diğer',
  match: () => true,

  async check(url, { browser }) {
    try {
      return parseAkinon(await fetchAkinon(url));
    } catch {}

    return withPage(browser, url, async (page) => {
      await open(page, url);
      const blocks = await poll(async () => {
        const texts = await ldJsonTexts(page);
        return texts.length ? texts : null;
      }, { timeout: 20000 });
      const product = (blocks ?? [])
        .map((t) => {
          try {
            return findLdProduct(JSON.parse(t));
          } catch {
            return null;
          }
        })
        .find(Boolean);
      if (!product) throw new Error(await explainFailure(page, 'Bu sitede ürün bilgisi bulunamadı'));

      const overall = offerPrice(product.offers);
      const variants = [].concat(product.hasVariant ?? []);
      const sizes = variants
        .map((v) => ({ name: v.size ?? v.name, ...offerPrice(v.offers) }))
        .filter((s) => s.name);
      return {
        title: product.name,
        color: product.color ?? null,
        image: firstImage(product.image) ?? (await ogImage(page)),
        price: overall.price ?? sizes.find((s) => s.price)?.price ?? null,
        sizes: sizes.length ? sizes : [{ name: 'Standart', available: overall.available, price: overall.price }],
      };
    });
  },
};
