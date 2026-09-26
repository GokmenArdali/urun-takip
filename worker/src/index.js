// Cloudflare Worker: web paneli, panel API'si, kontrol programının API'si ve 5 dakikalık zamanlayıcı.
import PANEL_HTML from './panel.html';

const FAST_MS = 4.5 * 60_000; // "hızlı" ürünler ~5 dakikada bir
const NORMAL_MS = 14.5 * 60_000; // diğerleri ~15 dakikada bir
const DISPATCH_DEBOUNCE_MS = 60_000;
const MAX_WATCHES_PER_PERSON = 50;
const MAX_WATCHES = 500;

const SITES = [
  ['zara.com', 'Zara'],
  ['pullandbear.com', 'Pull&Bear'],
  ['bershka.com', 'Bershka'],
  ['stradivarius.com', 'Stradivarius'],
  ['massimodutti.com', 'Massimo Dutti'],
  ['oysho.com', 'Oysho'],
  ['lefties.com', 'Lefties'],
  ['zarahome.com', 'Zara Home'],
  ['trendyol.com', 'Trendyol'],
  ['ty.gl', 'Trendyol'],
  ['hepsiburada.com', 'Hepsiburada'],
  ['fashfed.com', 'FashFed'],
];
const TRACKING_PARAMS = /^(utm_.*|gclid|gbraid|wbraid|fbclid|yclid|msclkid|mc_.*|_ga|ref|referrer|boutiqueId|sav|adjust_.*)$/i;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Sunucu hatası' }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(dispatchIfDue(env));
  },
};

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;

  if (route === 'GET /') {
    return new Response(PANEL_HTML, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  if (url.pathname.startsWith('/api/checker/')) {
    await requireToken(request, env);
    if (route === 'GET /api/checker/jobs') return checkerJobs(env, url.searchParams.get('all') === '1');
    if (route === 'POST /api/checker/results') return checkerResults(request, env);
    throw new HttpError(404, 'Bulunamadı');
  }

  if (route === 'POST /api/login') return login(request, env);
  if (route === 'POST /api/logout') return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });

  await requireSession(request, env);
  if (route === 'GET /api/watches') return listWatches(env, contactOf(url));
  if (route === 'POST /api/watches') return addWatch(request, env, ctx);
  if (route === 'GET /api/status') return status(env);
  const del = request.method === 'DELETE' && url.pathname.match(/^\/api\/watches\/(\d+)$/);
  if (del) return deleteWatch(env, Number(del[1]), contactOf(url));
  throw new HttpError(404, 'Bulunamadı');
}

// ---------- Giriş ----------

async function login(request, env) {
  const { password } = await readJson(request);
  if (!env.PANEL_PASSWORD || !safeEqual(String(password ?? ''), env.PANEL_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 700)); // tahmin denemelerini yavaşlat
    throw new HttpError(401, 'Şifre yanlış');
  }
  return json({ ok: true }, 200, { 'set-cookie': cookie(await sessionValue(env), 180 * 24 * 3600) });
}

function cookie(value, maxAge) {
  return `oturum=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

// Şifre değişirse eski oturumlar geçersiz olur
async function sessionValue(env) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${env.PANEL_PASSWORD}:${env.API_TOKEN}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('panel-oturumu'));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function requireSession(request, env) {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)oturum=([a-f0-9]+)/)?.[1];
  if (!value || !env.PANEL_PASSWORD || !safeEqual(value, await sessionValue(env))) {
    throw new HttpError(401, 'Giriş yapmalısın');
  }
}

async function requireToken(request, env) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!env.API_TOKEN || !safeEqual(token, env.API_TOKEN)) throw new HttpError(401, 'Yetkisiz');
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ---------- Panel API ----------

function contactOf(url) {
  return {
    email: url.searchParams.get('email')?.trim().toLowerCase() || null,
    ntfy: url.searchParams.get('ntfy')?.trim() || null,
  };
}

const isMine = (w, c) => (c.email && w.email === c.email) || (c.ntfy && w.ntfy === c.ntfy);

async function listWatches(env, contact) {
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.owner, w.email, w.ntfy, w.sizes, w.target_price, w.fast, w.state, w.created_at,
            p.id AS product_id, p.url, p.site, p.title, p.color, p.price, p.sizes AS product_sizes,
            p.last_checked, p.fail_count, p.last_error
     FROM watches w JOIN products p ON p.id = w.product_id
     ORDER BY w.created_at DESC`,
  ).all();
  // Başkalarının e-posta/ntfy bilgisi panele gönderilmez
  const watches = results.map(({ email, ntfy, ...w }) => ({
    ...w,
    mine: !!isMine({ email, ntfy }, contact),
    sizes: parse(w.sizes, []),
    product_sizes: parse(w.product_sizes, null),
    state: parse(w.state, null),
    fast: !!w.fast,
  }));
  return json({ watches });
}

