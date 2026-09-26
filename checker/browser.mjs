// Gerçek Chrome'u açar ve her site için ayrı bir oturum (çerezler) tutar.
// Bot koruması ilk sayfada geçildikten sonra aynı sitenin diğer ürünleri daha hızlı açılır.
import { chromium } from 'playwright';

// Resim, video ve font indirmeye gerek yok: sayfalar daha hızlı açılır
const BLOCKED_TYPES = new Set(['image', 'media', 'font']);
const HEADLESS = process.env.HEADLESS === '1';

export function createBrowser() {
  let browserPromise = null;
  const contexts = new Map();

  function launch() {
    browserPromise ??= chromium.launch({
      headless: HEADLESS,
      channel: process.env.CHROME_CHANNEL || 'chrome',
      args: ['--disable-blink-features=AutomationControlled'],
    });
    return browserPromise;
  }

  async function context(host) {
    if (!contexts.has(host)) {
      contexts.set(
        host,
        launch().then(async (browser) => {
          const ctx = await browser.newContext({
            locale: 'tr-TR',
            timezoneId: 'Europe/Istanbul',
            viewport: { width: 1366, height: 768 },
            // Mağaza stoğu gibi konuma göre çalışan özellikler için İstanbul
            geolocation: { latitude: 41.0082, longitude: 28.9784 },
            permissions: ['geolocation'],
          });
          await ctx.route('**/*', (route) =>
            BLOCKED_TYPES.has(route.request().resourceType()) ? route.abort() : route.continue(),
          );
          return ctx;
        }),
      );
    }
    return contexts.get(host);
  }

  return {
    async newPage(url) {
      return (await context(new URL(url).host)).newPage();
    },
    async close() {
      if (browserPromise) await (await browserPromise).close().catch(() => {});
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fn gerçek bir değer döndürene kadar tekrar dener (sayfa yeniden yüklenirken çıkan hataları yutar)
export async function poll(fn, { timeout = 30000, interval = 500 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {}
    await sleep(interval);
  }
  return null;
}

// Sayfayı açar, iş bitince kapatır
export async function withPage(browser, url, fn) {
  const page = await browser.newPage(url);
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

export async function open(page, url) {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (res?.status() === 404 || res?.status() === 410) throw new Error('Ürün sayfası bulunamadı (kaldırılmış olabilir)');
}

export async function ogImage(page) {
  return page
    .evaluate(() => document.querySelector('meta[property="og:image"]')?.content || null)
    .catch(() => null);
}

// Sayfadaki schema.org ürün bloklarının metinleri
export async function ldJsonTexts(page) {
  return page
    .$$eval('script[type="application/ld+json"]', (els) => els.map((e) => e.textContent))
    .catch(() => []);
}

// Veri okunamadığında nedenini tahmin eder
export async function explainFailure(page, fallback) {
  const title = await page.title().catch(() => '');
  if (/access denied|captcha|robot|forbidden/i.test(title)) return 'Site erişimi engelledi';
  return fallback;
}
