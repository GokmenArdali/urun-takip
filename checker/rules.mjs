// Bir takibin (watch) önceki durumuyla yeni okunan ürün verisini karşılaştırıp
// gönderilecek bildirimleri ve yeni durumu hesaplar. Ağ/tarayıcı işi yok, test edilebilir.

const DAY = 24 * 60 * 60 * 1000;
// Aynı beden kısa sürede tükenip geri gelirse tekrar tekrar bildirim atmamak için
const STOCK_COOLDOWN_MS = 30 * 60 * 1000;
// Üst üste bu kadar okunamazsa "okunamıyor" bildirimi gider (ilk kontrolde daha çabuk)
const FAIL_LIMIT = 6;
const FAIL_LIMIT_FIRST = 2;
// Uzun süre hiç bildirim çıkmayan takipler için "hâlâ istiyor musun?" sorusu ve cevapsızsa durdurma
export const REMIND_AFTER_MS = 60 * DAY;
export const PAUSE_AFTER_REMINDER_MS = 7 * DAY;

const ALIASES = { XXL: '2XL', XXXL: '3XL', XXXXL: '4XL', 'TEK EBAT': 'STANDART', 'TEK BEDEN': 'STANDART', STD: 'STANDART' };

export function normSize(size) {
  const s = String(size ?? '')
    .toLocaleUpperCase('tr-TR')
    .replace(/\(.*?\)/g, ' ')
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
  return ALIASES[s] ?? s;
}

// Hedef fiyat: TL olarak girildiyse o, yüzde girildiyse takibin başladığı fiyata göre hesaplanır
export function effectiveTarget(watch, basePrice) {
  if (watch.target_price != null) return watch.target_price;
  if (watch.target_percent && basePrice) return Math.round(basePrice * (1 - watch.target_percent / 100) * 100) / 100;
  return null;
}

// Fiyat geçmişine bakarak indirimin gerçek olup olmadığını yorumlar.
// history: [{t, price}] (şu anki kontrol hariç)
export function priceInsight(history, price, now = Date.now()) {
  const points = (history ?? []).filter((h) => h.price > 0 && h.t <= now);
  const insight = {};
  const last30 = points.filter((h) => h.t >= now - 30 * DAY);
  if (last30.length && price <= Math.min(...last30.map((h) => h.price))) insight.lowest30 = true;

  // İndirimden önceki hafta içinde fiyat şişirilmiş ve "indirimli" fiyat aslında 1-4 hafta önceki fiyat mı?
  const older = points.filter((h) => h.t >= now - 30 * DAY && h.t < now - 7 * DAY);
  const recent = points.filter((h) => h.t >= now - 7 * DAY);
  if (older.length && recent.length) {
    const ref = Math.min(...older.map((h) => h.price));
    const peak = Math.max(...recent.map((h) => h.price));
    if (peak > ref * 1.05 && price >= ref * 0.98) insight.fakeDiscount = { ref, peak };
  }
  return insight;
}

function storeKeys(watch, product, wanted) {
  if (!watch.store_stock || !product.stores) return null;
  const keys = [];
  for (const store of product.stores) {
    for (const size of store.sizes) {
      if (!wanted.length || wanted.includes(normSize(size.name))) keys.push(`${store.id}|${store.name}|${size.name}`);
    }
  }
  return keys;
}

// Diğer renklerde istenen bedenlerden stokta olanlar: "Renk|Beden"
function colorKeys(watch, product, wanted) {
  if (!watch.other_colors || !product.colors) return null;
  const keys = [];
  for (const color of product.colors) {
    if (color.current) continue;
    for (const size of color.sizes) {
      if (size.available && (!wanted.length || wanted.includes(normSize(size.name)))) keys.push(`${color.name}|${size.name}`);
    }
  }
  return keys;
}

export function groupColors(keys) {
  const byColor = new Map();
  for (const key of keys ?? []) {
    const [name, size] = key.split('|');
    if (!byColor.has(name)) byColor.set(name, { name, sizes: [] });
    byColor.get(name).sizes.push(size);
  }
  return [...byColor.values()];
}

