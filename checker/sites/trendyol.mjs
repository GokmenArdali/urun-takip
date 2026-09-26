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
      const variants = product.variants ?? [];
      return {
        title: [product.brand?.name, product.name].filter(Boolean).join(' '),
        color: null,
        price,
        sizes: variants.length
          ? variants.map((v) => ({ name: v.value, available: !!v.inStock, price }))
          : [{ name: 'Standart', available: !!product.inStock, price }],
      };
    });
  },
};
