// Mavi: site Cloudflare korumalı; ürün verisi ayrı bir servisten (SAP Commerce) gelir. Node.js isteği reddedildiği için
// servis gerçek Chrome'da açılıp JSON olarak çekilir. Link: /<ad>/p/<ürün kodu>  ör. /siyah-orme-interlok-pantolon/p/0010489-900
import { explainFailure, poll, withPage } from '../browser.mjs';
import { fetchJson } from './http.mjs';

const API = 'https://p1-api.mavi.com/maviwebservices/v2/mavi/products';
const IN_STOCK = new Set(['inStock', 'lowStock']);

export default {
  name: 'Mavi',
  match: (host) => /(^|\.)mavi\.com$/.test(host),

  async check(url, { browser }) {
    const code = new URL(url).pathname.match(/\/p\/([A-Za-z0-9-]+)/)?.[1];
    if (!code) throw new Error('Linkte Mavi ürün kodu bulunamadı');
    const api = `${API}/${encodeURIComponent(code)}?fields=FULL&lang=tr&curr=TRY`;
    // Cloudflare, Node.js'in bağlantısını (başlıklardan bağımsız) reddediyor; o zaman servis adresi gerçek Chrome'da açılır
    const d = await fetchJson(api, { headers: { Origin: 'https://www.mavi.com', Referer: 'https://www.mavi.com/' } }).catch(async (e) => {
      if (e.notFound) throw e;
      return withPage(browser, api, async (page) => {
        const res = await page.goto(api, { waitUntil: 'domcontentloaded', timeout: 45000 });
        if (res?.status() === 404 || res?.status() === 400) throw new Error('Ürün bulunamadı (kaldırılmış olabilir)');
        // Tarayıcıyla gidince servis XML döndürüyor; aynı sayfadan JSON isteyerek tekrar çekilir
        // (Cloudflare doğrulaması araya girerse birkaç kez denenir)
        const text = await poll(
          () =>
            page.evaluate(async (u) => {
              const r = await fetch(u, { headers: { Accept: 'application/json' } });
              const t = await r.text();
              return r.ok && t.trim().startsWith('{') ? t : null;
            }, api),
          { timeout: 25000, interval: 3000 },
        );
        if (!text) throw new Error(await explainFailure(page, `Mavi ürün verisi okunamadı (${res?.status()})`));
        return JSON.parse(text);
      });
    });

    const price = d.salePrice?.value ?? d.price?.value ?? null;
    const list = Math.max(d.price?.value ?? 0, d.priceRange?.maxPrice?.value ?? 0);
    const image = d.mainImage?.url ?? d.images?.[0]?.url ?? null;
    const variants = d.allSizeVariants ?? [];
    return {
      title: d.name,
      color: d.colour?.name ?? null,
      image: image ? (image.startsWith('//') ? `https:${image}` : image) : null,
      price,
      listPrice: list > price ? list : null,
      sizes: variants.length
        ? variants.map((v) => ({ name: v.size, available: IN_STOCK.has(v.stockLevelStatus), price }))
        : [{ name: 'Standart', available: IN_STOCK.has(d.stock?.stockLevelStatus), price }],
    };
  },
};
