// Tek tek link denemek için: node checker/dene.mjs [--magaza] <link> [<link> ...]
import { createBrowser } from './browser.mjs';
import { adapterFor, checkProduct } from './sites/index.mjs';

const args = process.argv.slice(2);
const storeStock = args.includes('--magaza');
const browser = createBrowser();
for (const url of args.filter((a) => !a.startsWith('--'))) {
  const started = Date.now();
  try {
    const data = await checkProduct(url, { browser, storeStock });
    const sizes = data.sizes.map((s) => `${s.name}${s.available ? '✅' : '❌'}`).join(' ');
    console.log(`[${adapterFor(url).name}] ${data.title}${data.color ? ` (${data.color})` : ''}`);
    console.log(`   ${data.price} TL${data.listPrice ? ` (önce ${data.listPrice})` : ''} | ${sizes} | ${((Date.now() - started) / 1000).toFixed(1)} sn`);
    console.log(`   resim: ${data.image ? data.image.slice(0, 90) : 'YOK'}`);
    if (data.stores) console.log(`   mağazalar: ${data.stores.map((s) => `${s.name} [${s.sizes.map((z) => z.name).join(',')}]`).join(' · ') || 'hiçbirinde yok'}`);
  } catch (e) {
    console.log(`[${adapterFor(url).name}] HATA: ${e.message} | ${url}`);
  }
}
await browser.close();
