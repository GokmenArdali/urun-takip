// LC Waikiki: bedenler sayfadaki "new SingleSizeProduct(...)" / "new DoubleSizeProduct(...)" satırlarında
//   SingleSizeProduct(renk, ürün, bedenId, beden, sıra, stok, fiyat, ?, eskiFiyat, ...)
//   DoubleSizeProduct(renk, ürün, bel Id, bel, sıra, boy Id, boy, sıra, stok, fiyat, ?, eskiFiyat, ...)
import { firstImage, ldProductFromHtml, metaContent, pageHtml, trPrice } from './http.mjs';

function parseArgs(raw) {
  return [...raw.matchAll(/'([^']*)'|(-?\d+(?:\.\d+)?)/g)].map((m) => m[1] ?? Number(m[2]));
}

export default {
  name: 'LC Waikiki',
  match: (host) => /(^|\.)lcw\.com$/.test(host) || /(^|\.)lcwaikiki\.com$/.test(host),

  async check(url, { browser }) {
    const html = await pageHtml(url, browser);
    const optionId = Number(url.match(/-o-(\d+)/)?.[1]);
    const sizes = [];
    let listPrice = null;
    for (const m of html.matchAll(/new (Single|Double)SizeProduct\(([^)]*)\)/g)) {
      const a = parseArgs(m[2]);
      if (optionId && a[0] !== optionId) continue;
      const [name, stock, price, oldPrice] =
        m[1] === 'Single' ? [a[3], a[5], a[6], a[8]] : [`${a[3]}/${a[6]}`, a[8], a[9], a[11]];
      sizes.push({ name: String(name), available: Number(stock) > 0, price: trPrice(price) });
      if (trPrice(oldPrice) > trPrice(price)) listPrice = trPrice(oldPrice);
    }
    const ld = ldProductFromHtml(html);
    if (!sizes.length && !ld) throw new Error('LC Waikiki ürün verisi okunamadı');

    const offers = [].concat(ld?.offers ?? []);
    const ldPrice = trPrice(offers[0]?.price ?? offers[0]?.lowPrice);
    return {
      title: ld?.name ?? metaContent(html, 'og:title'),
      color: ld?.color ?? null,
      image: firstImage(ld?.image) ?? metaContent(html, 'og:image'),
      price: sizes.length ? Math.min(...sizes.map((s) => s.price).filter((p) => p > 0)) : ldPrice,
      listPrice,
      sizes: sizes.length
        ? sizes
        : [{ name: 'Standart', available: offers.some((o) => /InStock/i.test(o.availability ?? '')), price: ldPrice }],
    };
  },
};
