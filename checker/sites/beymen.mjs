// Beymen: sayfa açılırken çekilen "productsummary" verisinde fiyat, renk ve bedenler var
//   link: /tr/p_<ad>_<ürün no>
import { explainFailure, ogImage, open, poll, withPage } from '../browser.mjs';

const sizeName = (s) => s.name ?? s.value ?? s.size ?? s.sizeName ?? s.displayName ?? s.variantName ?? s.text;
const sizeInStock = (s) =>
  s.isOutOfStock === false || s.isAvailable === true || s.inStock === true || s.hasStock === true || Number(s.stockQuantity ?? s.stock) > 0;

export default {
  name: 'Beymen',
  match: (host) => /(^|\.)beymen\.com$/.test(host),

  async check(url, { browser }) {
    const id = url.match(/_(\d{5,})(?:[/?#]|$)/)?.[1];
    let summary = null;

    return withPage(browser, url, async (page) => {
      page.on('response', async (res) => {
        const m = res.url().match(/\/product\/(\d+)\/productsummary/);
        if (m && res.ok() && (!id || m[1] === id)) summary = (await res.json().catch(() => null))?.result ?? summary;
      });
      await open(page, url);
      await poll(() => summary);
      if (!summary) throw new Error(await explainFailure(page, 'Beymen ürün verisi okunamadı'));

      const price = summary.promotedOrActualPrice ?? summary.actualPrice ?? null;
      const original = summary.originalPrice || null;
      const sizes = (summary.sizes ?? []).filter((s) => sizeName(s));
      return {
        title: [summary.brandName, summary.displayName].filter(Boolean).join(' '),
        color: summary.color ?? null,
        image: summary.image?.replace('{width}', '600').replace('{height}', '800') ?? (await ogImage(page)),
        price,
        listPrice: original > price ? original : null,
        sizes: sizes.length
          ? sizes.map((s) => ({ name: String(sizeName(s)), available: sizeInStock(s), price }))
          : [{ name: 'Standart', available: !summary.isOutOfStock, price }],
      };
    });
  },
};
