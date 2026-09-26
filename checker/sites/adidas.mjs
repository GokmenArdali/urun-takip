// Adidas: sayfa açılırken ürün detayı ve beden stokları ayrı servislerden gelir, ikisini de yakalıyoruz
//   link: /tr/<ad>/<ÜRÜN KODU>.html
import { explainFailure, ogImage, open, poll, withPage } from '../browser.mjs';

export default {
  name: 'Adidas',
  match: (host) => /(^|\.)adidas\.com\.tr$/.test(host),

  async check(url, { browser }) {
    const id = new URL(url).pathname.match(/\/([A-Z0-9]{6})\.html/i)?.[1]?.toUpperCase();
    if (!id) throw new Error('Linkte Adidas ürün kodu bulunamadı');
    let detail = null;
    let availability = null;

    return withPage(browser, url, async (page) => {
      page.on('response', async (res) => {
        const u = res.url();
        if (!res.ok()) return;
        if (u.includes(`/gw/prd/details/${id}/detail`)) detail = await res.json().catch(() => null);
        if (u.includes(`/api/products/${id}/cached/availability`)) availability = await res.json().catch(() => null);
      });
      await open(page, url);
      await poll(() => detail && availability);
      if (!detail) throw new Error(await explainFailure(page, 'Adidas ürün verisi okunamadı'));

      const prices = (detail.pricing?.info ?? []).map((p) => p.value).filter((p) => p > 0);
      const price = prices.length ? Math.min(...prices) : (detail.original_price ?? null);
      const original = detail.original_price ?? Math.max(...prices, 0);
      const variations = availability?.variation_list ?? [];
      return {
        title: detail.product_name,
        color: detail.color ?? null,
        image: await ogImage(page),
        price,
        listPrice: original > price ? original : null,
        sizes: variations.length
          ? variations.map((v) => ({ name: v.size, available: v.availability_status === 'IN_STOCK', price }))
          : [{ name: 'Standart', available: availability?.availability_status === 'IN_STOCK', price }],
      };
    });
  },
};
