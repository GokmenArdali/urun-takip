// Tarayıcısız okunabilen siteler için ortak yardımcılar
import { open, withPage } from '../browser.mjs';

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

class HttpError extends Error {
  constructor(status) {
    super(status === 404 || status === 410 ? 'Ürün sayfası bulunamadı (kaldırılmış olabilir)' : `Site yanıt vermedi (${status})`);
    this.status = status;
    this.notFound = status === 404 || status === 410;
  }
}

async function request(url, { headers = {}, accept, timeout = 20000 } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'tr-TR,tr;q=0.9', Accept: accept, ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new HttpError(res.status);
  return res;
}

export async function fetchText(url, opts) {
  return (await request(url, { accept: 'text/html,application/xhtml+xml', ...opts })).text();
}

export async function fetchJson(url, opts) {
  const res = await request(url, { accept: 'application/json', ...opts });
  if (!res.headers.get('content-type')?.includes('json')) throw new Error('Site beklenen veriyi vermedi');
  return res.json();
}

// Önce basit istekle dener; site engellerse (403 vb.) gerçek Chrome ile açıp sayfanın HTML'ini alır
export async function pageHtml(url, browser) {
  try {
    return await fetchText(url);
  } catch (e) {
    if (e.notFound) throw e;
    return withPage(browser, url, async (page) => {
      await open(page, url);
      await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
      return page.content();
    });
  }
}

export function nextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : null;
}

export function metaContent(html, property) {
  const re = new RegExp(`<meta[^>]+(?:property|name)="${property}"[^>]+content="([^"]*)"`, 'i');
  return decodeEntities(html.match(re)?.[1] ?? '') || null;
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// schema.org Product/ProductGroup bloğunu bulur
export function findLdProduct(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.map(findLdProduct).find(Boolean) ?? null;
  const type = [].concat(node['@type'] ?? []);
  if (type.includes('Product') || type.includes('ProductGroup')) return node;
  return findLdProduct(node['@graph']);
}

export function ldProductFromHtml(html) {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const product = findLdProduct(JSON.parse(m[1]));
      if (product) return product;
    } catch {}
  }
  return null;
}

export const firstImage = (image) => [].concat(image ?? [])[0]?.url ?? [].concat(image ?? [])[0] ?? null;

// "1.299,99" / "1299,99" / "1299.99" / 1299.99 -> 1299.99
export function trPrice(value) {
  if (typeof value === 'number') return value;
  let s = String(value ?? '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}(\.|$)/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
