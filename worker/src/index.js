// Cloudflare Worker: web paneli, panel API'si, kontrol programının API'si, e-postadaki tek tık linkleri
// ve 5 dakikalık zamanlayıcı.
import PANEL_HTML from './panel.html';
import { linkPage } from './pages.js';

const DAY = 24 * 60 * 60 * 1000;
const FAST_MS = 4.5 * 60_000; // "hızlı" ürünler ~5 dakikada bir
const NORMAL_MS = 14.5 * 60_000; // diğerleri ~15 dakikada bir
const DISPATCH_DEBOUNCE_MS = 60_000;
const MAX_WATCHES_PER_PERSON = 50;
const MAX_WATCHES = 500;
const HISTORY_SAMPLE_MS = 12 * 60 * 60 * 1000;
const HISTORY_KEEP_MS = 120 * DAY;
const SITE_ALERT_REPEAT_MS = DAY;

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
  ['koton.com', 'Koton'],
  ['mango.com', 'Mango'],
  ['boyner.com.tr', 'Boyner'],
  ['lcw.com', 'LC Waikiki'],
  ['nike.com', 'Nike'],
  ['hm.com', 'H&M'],
  ['defacto.com.tr', 'DeFacto'],
  ['adidas.com.tr', 'Adidas'],
  ['beymen.com', 'Beymen'],
];
// Mağaza stoğu şimdilik sadece Zara'da
const STORE_STOCK_SITES = new Set(['Zara']);
// Tüm renkleri tek sayfada veren siteler: başka renkte stok uyarısı
const OTHER_COLOR_SITES = new Set([
  'Zara',
  'Pull&Bear',
  'Bershka',
  'Stradivarius',
  'Massimo Dutti',
  'Oysho',
  'Lefties',
  'Zara Home',
  'Hepsiburada',
  'Nike',
  'H&M',
]);
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

  // E-postadaki "takibi bırak" / "devam et" linkleri (giriş gerektirmez, imzalı)
  const link = url.pathname.match(/^\/t\/(\d+)\/(birak|devam)\/([a-f0-9]{24})$/);
  if (link) return linkAction(request, env, Number(link[1]), link[2], link[3]);

  // Telefonda başka bir uygulamadan "Paylaş → Ürün Takip": linki ekleme formuna taşır
  if (route === 'GET /paylas') {
    const text = [url.searchParams.get('url'), url.searchParams.get('text'), url.searchParams.get('title')].join(' ');
    const shared = text.match(/https?:\/\/[^\s"'<>]+/)?.[0];
    return Response.redirect(`${url.origin}/${shared ? `?link=${encodeURIComponent(shared)}` : ''}`, 303);
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
  if (route === 'GET /api/product') return productPreview(env, url.searchParams.get('url'));
  if (route === 'GET /api/status') return status(env);
  if (route === 'POST /api/push') return savePush(request, env);
  if (route === 'DELETE /api/push') return deletePush(request, env);
  if (route === 'POST /api/push/test') return testPush(request, env, url.origin);
  const one = url.pathname.match(/^\/api\/watches\/(\d+)$/);
  if (one && request.method === 'DELETE') return deleteWatch(env, Number(one[1]), contactOf(url));
  if (one && request.method === 'PATCH') return updateWatch(request, env, ctx, Number(one[1]), contactOf(url));
  throw new HttpError(404, 'Bulunamadı');
}

// ---------- Giriş ----------

async function login(request, env) {
  const { password } = await readJson(request);
  if (!env.PANEL_PASSWORD || !safeEqual(String(password ?? ''), env.PANEL_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 700)); // tahmin denemelerini yavaşlat
    throw new HttpError(401, 'Şifre yanlış');
  }
  return json({ ok: true }, 200, { 'set-cookie': cookie(await hmac(env, 'panel-oturumu'), 180 * 24 * 3600) });
}

function cookie(value, maxAge) {
  return `oturum=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

// Şifre veya anahtar değişirse eski oturumlar ve linkler geçersiz olur
async function hmac(env, message, key = `${env.PANEL_PASSWORD}:${env.API_TOKEN}`) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// E-posta linklerinin imzası; kontrol programı aynısını API_TOKEN ile üretir
const linkSignature = async (env, id, action) => (await hmac(env, `link:${id}:${action}`, env.API_TOKEN)).slice(0, 24);

async function requireSession(request, env) {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)oturum=([a-f0-9]+)/)?.[1];
  if (!value || !env.PANEL_PASSWORD || !safeEqual(value, await hmac(env, 'panel-oturumu'))) {
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
  const [{ results }, { results: history }] = await Promise.all([
    env.DB.prepare(
      `SELECT w.id, w.owner, w.email, w.ntfy, w.sizes, w.target_price, w.target_percent, w.fast, w.paused, w.store_stock, w.other_colors,
              w.state, w.created_at, p.id AS product_id, p.url, p.site, p.title, p.color, p.image, p.price, p.list_price,
              p.sizes AS product_sizes, p.stores, p.colors, p.last_checked, p.fail_count, p.last_error
       FROM watches w JOIN products p ON p.id = w.product_id
       ORDER BY w.created_at DESC`,
    ).all(),
    // Grafik için son 60 günün günlük en düşük fiyatları
    env.DB.prepare(
      `SELECT product_id, t / ${DAY} AS d, MIN(price) AS p FROM price_history WHERE t > ?
       GROUP BY product_id, d ORDER BY d`,
    )
      .bind(Date.now() - 60 * DAY)
      .all(),
  ]);
  const byProduct = new Map();
  for (const h of history) {
    if (!byProduct.has(h.product_id)) byProduct.set(h.product_id, []);
    byProduct.get(h.product_id).push([h.d, h.p]);
  }
  // Başkalarının e-posta/ntfy bilgisi panele gönderilmez
  const watches = results.map(({ email, ntfy, state, ...w }) => {
    const s = parse(state, null);
    return {
      ...w,
      mine: !!isMine({ email, ntfy }, contact),
      sizes: parse(w.sizes, []),
      product_sizes: parse(w.product_sizes, null),
      stores: parse(w.stores, null),
      colors: parse(w.colors, null),
      fast: !!w.fast,
      other_colors: !!w.other_colors,
      other_colors_supported: OTHER_COLOR_SITES.has(w.site),
      paused: !!w.paused,
      store_stock: !!w.store_stock,
      store_stock_supported: STORE_STOCK_SITES.has(w.site),
      base_price: s?.basePrice ?? null,
      history: byProduct.get(w.product_id) ?? [],
    };
  });
  return json({ watches });
}

// Link yapıştırılınca: ürünü başka biri zaten takip ediyorsa bedenleri hemen göster
async function productPreview(env, raw) {
  const url = normalizeUrl(raw);
  const site = siteName(url);
  const p = await env.DB.prepare('SELECT title, color, image, price, sizes FROM products WHERE url = ?').bind(url).first();
  return json({
    site,
    known: !!p?.sizes,
    title: p?.title ?? null,
    color: p?.color ?? null,
    image: p?.image ?? null,
    price: p?.price ?? null,
    sizes: parse(p?.sizes, null),
    store_stock_supported: STORE_STOCK_SITES.has(site),
    other_colors_supported: OTHER_COLOR_SITES.has(site),
    size_tracking: SITES.some(([, name]) => name === site),
  });
}

// "1500" -> {price: 1500}, "%20" veya "20%" -> {percent: 20}
function parseTarget(value) {
  const s = String(value ?? '').trim();
  if (!s) return { price: null, percent: null };
  if (s.includes('%')) {
    const percent = Number(s.replace(/[%\s]/g, '').replace(',', '.'));
    if (!(percent > 0 && percent < 100)) throw new HttpError(400, 'İndirim yüzdesi 1 ile 99 arasında olmalı');
    return { price: null, percent };
  }
  const price = parsePrice(s);
  if (!(price > 0 && price < 10_000_000)) throw new HttpError(400, 'Hedef fiyat geçersiz');
  return { price, percent: null };
}

function parseSizes(value) {
  const sizes = (Array.isArray(value) ? value : String(value ?? '').split(/[,;/]+/)).map((s) => String(s).trim()).filter(Boolean);
  if (sizes.length > 15 || sizes.some((s) => s.length > 20)) throw new HttpError(400, 'Bedenler çok uzun');
  return [...new Set(sizes)];
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
  const sizes = parseSizes(body.sizes);
  const target = parseTarget(body.target);
  const site = siteName(url);
  const storeStock = body.store_stock && STORE_STOCK_SITES.has(site) ? 1 : 0;
  const otherColors = body.other_colors && OTHER_COLOR_SITES.has(site) ? 1 : 0;

  const contactWhere = '(email IS NOT NULL AND email = ?1) OR (ntfy IS NOT NULL AND ntfy = ?2)';
  const [total, mine] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM watches').first('n'),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM watches WHERE ${contactWhere}`).bind(email, ntfy).first('n'),
  ]);
  if (total >= MAX_WATCHES) throw new HttpError(400, `Toplam ${MAX_WATCHES} takip sınırına ulaşıldı`);
  if (mine >= MAX_WATCHES_PER_PERSON) throw new HttpError(400, `Kişi başı en fazla ${MAX_WATCHES_PER_PERSON} ürün takip edilebilir`);

  const now = Date.now();
  await env.DB.prepare('INSERT INTO products (url, site, created_at) VALUES (?, ?, ?) ON CONFLICT(url) DO NOTHING')
    .bind(url, site, now)
    .run();
  const productId = await env.DB.prepare('SELECT id FROM products WHERE url = ?').bind(url).first('id');
  const duplicate = await env.DB.prepare(`SELECT id FROM watches WHERE product_id = ?3 AND (${contactWhere})`)
    .bind(email, ntfy, productId)
    .first('id');
  if (duplicate) throw new HttpError(409, 'Bu ürünü zaten takip ediyorsun. Listeden düzenleyebilirsin.');

  const [insert] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO watches (product_id, owner, email, ntfy, sizes, target_price, target_percent, fast, store_stock, other_colors, created_at, last_activity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(productId, owner, email, ntfy, JSON.stringify(sizes), target.price, target.percent, body.fast ? 1 : 0, storeStock, otherColors, now, now),
    // Yeni takip hemen kontrol edilsin
    env.DB.prepare('UPDATE products SET last_checked = NULL WHERE id = ?').bind(productId),
  ]);
  ctx.waitUntil(dispatch(env, { debounce: true }));
  return json({ ok: true, id: insert.meta.last_row_id });
}

