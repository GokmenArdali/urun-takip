import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluate,
  evaluateFailure,
  effectiveTarget,
  groupStores,
  normSize,
  priceInsight,
  PAUSE_AFTER_REMINDER_MS,
  REMIND_AFTER_MS,
} from './rules.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY;
const product = (sizes, price = 1000, extra = {}) => ({
  price,
  sizes: sizes.map(([name, available, p = price]) => ({ name, available, price: p })),
  ...extra,
});
const known = (state) => ({ price: 1000, available: [], basePrice: 1000, lastActivity: NOW - DAY, ...state });

test('beden adları normalize edilir', () => {
  assert.equal(normSize('S (US S)'), 'S');
  assert.equal(normSize('xxl'), '2XL');
  assert.equal(normSize('36,5'), '36.5');
  assert.equal(normSize(' m '), 'M');
});

test('ilk kontrolde başlangıç bildirimi ve eksik beden bilgisi', () => {
  const { events, state } = evaluate({ sizes: ['M', 'XXL'], target_price: 1200 }, product([['S', true], ['M', false]]), { now: NOW });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'start');
  assert.deepEqual(events[0].wantedStatus, [
    { name: 'M', available: false },
    { name: 'XXL', available: null },
  ]);
  assert.equal(events[0].belowTarget, true);
  assert.equal(state.basePrice, 1000);
  assert.equal(state.lastActivity, NOW);
});

test('istenen beden stoğa girince bildirim', () => {
  const { events, state } = evaluate({ sizes: ['M'], state: known() }, product([['S', true], ['M', true]]), { now: NOW });
  assert.deepEqual(events, [{ type: 'stock', sizes: ['M'], price: 1000 }]);
  assert.equal(state.lastStock.M, NOW);
  assert.equal(state.lastActivity, NOW);
});

test('başka beden stoğa girince bildirim yok', () => {
  assert.deepEqual(evaluate({ sizes: ['M'], state: known() }, product([['S', true], ['M', false]]), { now: NOW }).events, []);
});

test('beden seçilmediyse herhangi bir beden stoğa girince bildirim', () => {
  const { events } = evaluate({ sizes: [], state: known({ available: ['S'] }) }, product([['S', true], ['L', true]]), { now: NOW });
  assert.deepEqual(events.map((e) => e.sizes), [['L']]);
});

test('kısa sürede tükenip geri gelen beden için tekrar bildirim yok', () => {
  const watch = { sizes: ['M'], state: known({ lastStock: { M: NOW - 5 * 60 * 1000 } }) };
  assert.deepEqual(evaluate(watch, product([['M', true]]), { now: NOW }).events, []);
});

test('fiyat düşünce bildirim, hedef varsa sadece hedefin altına inince', () => {
  const drop = product([['M', true]], 900);
  const w = (extra) => ({ sizes: ['M'], state: known({ available: ['M'] }), ...extra });
  assert.equal(evaluate(w(), drop, { now: NOW }).events[0].type, 'price');
  assert.deepEqual(evaluate(w({ target_price: 800 }), drop, { now: NOW }).events, []);
  assert.equal(evaluate(w({ target_price: 950 }), drop, { now: NOW }).events[0].oldPrice, 1000);
});

test('yüzde hedef takibin başladığı fiyata göre hesaplanır', () => {
  assert.equal(effectiveTarget({ target_percent: 20 }, 1000), 800);
  assert.equal(effectiveTarget({ target_price: 500, target_percent: 20 }, 1000), 500);
  const w = { sizes: [], target_percent: 20, state: known({ available: ['M'] }) };
  assert.deepEqual(evaluate(w, product([['M', true]], 850), { now: NOW }).events, []);
  assert.equal(evaluate(w, product([['M', true]], 790), { now: NOW }).events[0].type, 'price');
});

test('fiyat artışında bildirim yok', () => {
  assert.deepEqual(evaluate({ sizes: [], state: known({ price: 900, available: ['M'] }) }, product([['M', true]], 1000), { now: NOW }).events, []);
});

test('beden/hedef değişince yeni durum bildirimsiz temel alınır', () => {
  const { events, state } = evaluate(
    { sizes: ['M'], target_percent: 10, state: known({ resync: true }) },
    product([['M', true]], 800),
    { now: NOW },
  );
  assert.deepEqual(events, []);
  assert.equal(state.basePrice, 800);
  assert.equal(state.resync, undefined);
});