// ["id|Mağaza|M", "id|Mağaza|L"] -> [{name: "Mağaza", sizes: ["M", "L"]}]
export function groupStores(keys) {
  const byStore = new Map();
  for (const key of keys ?? []) {
    const [id, name, size] = key.split('|');
    if (!byStore.has(id)) byStore.set(id, { name, sizes: [] });
    byStore.get(id).sizes.push(size);
  }
  return [...byStore.values()];
}

export function evaluate(watch, product, { now = Date.now(), history = [] } = {}) {
  const wantedRaw = (watch.sizes ?? []).filter((w) => normSize(w));
  const wanted = wantedRaw.map(normSize);
  const matched = wanted.length ? product.sizes.filter((s) => wanted.includes(normSize(s.name))) : product.sizes;
  const available = matched.filter((s) => s.available).map((s) => s.name);
  const prices = matched.map((s) => s.price).filter((p) => p > 0);
  const price = prices.length ? Math.min(...prices) : (product.price ?? null);

  const prev = watch.state ?? null;
  const first = !prev || prev.price === undefined;
  // Beden/hedef değiştirildiyse (resync) yeni durum bildirimsiz temel alınır
  const rebase = first || prev.resync || prev.basePrice == null;
  const basePrice = rebase ? price : prev.basePrice;
  const target = effectiveTarget(watch, basePrice);
  const stores = storeKeys(watch, product, wanted);
  const colors = colorKeys(watch, product, wanted);

  const state = {
    price,
    available,
    basePrice,
    storeKeys: stores,
    colorKeys: colors,
    lastStock: { ...(prev?.lastStock ?? {}) },
    lastActivity: prev?.lastActivity ?? watch.last_activity ?? watch.created_at ?? now,
    reminderAt: prev?.reminderAt ?? null,
    broken: false,
  };
  const events = [];

  if (first) {
    const wantedStatus = wantedRaw.map((raw) => {
      const s = product.sizes.find((x) => normSize(x.name) === normSize(raw));
      return { name: s?.name ?? raw, available: s ? s.available : null };
    });
    events.push({
      type: 'start',
      price,
      available,
      wantedStatus,
      target,
      belowTarget: target != null && price != null && price <= target,
      stores: stores ? groupStores(stores) : null,
      otherColors: colors?.length ? groupColors(colors) : null,
    });
    state.lastActivity = now;
    return { events, state, pause: false };
  }
  if (prev.resync) return { events, state, pause: false };

  const recentlyNotified = (n) => prev.lastStock?.[n] && now - prev.lastStock[n] < STOCK_COOLDOWN_MS;
  const newly = available.filter((n) => !(prev.available ?? []).includes(n) && !recentlyNotified(n));
  for (const n of newly) state.lastStock[n] = now;
  if (newly.length) events.push({ type: 'stock', sizes: newly, price });

  if (stores && prev.storeKeys) {
    const newStores = stores.filter((k) => !prev.storeKeys.includes(k));
    if (newStores.length) events.push({ type: 'store', stores: groupStores(newStores) });
  }

  if (colors && prev.colorKeys) {
    const newColors = colors.filter((k) => !prev.colorKeys.includes(k));
    if (newColors.length) events.push({ type: 'color', colors: groupColors(newColors) });
  }

  if (price != null && prev.price != null && price < prev.price - 0.009 && (target == null || price <= target)) {
    events.push({ type: 'price', oldPrice: prev.price, price, available, target, insight: priceInsight(history, price, now) });
  }

  let pause = false;
  if (events.length) {
    state.lastActivity = now;
    state.reminderAt = null;
  } else if (!state.reminderAt && now - state.lastActivity > REMIND_AFTER_MS) {
    events.push({ type: 'reminder' });
    state.reminderAt = now;
  } else if (state.reminderAt && now - state.reminderAt > PAUSE_AFTER_REMINDER_MS) {
    pause = true;
  }
  return { events, state, pause };
}

export function evaluateFailure(watch, failCount, error) {
  const limit = watch.state?.price === undefined ? FAIL_LIMIT_FIRST : FAIL_LIMIT;
  if (failCount < limit || watch.state?.broken) return { events: [], state: watch.state ?? null, pause: false };
  return { events: [{ type: 'broken', error }], state: { ...(watch.state ?? {}), broken: true }, pause: false };
}