async function ownWatch(env, id, contact) {
  const watch = await env.DB.prepare('SELECT w.*, p.site FROM watches w JOIN products p ON p.id = w.product_id WHERE w.id = ?')
    .bind(id)
    .first();
  if (!watch) throw new HttpError(404, 'Takip bulunamadı');
  if (!isMine(watch, contact)) throw new HttpError(403, 'Sadece kendi takiplerini değiştirebilirsin');
  return watch;
}

async function updateWatch(request, env, ctx, id, contact) {
  const watch = await ownWatch(env, id, contact);
  const body = await readJson(request);
  const sets = [];
  const binds = [];
  let resync = false;
  const set = (column, value) => {
    sets.push(`${column} = ?`);
    binds.push(value);
  };

  if ('sizes' in body) {
    set('sizes', JSON.stringify(parseSizes(body.sizes)));
    resync = true;
  }
  if ('target' in body) {
    const target = parseTarget(body.target);
    set('target_price', target.price);
    set('target_percent', target.percent);
    resync = true;
  }
  if ('fast' in body) set('fast', body.fast ? 1 : 0);
  if ('store_stock' in body) {
    set('store_stock', body.store_stock && STORE_STOCK_SITES.has(watch.site) ? 1 : 0);
    resync = true;
  }
  if ('other_colors' in body) {
    set('other_colors', body.other_colors && OTHER_COLOR_SITES.has(watch.site) ? 1 : 0);
    resync = true;
  }
  if ('paused' in body) {
    set('paused', body.paused ? 1 : 0);
    if (!body.paused) set('last_activity', Date.now());
  }
  if (!sets.length) throw new HttpError(400, 'Değişiklik yok');

  // Beden/hedef değişince bir sonraki kontrolde yeni durum bildirimsiz temel alınır;
  // tekrar açılan takipte hatırlatma sayacı sıfırlanır
  let stateExpr = 'state';
  if (resync) stateExpr = "json_set(COALESCE(state, '{}'), '$.resync', 1)";
  if (body.paused === false) {
    stateExpr = `json_remove(json_set(COALESCE(${stateExpr}, '{}'), '$.lastActivity', ?), '$.reminderAt')`;
    binds.push(Date.now());
  }
  const stmts = [env.DB.prepare(`UPDATE watches SET ${sets.join(', ')}, state = ${stateExpr} WHERE id = ?`).bind(...binds, id)];
  // Tekrar açılan veya mağaza stoğu açılan takip hemen kontrol edilsin
  if (body.paused === false || body.store_stock || body.other_colors) {
    stmts.push(env.DB.prepare('UPDATE products SET last_checked = NULL WHERE id = ?').bind(watch.product_id));
    ctx.waitUntil(dispatch(env, { debounce: true }));
  }
  await env.DB.batch(stmts);
  return json({ ok: true });
}