test('mağaza stoğu: yeni mağazada istenen beden çıkınca bildirim', () => {
  const stores = (list) => list.map(([id, name, sizes]) => ({ id, name, sizes: sizes.map((n) => ({ name: n, stock: 1 })) }));
  const watch = { sizes: ['M'], store_stock: 1, state: known({ available: ['M'], storeKeys: ['1|Zorlu|M'] }) };
  const p = product([['M', true]], 1000, { stores: stores([[1, 'Zorlu', ['M']], [2, 'Akasya', ['M', 'L']], [3, 'Cevahir', ['L']]]) });
  const { events, state } = evaluate(watch, p, { now: NOW });
  assert.deepEqual(events, [{ type: 'store', stores: [{ name: 'Akasya', sizes: ['M'] }] }]);
  assert.deepEqual(state.storeKeys, ['1|Zorlu|M', '2|Akasya|M']);
  assert.deepEqual(groupStores(['1|A|M', '1|A|L', '2|B|M']), [{ name: 'A', sizes: ['M', 'L'] }, { name: 'B', sizes: ['M'] }]);
});

test('başka renkte istenen beden stoğa girince bildirim', () => {
  const colors = [
    { name: 'Siyah', current: true, sizes: [{ name: 'M', available: false }] },
    { name: 'Haki', current: false, sizes: [{ name: 'M', available: true }, { name: 'L', available: true }] },
    { name: 'Kum', current: false, sizes: [{ name: 'M', available: false }] },
  ];
  const watch = { sizes: ['M'], other_colors: 1, state: known({ colorKeys: [] }) };
  const { events, state } = evaluate(watch, product([['M', false]], 1000, { colors }), { now: NOW });
  assert.deepEqual(events, [{ type: 'color', colors: [{ name: 'Haki', sizes: ['M'] }] }]);
  assert.deepEqual(state.colorKeys, ['Haki|M']);
  // Kapalıysa ya da ilk kez temel alınıyorsa bildirim yok
  assert.deepEqual(evaluate({ ...watch, other_colors: 0 }, product([['M', false]], 1000, { colors }), { now: NOW }).events, []);
  assert.deepEqual(evaluate({ ...watch, state: known() }, product([['M', false]], 1000, { colors }), { now: NOW }).events, []);
});

test('fiyat geçmişi: son 30 günün en düşüğü ve şişirilmiş fiyat tespiti', () => {
  const h = (daysAgo, price) => ({ t: NOW - daysAgo * DAY, price });
  assert.deepEqual(priceInsight([h(20, 1000), h(10, 1100), h(3, 1200)], 900, NOW), { lowest30: true });
  assert.deepEqual(priceInsight([h(20, 1000), h(3, 1500)], 1000, NOW), { lowest30: true, fakeDiscount: { ref: 1000, peak: 1500 } });
  // 3 hafta önce 800, sonra 1200'e çıkmış, şimdi 1000'e "inmiş": hâlâ eski fiyatın üstünde
  assert.deepEqual(priceInsight([h(20, 800), h(3, 1200)], 1000, NOW), { fakeDiscount: { ref: 800, peak: 1200 } });
  // Fiyat hep aynıydı, gerçekten düştü
  assert.deepEqual(priceInsight([h(20, 1000), h(3, 1000)], 900, NOW), { lowest30: true });
  // Daha önce daha ucuzdu
  assert.deepEqual(priceInsight([h(20, 700), h(10, 1000)], 900, NOW), {});
  assert.deepEqual(priceInsight([], 1000, NOW), {});
});

test('60 gün bildirim yoksa hatırlatma, cevapsız kalırsa durdurma', () => {
  const idle = { sizes: [], state: known({ available: ['M'], lastActivity: NOW - REMIND_AFTER_MS - DAY }) };
  const r1 = evaluate(idle, product([['M', true]]), { now: NOW });
  assert.deepEqual(r1.events, [{ type: 'reminder' }]);
  assert.equal(r1.state.reminderAt, NOW);
  const r2 = evaluate({ sizes: [], state: r1.state }, product([['M', true]]), { now: NOW + DAY });
  assert.deepEqual([r2.events, r2.pause], [[], false]);
  const r3 = evaluate({ sizes: [], state: r1.state }, product([['M', true]]), { now: NOW + PAUSE_AFTER_REMINDER_MS + DAY });
  assert.equal(r3.pause, true);
});

test('art arda okunamazsa bir kez uyarı', () => {
  const watch = { state: known() };
  assert.deepEqual(evaluateFailure(watch, 5, 'x').events, []);
  const r = evaluateFailure(watch, 6, 'x');
  assert.equal(r.events[0].type, 'broken');
  assert.equal(r.state.broken, true);
  assert.deepEqual(evaluateFailure({ state: r.state }, 7, 'x').events, []);
  assert.equal(evaluateFailure({ state: null }, 2, 'x').events[0].type, 'broken');
});
