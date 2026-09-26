// Fizibilite testi: sitelere gerçek bir tarayıcıyla girip fiyat/beden verisini okuyabiliyor muyuz?
// MODE=headless  -> görünmez Chromium
// MODE=headed    -> görünür Chrome (GitHub'da sanal ekran ile)
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const SITES = [
  ['zara', 'https://www.zara.com/tr/tr/teknik-relaxed-fit-ceket-p01437331.html?v1=552913140&v2=2536906'],
  ['pullandbear', 'https://www.pullandbear.com/tr/kapusonlu-hafif-yagmurluk-l07720504?cS=800&pelement=748862861'],
  ['fashfed', 'https://www.fashfed.com/urun/calvin-klein-cotton-nylon-varisty-bomber-erkek-siyah-ceket-lv04rd400g-3/?seller_id=1'],
];

const MODE = process.env.MODE || 'headless';
const CHANNEL = process.env.CHANNEL || undefined; // 'chrome' = yüklü Google Chrome
const OUT = process.env.OUT || `results/local-${MODE}`;

const browser = await chromium.launch({
  headless: MODE !== 'headed',
  channel: CHANNEL,
  args: ['--disable-blink-features=AutomationControlled'],
});
const platform = process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
const userAgent = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`;

await fs.mkdir(OUT, { recursive: true });
const summary = [];

for (const [name, url] of SITES) {
  const context = await browser.newContext({
    userAgent,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();

  // Sayfanın arka planda çektiği ürün verisini (JSON) yakala
  const captures = [];
  page.on('response', async (res) => {
    const type = res.headers()['content-type'] || '';
    if (!type.includes('json') || !/product|availability|detail|stock/i.test(res.url())) return;
    try {
      captures.push({ url: res.url(), status: res.status(), body: (await res.text()).slice(0, 50000) });
    } catch {}
  });

  const started = Date.now();
  let status = null;
  let error = null;
  try {
    status = (await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }))?.status() ?? null;
  } catch (e) {
    error = e.message.split('\n')[0];
  }
  // Bot doğrulaması sayfayı yeniden yükleyebilir, ürün verisi de sonradan gelir
  await page.waitForTimeout(15000);

  const html = await page.content().catch(() => '');
  const title = await page.title().catch(() => '');
  const jsonLd = await page
    .$$eval('script[type="application/ld+json"]', (els) => els.map((e) => e.textContent.slice(0, 10000)))
    .catch(() => []);
  const zaraPayload = await page
    .evaluate(() => {
      const p = window.zara?.viewPayload?.product;
      return p ? JSON.stringify(p).slice(0, 60000) : null;
    })
    .catch(() => null);
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 8000) ?? '').catch(() => '');

  const result = {
    site: name,
    mode: MODE,
    channel: CHANNEL ?? 'chromium',
    httpStatus: status,
    error,
    seconds: Math.round((Date.now() - started) / 1000),
    title,
    htmlLength: html.length,
    looksBlocked: /bm-verify|interstitial|Access Denied|captcha/i.test(html) && html.length < 30000,
    jsonLdCount: jsonLd.length,
    hasZaraPayload: !!zaraPayload,
    jsonCaptures: captures.map((c) => `${c.status} ${c.url.slice(0, 160)}`),
  };
  summary.push(result);
  console.log(JSON.stringify(result, null, 2));

  await fs.writeFile(`${OUT}/${name}-data.json`, JSON.stringify({ jsonLd, zaraPayload, captures, text }, null, 2));
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 50 }).catch(() => {});
  await context.close();
}

await fs.writeFile(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
await browser.close();