async function deleteWatch(env, id, contact) {
  const watch = await ownWatch(env, id, contact);
  await removeWatch(env, watch);
  return json({ ok: true });
}

async function removeWatch(env, watch) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM watches WHERE id = ?').bind(watch.id),
    env.DB.prepare('DELETE FROM price_history WHERE product_id = ? AND NOT EXISTS (SELECT 1 FROM watches WHERE product_id = ?)').bind(
      watch.product_id,
      watch.product_id,
    ),
    env.DB.prepare('DELETE FROM products WHERE id = ? AND NOT EXISTS (SELECT 1 FROM watches WHERE product_id = ?)').bind(
      watch.product_id,
      watch.product_id,
    ),
  ]);
}

async function status(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM meta WHERE key NOT LIKE 'site_down:%'").all();
  const meta = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return json({
    now: Date.now(),
    lastRun: Number(meta.last_run) || null,
    lastDispatch: Number(meta.last_dispatch) || null,
    dispatchError: meta.dispatch_error || null,
    vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
  });
}

// ---------- Telefon/bilgisayar bildirimleri (Web Push) ----------

async function savePush(request, env) {
  const { subscription: sub, email, ntfy } = await readJson(request);
  const endpoint = String(sub?.endpoint ?? '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    throw new HttpError(400, 'Bildirim aboneliği geçersiz');
  }
  const contact = { email: email ? String(email).trim().toLowerCase() : null, ntfy: ntfy ? String(ntfy).trim() : null };
  if (!contact.email && !contact.ntfy) throw new HttpError(400, 'Önce e-posta ya da ntfy bilgini kaydet');
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, email, ntfy, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, email = excluded.email, ntfy = excluded.ntfy`,
  )
    .bind(endpoint, String(sub.keys.p256dh), String(sub.keys.auth), contact.email, contact.ntfy, Date.now())
    .run();
  return json({ ok: true });
}

async function deletePush(request, env) {
  const { endpoint } = await readJson(request);
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(String(endpoint ?? '')).run();
  return json({ ok: true });
}

const b64urlDecode = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const b64urlEncode = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// İçeriksiz (payload'suz) push: şifreleme gerekmez, sadece VAPID imzası. Telefon "Bildirimler açık" gösterir.
async function testPush(request, env, origin) {
  const { endpoint } = await readJson(request);
  const sub = await env.DB.prepare('SELECT endpoint FROM push_subscriptions WHERE endpoint = ?').bind(String(endpoint ?? '')).first();
  if (!sub) throw new HttpError(404, 'Bu cihazın bildirim aboneliği bulunamadı');
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) throw new HttpError(503, 'Bildirim anahtarı ayarlanmamış (VAPID_PRIVATE_KEY)');

  const pub = b64urlDecode(env.VAPID_PUBLIC_KEY);
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY.trim(), x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)) },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const enc = (o) => b64urlEncode(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(sub.endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: origin })}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: `vapid t=${unsigned}.${b64urlEncode(signature)}, k=${env.VAPID_PUBLIC_KEY}`, TTL: '60', Urgency: 'high', 'Content-Length': '0' },
  });
  if (res.status === 404 || res.status === 410) {
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run();
    throw new HttpError(410, 'Bu cihazın bildirim izni kaldırılmış; bildirimleri tekrar aç');
  }
  if (!res.ok) throw new HttpError(502, `Bildirim servisi reddetti (${res.status})`);
  return json({ ok: true });
}

// ---------- E-posta linkleri ----------

async function linkAction(request, env, id, action, sig) {
  if (!env.API_TOKEN || !safeEqual(sig, await linkSignature(env, id, action))) {
    return html(linkPage({ title: 'Link geçersiz', message: 'Bu link geçersiz ya da süresi dolmuş.' }), 400);
  }
  const watch = await env.DB.prepare(
    'SELECT w.*, p.title, p.color, p.image, p.url FROM watches w JOIN products p ON p.id = w.product_id WHERE w.id = ?',
  )
    .bind(id)
    .first();
  if (!watch) return html(linkPage({ title: 'Takip bulunamadı', message: 'Bu takip zaten bırakılmış.' }));

  const product = { title: watch.title, color: watch.color, image: watch.image, url: watch.url };
  // E-posta programları linkleri önceden açabildiği için işlem sadece butona basınca (POST) yapılır
  if (request.method !== 'POST') {
    return html(
      linkPage(
        action === 'birak'
          ? { title: 'Takibi bırak', message: 'Bu ürün için artık bildirim almayacaksın.', product, button: 'Takibi bırak', danger: true }
          : { title: 'Takibe devam', message: 'Bu ürünü takip etmeye devam edeceğim.', product, button: 'Devam et' },
      ),
    );
  }
  if (action === 'birak') {
    await removeWatch(env, watch);
    return html(linkPage({ title: 'Takip bırakıldı', message: 'Bu ürün için artık bildirim gelmeyecek.', product, done: true }));
  }
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE watches SET paused = 0, last_activity = ?,
       state = json_remove(json_set(COALESCE(state, '{}'), '$.lastActivity', ?), '$.reminderAt') WHERE id = ?`,
  )
    .bind(now, now, id)
    .run();
  return html(linkPage({ title: 'Takip devam ediyor', message: 'Stoğa girince ya da fiyat düşünce haber vereceğim.', product, done: true }));
}

