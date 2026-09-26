// Boyner: ürün detayı sayfanın içindeki Next.js verisinde (beden bazında stok adediyle)
import { metaContent, nextData, pageHtml, trPrice } from './http.mjs';

export default {
  name: 'Boyner',
  match: (host) => /(^|\.)boyner\.com\.tr$/.test(host),

  async check(url, { browser }) {
    const html = await pageHtml(url, browser);
    const data = nextData(html);
    const queries = data?.props?.pageProps?.initialState?.dsListingDetailService?.queries ?? {};
    const detail = Object.entries(queries).find(([key]) => key.startsWith('getProductDetail'))?.[1]?.data;
    if (!detail) throw new Error('Boyner ürün verisi okunamadı');

    const price = trPrice(detail.PriceInfo?.Price);
    const oldPrice = trPrice(detail.PriceInfo?.OldPrice);
    const variants = detail.Variants ?? [];
    return {
      title: [detail.Brand?.Name ?? detail.Brand?.name, detail.DisplayName].filter(Boolean).join(' '),
      color: null,
      image: Object.values(detail.Medias?.[0] ?? {}).find((v) => typeof v === 'string' && /^https?:/.test(v)) ?? metaContent(html, 'og:image'),
      price,
      listPrice: oldPrice > price ? oldPrice : null,
      sizes: variants.length
        ? variants.map((v) => ({ name: v.Name, available: v.StockInfoType !== 'NoStock' && v.StockCount !== 0, price }))
        : [{ name: 'Standart', available: !detail.ExtraInfos?.IsOutOfStock, price }],
    };
  },
};
