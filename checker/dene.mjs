// Tek tek link denemek için: node checker/dene.mjs <link> [<link> ...]
import { createBrowser } from './browser.mjs';
import { adapterFor, checkProduct } from './sites/index.mjs';

const browser = createBrowser();
for (const url of process.argv.slice(2)) {
  const started = Date.now();
  try {
    const data = await checkProduct(url, { browser });
    const sizes = data.sizes.map((s) => `${s.name}${s.available ? '✅' : '❌'}`).join(' ');
    console.log(`[${adapterFor(url).name}] ${data.title}${data.color ? ` (${data.color})` : ''}`);
    console.log(`   ${data.price} TL | ${sizes} | ${((Date.now() - started) / 1000).toFixed(1)} sn`);
  } catch (e) {
    console.log(`[${adapterFor(url).name}] HATA: ${e.message} | ${url}`);
  }
}
await browser.close();