// ---------- Kontrol programı API'si ----------

const DUE_SQL = `
  SELECT p.* FROM products p
  WHERE EXISTS (SELECT 1 FROM watches w WHERE w.product_id = p.id AND w.paused = 0)
    AND (p.last_checked IS NULL OR p.last_checked < ?1
         OR (p.last_checked < ?2 AND EXISTS (SELECT 1 FROM watches w WHERE w.product_id = p.id AND w.fast = 1 AND w.paused = 0)))`;

function dueQuery(env, now = Date.now()) {
  return env.DB.prepare(DUE_SQL).bind(now - NORMAL_MS, now - FAST_MS);
}

async function checkerJobs(env, all) {
  const products = all
    ? (
        await env.DB.prepare(
          'SELECT p.* FROM products p WHERE EXISTS (SELECT 1 FROM watches w WHERE w.product_id = p.id AND w.paused = 0)',
        ).all()
      ).results
    : (await dueQuery(env).all()).results;
  if (!products.length) return json({ jobs: [] });

  const ids = JSON.stringify(products.map((p) => p.id));
  const [{ results: watches }, { results: history }, { results: subs }] = await Promise.all([
    env.DB.prepare('SELECT * FROM watches WHERE paused = 0 AND product_id IN (SELECT value FROM json_each(?))').bind(ids).all(),
    // Fiyat yorumu için son 35 günün günlük en düşük fiyatları
    env.DB.prepare(
      `SELECT product_id, (t / ${DAY}) * ${DAY} + ${DAY / 2} AS t, MIN(price) AS price FROM price_history
       WHERE t > ? AND product_id IN (SELECT value FROM json_each(?)) GROUP BY product_id, t / ${DAY}`,
    )
      .bind(Date.now() - 35 * DAY, ids)
      .all(),
    env.DB.prepare('SELECT endpoint, p256dh, auth, email, ntfy FROM push_subscriptions').all(),
  ]);
  const pushFor = (w) =>
    subs
      .filter((s) => (w.email && s.email === w.email) || (w.ntfy && s.ntfy === w.ntfy))
      .map(({ endpoint, p256dh, auth }) => ({ endpoint, keys: { p256dh, auth } }));

  const jobs = products.map((p) => {
    const own = watches.filter((w) => w.product_id === p.id);
    return {
      id: p.id,
      url: p.url,
      site: p.site,
      title: p.title,
      color: p.color,
      image: p.image,
      sizes: parse(p.sizes, []),
      fail_count: p.fail_count,
      store_stock: own.some((w) => w.store_stock),
      other_colors: own.some((w) => w.other_colors),
      history: history.filter((h) => h.product_id === p.id).map(({ t, price }) => ({ t, price })),
      watches: own.map((w) => ({
        id: w.id,
        email: w.email,
        ntfy: w.ntfy,
        sizes: parse(w.sizes, []),
        target_price: w.target_price,
        target_percent: w.target_percent,
        store_stock: w.store_stock,
        other_colors: w.other_colors,
        push: pushFor(w),
        created_at: w.created_at,
        last_activity: w.last_activity,
        state: parse(w.state, null),
      })),
    };
  });
  return json({ jobs, vapidPublicKey: env.VAPID_PUBLIC_KEY || null });
}

