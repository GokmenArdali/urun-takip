// FashFed, Koton ve Akinon altyapısını kullanan diğer siteler: ürün sayfası ?format=json ile hazır veri veriyor,
// tarayıcı açmaya gerek yok.
import { fetchJson } from './http.mjs';

export async function fetchAkinon(url) {
  const u = new URL(url);
  u.searchParams.set('format', 'json');
  const data = await fetchJson(u);
  if (!data?.product) throw new Error('Ürün verisi bulunamadı');
  return data;
}

export function parseAkinon(data) {
  const attr = (re) => data.variants?.find((v) => re.test(`${v.attribute_key} ${v.attribute_name}`));
  const sizeAttr = attr(/beden|size|numara/i);
  const colorAttr = attr(/renk|color/i);
  const price = Number(data.product.price);
  const retail = Number(data.product.retail_price);
  return {
    title: data.product.name,
    color: colorAttr?.options?.find((o) => o.is_selected)?.label ?? null,
    image: data.product.productimage_set?.[0]?.image ?? null,
    price,
    listPrice: retail > price ? retail : null,
    sizes: sizeAttr
      ? sizeAttr.options.map((o) => ({
          name: o.label,
          available: !!o.in_stock,
          price: Number(o.product?.price ?? price),
        }))
      : [{ name: 'Standart', available: !!data.in_stock, price }],
  };
}

export default {
  name: 'Akinon',
  match: (host) => /(^|\.)(fashfed|koton)\.com$/.test(host),
  async check(url) {
    return parseAkinon(await fetchAkinon(url));
  },
};
