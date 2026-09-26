import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluateFailure, normSize } from './rules.mjs';

const product = (sizes, price = 1000) => ({
  price,
  sizes: sizes.map(([name, available, p = price]) => ({ name, available, price: p })),
});

test('beden adları normalize edilir', () => {
  assert.equal(normSize('S (US S)'), 'S');
  assert.equal(normSize('xxl'), '2XL');
  assert.equal(normSize('36,5'), '36.5');
  assert.equal(normSize(' m '), 'M');
});

test('ilk kontrolde başlangıç bildirimi ve eksik beden bilgisi', () => {
  const { events, state } = evaluate({ sizes: ['M', 'XXL'], target_price: 1200 }, product([['S (US S)', true], ['M (US M)', false]]));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'start');
  assert.deepEqual(events[0].wantedStatus, [
    { name: 'M (US M)', available: false },
    { name: 'XXL', available: null },
  ]);
  assert.equal(events[0].belowTarget, true);
  assert.deepEqual(state.available, []);
  assert.equal(state.price, 1000);
});

test('istenen beden stoğa girince bildirim', () => {
  const watch = { sizes: ['M'], state: { price: 1000, available: [] } };
  const { events, state } = evaluate(watch, product([['S', true], ['M', true]]), 1_000_000);
  assert.deepEqual(events, [{ type: 'stock', sizes: ['M'], price: 1000 }]);
  assert.deepEqual(state.available, ['M']);
  assert.equal(state.lastStock.M, 1_000_000);
});

test('başka beden stoğa girince bildirim yok', () => {
  const watch = { sizes: ['M'], state: { price: 1000, available: [] } };
  assert.deepEqual(evaluate(watch, product([['S', true], ['M', false]])).events, []);
});

test('beden seçilmediyse herhangi bir beden stoğa girince bildirim', () => {
  const watch = { sizes: [], state: { price: 1000, available: ['S'] } };
  const { events } = evaluate(watch, product([['S', true], ['L', true]]));
  assert.deepEqual(events.map((e) => e.sizes), [['L']]);
});

test('kısa sürede tükenip geri gelen beden için tekrar bildirim yok', () => {
  const now = 10_000_000;
  const watch = { sizes: ['M'], state: { price: 1000, available: [], lastStock: { M: now - 5 * 60 * 1000 } } };
  assert.deepEqual(evaluate(watch, product([['M', true]]), now).events, []);
});

test('fiyat düşünce bildirim, hedef varsa sadece hedefin altına inince', () => {
  const drop = product([['M', true]], 900);
  assert.equal(evaluate({ sizes: ['M'], state: { price: 1000, available: ['M'] } }, drop).events[0].type, 'price');
  assert.deepEqual(evaluate({ sizes: ['M'], target_price: 800, state: { price: 1000, available: ['M'] } }, drop).events, []);
  assert.equal(
    evaluate({ sizes: ['M'], target_price: 950, state: { price: 1000, available: ['M'] } }, drop).events[0].oldPrice,
    1000,
  );
});

test('fiyat artışında bildirim yok', () => {
  assert.deepEqual(evaluate({ sizes: [], state: { price: 900, available: ['M'] } }, product([['M', true]], 1000)).events, []);
});

test('fiyat istenen bedenlerin fiyatından hesaplanır', () => {
  const { state } = evaluate({ sizes: ['L'], state: { price: 1000, available: [] } }, product([['M', true, 500], ['L', false, 1200]]));
  assert.equal(state.price, 1200);
});

test('art arda okunamazsa bir kez uyarı', () => {
  const watch = { state: { price: 1000, available: [] } };
  assert.deepEqual(evaluateFailure(watch, 5, 'x').events, []);
  const r = evaluateFailure(watch, 6, 'x');
  assert.equal(r.events[0].type, 'broken');
  assert.equal(r.state.broken, true);
  assert.deepEqual(evaluateFailure({ state: r.state }, 7, 'x').events, []);
  assert.equal(evaluateFailure({ state: null }, 2, 'x').events[0].type, 'broken');
});
