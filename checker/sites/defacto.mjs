// DeFacto: beden stokları sayfadaki PRODUCT_DETAIL_SIZE_DATA değişkeninde, fiyat schema.org bloğunda
import { explainFailure, ldJsonTexts, ogImage, open, poll, withPage } from '../browser.mjs';
import { findLdProduct, firstImage, trPrice } from './http.mjs';

export default {
  name: 'DeFacto',
  match: (host) => /(^|\.)defacto\.com\.tr$/.test(host),

  async check(url, { browser }) {
    return withPage(browser, url, async (page) => {
      await open(page, url);
      const sizeData = await poll(() => page.evaluate(() => (Array.isArray(window.PRODUCT_DETAIL_SIZE_DATA) ? window.PRODUCT_DETAIL_SIZE_DATA : null)));
      const ld = (await ldJsonTexts(page))
        .map((t) => {
          try {
            return findLdProduct(JSON.parse(t));
          } catch {
            return null;
          }
        })
        .find(Boolean);
      if (!sizeData && !ld) throw new Error(await explainFailure(page, 'DeFacto ürün verisi okunamadı'));

      const offers = [].concat(ld?.offers ?? []);
      const price = trPrice(offers[0]?.price ?? offers[0]?.lowPrice);
      const sizes = (sizeData ?? []).map((s) => ({
        name: s.Length ? `${s.Size}/${s.Length}` : s.Size,
        available: s.StockQuantity > 0,
        price,
      }));
      return {
        title: ld?.name ?? (await page.title()),
        color: ld?.color ?? null,
        image: firstImage(ld?.image) ?? (await ogImage(page)),
        price,
        sizes: sizes.length ? sizes : [{ name: 'Standart', available: offers.some((o) => /InStock/i.test(o.availability ?? '')), price }],
      };
    });
  },
};
