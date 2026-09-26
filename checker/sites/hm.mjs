// H&M: bedenler sayfanın Next.js verisinde, stok ayrı bir servisten geliyor (sayfa açılırken yakalanır)
//   link: /tr_tr/productpage.<makale kodu>.html
import { explainFailure, ogImage, open, poll, withPage } from '../browser.mjs';
import { trPrice } from './http.mjs';

const absolute = (u) => (u ? (u.startsWith('//') ? `https:${u}` : u) : null);

export default {
  name: 'H&M',
  match: (host) => /(^|\.)hm\.com$/.test(host),

  async check(url, { browser }) {
    const article = url.match(/productpage\.(\d+)\.html/)?.[1];
    let available = null;

    return withPage(browser, url, async (page) => {
      page.on('response', async (res) => {
        if (/pdh-availability\/.*\/availability\//.test(res.url()) && res.ok()) {
          const data = await res.json().catch(() => null);
          if (data?.availability) available = new Set(data.availability);
        }
      });
      await open(page, url);

      const details = await poll(() =>
        page.evaluate(() => {
          const el = document.getElementById('__NEXT_DATA__');
          return el ? JSON.parse(el.textContent).props?.pageProps?.productPageProps ?? null : null;
        }),
      );
      const variations = details?.aemData?.productArticleDetails?.variations ?? {};
      const code = article && variations[article] ? article : details?.articleCode;
      const variant = variations[code];
      if (!variant) throw new Error(await explainFailure(page, 'H&M ürün verisi okunamadı'));

      await poll(() => available, { timeout: 8000 });
      const ssr = details.ssrAvailability?.availability;
      const inStock = available ?? (ssr ? new Set(ssr) : null);
      const price = trPrice(variant.redPriceValue ?? variant.whitePriceValue ?? variant.whitePrice);
      const white = trPrice(variant.whitePriceValue);
      const title = (await page.title()).replace(/\s*[|-]\s*H&M.*$/i, '').trim();

      return {
        title: details.aemData.productArticleDetails.productName ?? title,
        color: variant.name ?? null,
        image: absolute(variant.images?.[0]?.image ?? variant.images?.[0]?.baseUrl) ?? (await ogImage(page)),
        price,
        listPrice: white > price ? white : null,
        sizes: (variant.sizes ?? []).map((s) => ({
          name: s.name,
          available: inStock ? inStock.has(s.sizeCode) : true,
          price,
        })),
      };
    });
  },
};
