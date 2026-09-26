// Mango: sitenin kendi veri servisleri tarayıcısız okunabiliyor (ürün, stok, fiyat ayrı ayrı)
import { fetchJson } from './http.mjs';

const API = 'https://online-orchestrator.mango.com';
const HEADERS = { Origin: 'https://shop.mango.com', Referer: 'https://shop.mango.com/' };

export default {
  name: 'Mango',
  match: (host) => /(^|\.)mango\.com$/.test(host),

  async check(url) {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    const id = path.match(/(\d{8})/)?.[1];
    if (!id) throw new Error('Linkte Mango ürün numarası bulunamadı');
    const wantedColor = u.searchParams.get('c') ?? path.match(/\d{8}\/([A-Z0-9]{2})(?:\/|$)/)?.[1];

    const q = `countryIso=TR&channelId=shop&productId=${id}`;
    const [product, stock, prices] = await Promise.all([
      fetchJson(`${API}/v4/products?${q}&languageIso=tr`, { headers: HEADERS }),
      fetchJson(`${API}/v3/stock/products?${q}`, { headers: HEADERS }),
      fetchJson(`${API}/v3/prices/products?${q}`, { headers: HEADERS }),
    ]);
    const color = product.colors?.find((c) => c.id === wantedColor) ?? product.colors?.[0];
    if (!color) throw new Error('Üründe renk/beden bilgisi yok');

    const colorStock = stock.colors?.[color.id]?.sizes ?? {};
    const priceInfo = prices[color.id] ?? Object.values(prices)[0] ?? {};
    const price = priceInfo.price ?? null;
    const previous = [].concat(priceInfo.previousPrices ?? priceInfo.crossedOutPrices ?? []).map(Number).filter((p) => p > price);
    const images = color.looks?.['00']?.images ?? Object.values(color.looks ?? {})[0]?.images ?? {};
    const img = (images.O1 ?? images.F ?? Object.values(images)[0])?.img;

    return {
      title: product.name,
      color: color.label,
      image: img ? `${product.assetsDomain ?? 'https://media.mango.com'}${img}?wid=600` : null,
      price,
      listPrice: previous.length ? Math.max(...previous) : null,
      sizes: (color.sizes ?? []).map((s) => ({
        name: s.label ?? s.shortDescription ?? s.id,
        available: !!colorStock[s.id]?.available,
        price,
      })),
    };
  },
};
