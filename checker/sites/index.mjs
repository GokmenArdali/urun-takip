import adidas from './adidas.mjs';
import akinon from './akinon.mjs';
import beymen from './beymen.mjs';
import boyner from './boyner.mjs';
import defacto from './defacto.mjs';
import generic from './generic.mjs';
import hepsiburada from './hepsiburada.mjs';
import hm from './hm.mjs';
import inditex from './inditex.mjs';
import lcw from './lcw.mjs';
import mango from './mango.mjs';
import nike from './nike.mjs';
import trendyol from './trendyol.mjs';
import zara from './zara.mjs';

// generic en sonda: tanınmayan siteler için
const ADAPTERS = [zara, inditex, trendyol, hepsiburada, akinon, mango, boyner, lcw, nike, hm, defacto, adidas, beymen, generic];

export function adapterFor(url) {
  const host = new URL(url).hostname.toLowerCase();
  return ADAPTERS.find((a) => a.match(host));
}

// opts.storeStock: mağaza stoğu da okunsun mu (şimdilik Zara)
export async function checkProduct(url, deps) {
  const data = await adapterFor(url).check(url, deps);
  if (!data.sizes?.length) throw new Error('Beden bilgisi bulunamadı');
  return data;
}
