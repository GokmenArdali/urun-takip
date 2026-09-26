import { explainFailure, open, poll, withPage } from '../browser.mjs';

const prop = (variant, predicate) => variant.properties?.find(predicate)?.valueObject?.actualValue ?? null;
const isColor = (p) => /renk|color/i.test(p.name);

export default {
  name: 'Hepsiburada',
  match: (host) => /(^|\.)hepsiburada\.com$/.test(host),

  async check(url, { browser }) {
    return withPage(browser, url, async (page) => {
      await open(page, url);
      const product = await poll(() =>
        page.evaluate(() => {
          const el = document.getElementById('reduxStore');
          return el ? (JSON.parse(el.textContent).productState?.product ?? null) : null;
        }),
      );
      if (!product) throw new Error(await explainFailure(page, 'Hepsiburada ürün verisi okunamadı'));

      const price = product.prices?.[0]?.value ?? null;
      const variants = product.variants ?? [];
      const current = variants.find((v) => v.sku === product.sku);
      const color = current ? prop(current, isColor) : null;
      // Sadece linkteki ürünle aynı renkteki bedenler
      const sameColor = color ? variants.filter((v) => prop(v, isColor) === color) : variants;
      const sizes = sameColor
        .map((v) => ({
          name: prop(v, (p) => !isColor(p)),
          available: !!v.isInStock,
          price: v.sku === product.sku ? price : v.price,
        }))
        .filter((s) => s.name);

      return {
        title: [product.brand, product.name].filter(Boolean).join(' '),
        color,
        price,
        sizes: sizes.length ? sizes : [{ name: 'Standart', available: !!product.isInStock, price }],
      };
    });
  },
};
