// Bir takibin (watch) önceki durumuyla yeni okunan ürün verisini karşılaştırıp
// gönderilecek bildirimleri ve yeni durumu hesaplar. Ağ/tarayıcı işi yok, test edilebilir.

// Aynı beden kısa sürede tükenip geri gelirse tekrar tekrar bildirim atmamak için
const STOCK_COOLDOWN_MS = 30 * 60 * 1000;
// Üst üste bu kadar okunamazsa "okunamıyor" bildirimi gider (ilk kontrolde daha çabuk)
const FAIL_LIMIT = 6;
const FAIL_LIMIT_FIRST = 2;

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

export function evaluate(watch, product, now = Date.now()) {
  const wantedRaw = (watch.sizes ?? []).filter((w) => normSize(w));
  const wanted = wantedRaw.map(normSize);
  const target = watch.target_price ?? null;
  const matched = wanted.length ? product.sizes.filter((s) => wanted.includes(normSize(s.name))) : product.sizes;
  const available = matched.filter((s) => s.available).map((s) => s.name);
  const prices = matched.map((s) => s.price).filter((p) => p > 0);
  const price = prices.length ? Math.min(...prices) : (product.price ?? null);

  const prev = watch.state;
  const state = { price, available, lastStock: { ...(prev?.lastStock ?? {}) }, broken: false };
  const events = [];

  if (!prev || prev.price === undefined) {
    const wantedStatus = wantedRaw.map((raw) => {
      const s = product.sizes.find((x) => normSize(x.name) === normSize(raw));
      return { name: s?.name ?? raw, available: s ? s.available : null };
    });
    events.push({
      type: 'start',
      price,
      available,
      wantedStatus,
      belowTarget: target != null && price != null && price <= target,
    });
    return { events, state };
  }

  const recentlyNotified = (n) => prev.lastStock?.[n] && now - prev.lastStock[n] < STOCK_COOLDOWN_MS;
  const newly = available.filter((n) => !(prev.available ?? []).includes(n) && !recentlyNotified(n));
  for (const n of newly) state.lastStock[n] = now;
  if (newly.length) events.push({ type: 'stock', sizes: newly, price });

  if (price != null && prev.price != null && price < prev.price - 0.009 && (target == null || price <= target)) {
    events.push({ type: 'price', oldPrice: prev.price, price, available });
  }

  return { events, state };
}

export function evaluateFailure(watch, failCount, error) {
  const limit = watch.state?.price === undefined ? FAIL_LIMIT_FIRST : FAIL_LIMIT;
  if (failCount < limit || watch.state?.broken) return { events: [], state: watch.state ?? null };
  return { events: [{ type: 'broken', error }], state: { ...(watch.state ?? {}), broken: true } };
}
