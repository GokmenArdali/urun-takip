import { explainFailure, open, poll, withPage } from '../browser.mjs';

export default {
  name: 'Trendyol',
  match: (host) => /(^|\.)trendyol\.com$/.test(host) || host === 'ty.gl',

  async check(url, { browser }) {
    return withPage(browser, url, async (page) => {
      await open(page, url);
      const product = await poll(() => page.evaluate(() => window.__envoy__SHARED_PROPS?.product ?? null));
      if (!product) throw new Error(await explainFailure(page, 'Trendyol ürün verisi okunamadı'));

      const p = product.merchantListing?.winnerVariant?.price;
      const price = p?.discountedPrice?.value ?? p?.sellingPrice?.value ?? null;
      const original = p?.originalPrice?.value ?? null;
      const first = product.images?.[0];
      const image = typeof first === 'string' ? first : (first?.url ?? null);
      const variants = product.variants ?? [];
      return {
        title: [product.brand?.name, product.name].filter(Boolean).join(' '),
        color: null,
        image: image ? (image.startsWith('http') ? image : `https://cdn.dsmcdn.com${image}`) : null,
        price,
        listPrice: original > price ? original : null,
        sizes: variants.length
          ? variants.map((v) => ({ name: v.value, available: !!v.inStock, price }))
          : [{ name: 'Standart', available: !!product.inStock, price }],
      };
    });
  },
};
