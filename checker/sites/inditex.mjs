// Pull&Bear, Bershka, Stradivarius, Massimo Dutti, Oysho, Lefties, Zara Home: hepsi aynı altyapı
import { explainFailure, ogImage, open, poll, sleep, withPage } from '../browser.mjs';

const BRANDS = {
  'pullandbear.com': 'Pull&Bear',
  'bershka.com': 'Bershka',
  'stradivarius.com': 'Stradivarius',
  'massimodutti.com': 'Massimo Dutti',
  'oysho.com': 'Oysho',
  'lefties.com': 'Lefties',
  'zarahome.com': 'Zara Home',
};
const SIZE_TYPES = { short: 'Kısa boy', long: 'Uzun boy', petite: 'Petite', tall: 'Tall' };
const DETAIL = /\/itxrest\/2\/catalog\/store\/\d+\/\d+\/category\/0\/product\/(\d+)\/detail/;

const brandOf = (host) => Object.entries(BRANDS).find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1];

export default {
  name: 'Inditex',
  match: (host) => !!brandOf(host),

  async check(url, { browser }) {
    const params = new URL(url).searchParams;
    const wantedId = params.get('pelement') ?? params.get('productId');
    const wantedColor = params.get('cS') ?? params.get('colorId') ?? params.get('color');
    const details = new Map();

    return withPage(browser, url, async (page) => {
      page.on('response', async (res) => {
        const m = res.url().match(DETAIL);
        if (m && res.ok()) details.set(m[1], await res.json().catch(() => null));
      });
      await open(page, url);

      if (!(await poll(() => details.size > 0))) {
        throw new Error(await explainFailure(page, 'Ürün verisi okunamadı'));
      }
      await sleep(1000); // aynı anda gelen başka detay isteği varsa onu da bekle
      const product = (wantedId && details.get(wantedId)) || [...details.values()].find(Boolean);
      if (!product) throw new Error('Ürün verisi okunamadı');

      const colors = product.detail?.colors?.length
        ? product.detail.colors
        : (product.bundleProductSummaries?.find((b) => b.detail?.colors?.length)?.detail.colors ?? []);
      const color = colors.find((c) => String(c.id) === wantedColor) ?? colors[0];
      if (!color) throw new Error('Üründe renk/beden bilgisi yok');

      // Bazı ürünlerde (ör. Stradivarius jean) aynı ailedeki başka modellerin bedenleri de geliyor;
      // parça numarası rengin referansıyla başlayanlar bu ürüne ait
      const ref = color.reference?.replace(/^C/, '').replace(/-.*$/, '');
      const own = ref ? (color.sizes ?? []).filter((s) => s.partnumber?.startsWith(ref)) : [];
      const bySize = new Map();
      for (const s of own.length ? own : (color.sizes ?? [])) {
        const name = s.name + (SIZE_TYPES[s.sizeType] ? ` ${SIZE_TYPES[s.sizeType]}` : '');
        const size = {
          name,
          // SHOW = stokta, SOLD_OUT = tükendi, COMING_SOON = yakında
          available: s.visibilityValue === 'SHOW',
          price: Number(s.price) / 100,
        };
        const seen = bySize.get(name);
        bySize.set(name, seen ? { ...seen, available: seen.available || size.available } : size);
      }
      const sizes = [...bySize.values()];
      const oldPrices = own.concat(color.sizes ?? []).map((s) => Number(s.oldPrice) / 100).filter((p) => p > 0);
      return {
        title: product.name,
        color: color.name,
        image: await ogImage(page),
        price: Math.min(...sizes.map((s) => s.price).filter((p) => p > 0)),
        listPrice: oldPrices.length ? Math.max(...oldPrices) : null,
        sizes,
      };
    });
  },
};
