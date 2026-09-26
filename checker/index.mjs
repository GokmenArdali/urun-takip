// Kontrol programı: panelden kontrol zamanı gelen ürünleri alır, sitelerden okur,
// değişiklik varsa bildirim gönderir ve sonuçları panele geri yazar.
// DİKKAT: GitHub kayıtları herkese açık, burada e-posta/ntfy bilgisi loglanmaz.
import { createBrowser } from './browser.mjs';
import { createOutbox } from './notify.mjs';
import { evaluate, evaluateFailure } from './rules.mjs';
import { adapterFor, checkProduct } from './sites/index.mjs';

const API_URL = (process.env.API_URL ?? '').replace(/\/$/, '');
const API_TOKEN = process.env.API_TOKEN;
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const PRODUCT_TIMEOUT_MS = 75_000;
// Bir çalıştırma çok uzarsa yeni ürün başlatma; kalanlar sonraki çalıştırmada
const MAX_RUN_MS = 12 * 60_000;

async function api(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Panel API ${path}: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('Zaman aşımı')), ms))),
  ]).finally(() => clearTimeout(timer));
}

async function runPool(items, limit, fn) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  if (!API_URL || !API_TOKEN) throw new Error('API_URL ve API_TOKEN ayarlanmalı');
  const started = Date.now();
  const { jobs } = await api(`/api/checker/jobs${process.env.CHECK_ALL === '1' ? '?all=1' : ''}`);
  console.log(`${jobs.length} ürün kontrol edilecek`);
  if (!jobs.length) return;

  const browser = createBrowser();
  const outbox = createOutbox({ dryRun: process.env.NOTIFY_DRY_RUN === '1' });
  const results = [];

  try {
    await runPool(jobs, CONCURRENCY, async (job) => {
      if (Date.now() - started > MAX_RUN_MS) return;
      const site = adapterFor(job.url).name;
      const t0 = Date.now();
      let data = null;
      let error = null;
      try {
        data = await withTimeout(checkProduct(job.url, { browser }), PRODUCT_TIMEOUT_MS);
      } catch (e) {
        error = String(e.message || e).slice(0, 200);
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(1);

      const product = { url: job.url, ...(data ?? { title: job.title, color: job.color, sizes: job.sizes ?? [] }) };
      const watches = [];
      for (const watch of job.watches) {
        const { events, state } = data ? evaluate(watch, data) : evaluateFailure(watch, job.fail_count + 1, error);
        for (const event of events) outbox.add(watch, product, event);
        watches.push({ id: watch.id, state });
      }

      if (data) {
        const stock = data.sizes.filter((s) => s.available).length;
        console.log(`✓ [${site}] #${job.id} ${data.title} · ${data.price} TL · ${stock}/${data.sizes.length} beden stokta · ${secs} sn`);
      } else {
        console.log(`✗ [${site}] #${job.id} ${error} · ${secs} sn`);
      }
      results.push({
        product_id: job.id,
        ok: !!data,
        error,
        title: data?.title ?? null,
        color: data?.color ?? null,
        price: data?.price ?? null,
        sizes: data?.sizes ?? null,
        watches,
      });
    });
  } finally {
    await browser.close();
  }

  const failedNotifications = await outbox.flush();
  console.log(`${outbox.size} bildirim hazırlandı, ${failedNotifications} tanesi gönderilemedi`);
  await api('/api/checker/results', { results });
  console.log(`Bitti: ${results.length} ürün, ${((Date.now() - started) / 1000).toFixed(0)} sn`);
  if (failedNotifications) process.exitCode = 1; // GitHub'da kırmızı görünsün ki fark edilsin
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