async function checkerResults(request, env) {
  const { results, expired_push: expired = [] } = await readJson(request);
  if (!Array.isArray(results)) throw new HttpError(400, 'results bekleniyordu');
  const now = Date.now();
  const stmts = [];
  for (const r of results) {
    if (r.ok) {
      stmts.push(
        env.DB.prepare(
          `UPDATE products SET title = ?, color = ?, image = COALESCE(?, image), price = ?, list_price = ?, sizes = ?,
             stores = ?, colors = ?, last_checked = ?, fail_count = 0, last_error = NULL WHERE id = ?`,
        ).bind(
          r.title ?? null,
          r.color ?? null,
          r.image ?? null,
          r.price ?? null,
          r.list_price ?? null,
          JSON.stringify(r.sizes ?? []),
          r.stores ? JSON.stringify(r.stores) : null,
          r.colors ? JSON.stringify(r.colors) : null,
          now,
          r.product_id,
        ),
      );
      if (r.price > 0) {
        // Fiyat değiştiyse ya da son 12 saatte kayıt yoksa geçmişe ekle
        stmts.push(
          env.DB.prepare(
            `INSERT INTO price_history (product_id, t, price) SELECT ?1, ?2, ?3
             WHERE NOT EXISTS (SELECT 1 FROM price_history WHERE product_id = ?1 AND t > ?2 - ${HISTORY_SAMPLE_MS} AND price = ?3)`,
          ).bind(r.product_id, now, r.price),
        );
      }
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
        env.DB.prepare(
          'UPDATE watches SET state = ?, paused = CASE WHEN ? THEN 1 ELSE paused END WHERE id = ? AND product_id = ?',
        ).bind(w.state == null ? null : JSON.stringify(w.state), w.pause ? 1 : 0, w.id, r.product_id),
      );
    }
  }
  // Kontrol sırasında eklenen (henüz hiç kontrol edilmemiş) takipler bir sonraki çalıştırmada hemen kontrol edilsin
  stmts.push(
    env.DB.prepare('UPDATE products SET last_checked = NULL WHERE id IN (SELECT product_id FROM watches WHERE state IS NULL AND paused = 0)'),
  );
  stmts.push(env.DB.prepare('DELETE FROM price_history WHERE t < ?').bind(now - HISTORY_KEEP_MS));
  // Kullanıcı bildirim iznini kaldırdıysa/uygulamayı sildiyse abonelik silinir
  for (const endpoint of expired.slice(0, 100)) {
    stmts.push(env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(String(endpoint)));
  }
  stmts.push(env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_run', ?)").bind(String(now)));
  await env.DB.batch(stmts);
  return json({ ok: true, alerts: await siteAlerts(env, now) });
}

