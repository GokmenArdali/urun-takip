import akinon from './akinon.mjs';
import generic from './generic.mjs';
import hepsiburada from './hepsiburada.mjs';
import inditex from './inditex.mjs';
import trendyol from './trendyol.mjs';
import zara from './zara.mjs';

const ADAPTERS = [zara, inditex, trendyol, hepsiburada, akinon, generic];

export function adapterFor(url) {
  const host = new URL(url).hostname.toLowerCase();
  return ADAPTERS.find((a) => a.match(host));
}

export async function checkProduct(url, deps) {
  const data = await adapterFor(url).check(url, deps);
  if (!data.sizes?.length) throw new Error('Beden bilgisi bulunamadı');
  return data;
}
