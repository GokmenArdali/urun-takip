// Nike: ürün ve fiyat sayfadaki Next.js verisinde, beden stoğu Nike'ın ayrı servisinde
//   link: /tr/t/<ad>-<grupKodu>/<renkKodu>
import { fetchJson, metaContent, nextData, pageHtml } from './http.mjs';

// Nike Türkiye web mağazasının sabit kanal kimliği
const CHANNEL = 'd9a5bc42-4b9c-4976-858a-f159cf99c647';

export default {
  name: 'Nike',
  match: (host) => /(^|\.)nike\.com$/.test(host),

  async check(url, { browser }) {
    const path = new URL(url).pathname;
    const [, slug, styleFromUrl] = path.match(/\/t\/([^/]+)(?:\/([A-Z0-9]+-[A-Z0-9]+))?/i) ?? [];
    const html = await pageHtml(url, browser);
    const data = nextData(html);
    const group = data?.props?.pageProps?.productGroups?.[0];
    if (!group) throw new Error('Nike ürün verisi okunamadı');

    const products = group.products ?? {};
    const style = styleFromUrl && products[styleFromUrl] ? styleFromUrl : Object.keys(products)[0];
    const product = products[style];
    if (!product) throw new Error('Üründe renk/beden bilgisi yok');

    const groupKey = slug?.split('-').pop();
    let availability = new Map();
    if (groupKey) {
      const live = await fetchJson(
        `https://api.nike.com/discover/product_details_availability/v1/marketplace/TR/language/tr/consumerChannelId/${CHANNEL}/groupKey/${groupKey}`,
        { headers: { Origin: 'https://www.nike.com', Referer: 'https://www.nike.com/' } },
      ).catch(() => null);
      availability = new Map((live?.sizes ?? []).map((s) => [`${s.productCode}|${s.label}`, !!s.availability?.isAvailable]));
    }

    const price = product.prices?.currentPrice ?? null;
    const initial = product.prices?.initialPrice ?? null;
    return {
      title: product.productInfo?.fullTitle ?? product.productInfo?.title,
      color: product.colorDescription ?? null,
      image: metaContent(html, 'og:image'),
      price,
      listPrice: initial > price ? initial : null,
      colors: Object.entries(products).map(([code, p]) => ({
        name: p.colorDescription ?? code,
        current: code === style,
        sizes: (p.sizes ?? []).map((s) => ({
          name: s.localizedLabel ?? s.label,
          available: availability.size ? !!availability.get(`${code}|${s.label}`) : s.status === 'ACTIVE',
        })),
      })),
      sizes: (product.sizes ?? []).map((s) => ({
        name: s.localizedLabel ?? s.label,
        // Canlı stok alınamazsa sayfadaki durum kullanılır
        available: availability.size ? !!availability.get(`${style}|${s.label}`) : s.status === 'ACTIVE',
        price,
      })),
    };
  },
};