async function addWatch(request, env, ctx) {
  const body = await readJson(request);
  const url = normalizeUrl(body.url);
  const owner = text(body.owner, 'Adın', 1, 40);
  const email = body.email ? text(body.email, 'E-posta', 5, 120).toLowerCase() : null;
  const ntfy = body.ntfy ? text(body.ntfy, 'ntfy konusu', 6, 64) : null;
  if (!email && !ntfy) throw new HttpError(400, 'Bildirim için e-posta ya da ntfy konusu gir');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'E-posta adresi geçersiz');
  if (ntfy && !/^[A-Za-z0-9_-]+$/.test(ntfy)) throw new HttpError(400, 'ntfy konusu sadece harf, rakam, - ve _ içerebilir');

  const sizes = (Array.isArray(body.sizes) ? body.sizes : String(body.sizes ?? '').split(/[,;/]+/))
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (sizes.length > 10 || sizes.some((s) => s.length > 20)) throw new HttpError(400, 'Bedenler çok uzun');
  const target = parsePrice(body.target_price);
  if (target != null && !(target > 0 && target < 10_000_000)) throw new HttpError(400, 'Hedef fiyat geçersiz');

  const contactWhere = '(email IS NOT NULL AND email = ?1) OR (ntfy IS NOT NULL AND ntfy = ?2)';
  const [total, mine] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM watches').first('n'),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM watches WHERE ${contactWhere}`).bind(email, ntfy).first('n'),
  ]);
  if (total >= MAX_WATCHES) throw new HttpError(400, `Toplam ${MAX_WATCHES} takip sınırına ulaşıldı`);
  if (mine >= MAX_WATCHES_PER_PERSON) throw new HttpError(400, `Kişi başı en fazla ${MAX_WATCHES_PER_PERSON} ürün takip edilebilir`);

  const now = Date.now();
  await env.DB.prepare('INSERT INTO products (url, site, created_at) VALUES (?, ?, ?) ON CONFLICT(url) DO NOTHING')
    .bind(url, siteName(url), now)
    .run();
  const productId = await env.DB.prepare('SELECT id FROM products WHERE url = ?').bind(url).first('id');
  const duplicate = await env.DB.prepare(`SELECT id FROM watches WHERE product_id = ?3 AND (${contactWhere})`)
    .bind(email, ntfy, productId)
    .first('id');
  if (duplicate) throw new HttpError(409, 'Bu ürünü zaten takip ediyorsun. Değiştirmek için silip tekrar ekle.');

  const { meta } = await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO watches (product_id, owner, email, ntfy, sizes, target_price, fast, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(productId, owner, email, ntfy, JSON.stringify(sizes), target, body.fast ? 1 : 0, now),
    // Yeni takip hemen kontrol edilsin
    env.DB.prepare('UPDATE products SET last_checked = NULL WHERE id = ?').bind(productId),
  ]).then((r) => r[0]);
  ctx.waitUntil(dispatch(env, { debounce: true }));
  return json({ ok: true, id: meta.last_row_id });
}

async function deleteWatch(env, id, contact) {
  const watch = await env.DB.prepare('SELECT * FROM watches WHERE id = ?').bind(id).first();
  if (!watch) throw new HttpError(404, 'Takip bulunamadı');
  if (!isMine(watch, contact)) throw new HttpError(403, 'Sadece kendi takiplerini silebilirsin');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM watches WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM products WHERE id = ? AND NOT EXISTS (SELECT 1 FROM watches WHERE product_id = ?)').bind(
      watch.product_id,
      watch.product_id,
    ),
  ]);
  return json({ ok: true });
}

async function status(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM meta').all();
  const meta = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return json({
    now: Date.now(),
    lastRun: Number(meta.last_run) || null,
    lastDispatch: Number(meta.last_dispatch) || null,
    dispatchError: meta.dispatch_error || null,
  });
}

// ---------- Kontrol programı API'si ----------

const DUE_SQL = `
  SELECT p.* FROM products p
  WHERE EXISTS (SELECT 1 FROM watches w WHERE w.product_id = p.id)
    AND (p.last_checked IS NULL OR p.last_checked < ?1
         OR (p.last_checked < ?2 AND EXISTS (SELECT 1 FROM watches w WHERE w.product_id = p.id AND w.fast = 1)))`;

function dueQuery(env, now = Date.now()) {
  return env.DB.prepare(DUE_SQL).bind(now - NORMAL_MS, now - FAST_MS);
}

