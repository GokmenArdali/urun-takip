// FashFed ve Akinon altyapısını kullanan diğer siteler: ürün sayfası ?format=json ile hazır veri veriyor,
// tarayıcı açmaya gerek yok.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export async function fetchAkinon(url) {
  const u = new URL(url);
  u.searchParams.set('format', 'json');
  const res = await fetch(u, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Accept-Language': 'tr-TR' },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) throw new Error('Ürün sayfası bulunamadı (kaldırılmış olabilir)');
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) throw new Error(`Site yanıt vermedi (${res.status})`);
  const data = await res.json();
  if (!data?.product) throw new Error('Ürün verisi bulunamadı');
  return data;
}

export function parseAkinon(data) {
  const attr = (re) => data.variants?.find((v) => re.test(`${v.attribute_key} ${v.attribute_name}`));
  const sizeAttr = attr(/beden|size|numara/i);
  const colorAttr = attr(/renk|color/i);
  const price = Number(data.product.price);
  return {
    title: data.product.name,
    color: colorAttr?.options?.find((o) => o.is_selected)?.label ?? null,
    price,
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
  match: (host) => /(^|\.)fashfed\.com$/.test(host),
  async check(url) {
    return parseAkinon(await fetchAkinon(url));
  },
};