// Bir sitenin (en az 2 ürünü olan) tüm ürünleri üst üste okunamıyorsa yöneticiye haber verilir
async function siteAlerts(env, now) {
  const [{ results: sites }, { results: marks }] = await Promise.all([
    env.DB.prepare(
      `SELECT site, COUNT(*) AS total, SUM(CASE WHEN fail_count >= 3 THEN 1 ELSE 0 END) AS failing, MAX(last_error) AS error
       FROM products p WHERE EXISTS (SELECT 1 FROM watches w WHERE w.product_id = p.id AND w.paused = 0) GROUP BY site`,
    ).all(),
    env.DB.prepare("SELECT key, value FROM meta WHERE key LIKE 'site_down:%'").all(),
  ]);
  const down = new Map(marks.map((m) => [m.key.slice('site_down:'.length), Number(m.value)]));
  const alerts = [];
  const stmts = [];
  for (const s of sites) {
    const isDown = s.failing >= 2 && s.failing === s.total;
    const since = down.get(s.site);
    if (isDown && (!since || now - since > SITE_ALERT_REPEAT_MS)) {
      alerts.push({ type: 'down', site: s.site, count: s.total, error: s.error, repeat: !!since });
      stmts.push(env.DB.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').bind(`site_down:${s.site}`, String(now)));
    }
    if (!isDown && since) {
      alerts.push({ type: 'up', site: s.site });
      stmts.push(env.DB.prepare('DELETE FROM meta WHERE key = ?').bind(`site_down:${s.site}`));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return alerts;
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

function html(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