async function checkerJobs(env, all) {
  const products = all
    ? (await env.DB.prepare('SELECT p.* FROM products p WHERE EXISTS (SELECT 1 FROM watches w WHERE w.product_id = p.id)').all()).results
    : (await dueQuery(env).all()).results;
  const ids = new Set(products.map((p) => p.id));
  const { results: watches } = await env.DB.prepare('SELECT * FROM watches').all();

  const jobs = products.map((p) => ({
    id: p.id,
    url: p.url,
    title: p.title,
    color: p.color,
    sizes: parse(p.sizes, []),
    fail_count: p.fail_count,
    watches: watches
      .filter((w) => w.product_id === p.id && ids.has(p.id))
      .map((w) => ({
        id: w.id,
        email: w.email,
        ntfy: w.ntfy,
        sizes: parse(w.sizes, []),
        target_price: w.target_price,
        state: parse(w.state, null),
      })),
  }));
  return json({ jobs });
}

async function checkerResults(request, env) {
  const { results } = await readJson(request);
  if (!Array.isArray(results)) throw new HttpError(400, 'results bekleniyordu');
  const now = Date.now();
  const stmts = [];
  for (const r of results) {
    if (r.ok) {
      stmts.push(
        env.DB.prepare(
          'UPDATE products SET title = ?, color = ?, price = ?, sizes = ?, last_checked = ?, fail_count = 0, last_error = NULL WHERE id = ?',
        ).bind(r.title ?? null, r.color ?? null, r.price ?? null, JSON.stringify(r.sizes ?? []), now, r.product_id),
      );
    } else {
      stmts.push(
        env.DB.prepare('UPDATE products SET last_checked = ?, fail_count = fail_count + 1, last_error = ? WHERE id = ?').bind(
          now,
          String(r.error ?? 'Bilinmeyen hata').slice(0, 300),
          r.product_id,
        ),
      );
    }
    for (const w of r.watches ?? []) {
      stmts.push(
        env.DB.prepare('UPDATE watches SET state = ? WHERE id = ? AND product_id = ?').bind(
          w.state == null ? null : JSON.stringify(w.state),
          w.id,
          r.product_id,
        ),
      );
    }
  }
  // Kontrol sırasında eklenen (henüz hiç kontrol edilmemiş) takipler bir sonraki çalıştırmada hemen kontrol edilsin
  stmts.push(env.DB.prepare('UPDATE products SET last_checked = NULL WHERE id IN (SELECT product_id FROM watches WHERE state IS NULL)'));
  stmts.push(env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_run', ?)").bind(String(now)));
  await env.DB.batch(stmts);
  return json({ ok: true });
}

// ---------- GitHub'daki kontrol programını başlatma ----------

async function dispatchIfDue(env) {
  const due = await dueQuery(env).all();
  if (due.results.length) await dispatch(env, { debounce: false });
}

async function dispatch(env, { debounce }) {
  const now = Date.now();
  const setMeta = (key, value) =>
    env.DB.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').bind(key, String(value)).run();

  if (debounce) {
    const last = Number(await env.DB.prepare("SELECT value FROM meta WHERE key = 'last_dispatch'").first('value')) || 0;
    if (now - last < DISPATCH_DEBOUNCE_MS) return;
  }
  if (!env.DISPATCH_TOKEN) {
    await setMeta('dispatch_error', 'DISPATCH_TOKEN ayarlanmamış');
    return;
  }
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DISPATCH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'urun-takip',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
    },
  );
  await setMeta('last_dispatch', now);
  await setMeta('dispatch_error', res.ok ? '' : `GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ---------- Yardımcılar ----------

export function siteName(url) {
  const host = new URL(url).hostname;
  return SITES.find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1] ?? host.replace(/^www\./, '');
}

export function normalizeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw ?? '').trim());
  } catch {
    throw new HttpError(400, 'Geçerli bir ürün linki yapıştır');
  }
  if (!/^https?:$/.test(u.protocol) || String(raw).length > 2000) throw new HttpError(400, 'Geçerli bir ürün linki yapıştır');
  u.protocol = 'https:';
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  return u.toString();
}

// "1.299,90", "1299,90", "1299.90" ve "1299" hepsi 1299.9 olarak okunur
export function parsePrice(value) {
  let s = String(value ?? '').replace(/\s|TL|₺/gi, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}(\.|$)/.test(s)) s = s.replace(/\./g, '');
  return Number(s);
}

function text(value, label, min, max) {
  const s = String(value ?? '').trim();
  if (s.length < min || s.length > max) throw new HttpError(400, `${label} geçersiz`);
  return s;
}

function parse(value, fallback) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function readJson(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError(415, 'JSON bekleniyordu');
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Geçersiz JSON');
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}
