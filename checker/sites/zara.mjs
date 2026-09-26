import { explainFailure, open, poll, withPage } from '../browser.mjs';

const IN_STOCK = new Set(['in_stock', 'low_on_stock']);

export default {
  name: 'Zara',
  match: (host) => /(^|\.)zara\.com$/.test(host),

  async check(url, { browser }) {
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

      return {
        title: product.name,
        color: color.name,
        price: color.price / 100,
        sizes: (color.sizes ?? []).map((s) => ({
          name: s.name.replace(/\s*\(.*\)\s*$/, ''),
          available: IN_STOCK.has(liveBySku.get(s.sku) ?? s.availability),
          price: (s.price ?? color.price) / 100,
        })),
      };
    });
  },
};
