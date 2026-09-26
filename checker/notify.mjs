// Bildirim metinlerini hazırlar; e-posta (Gmail) ve ntfy ile gönderir.
// DİKKAT: GitHub kayıtları herkese açık, e-posta adresleri ve ntfy konuları asla loglanmamalı.
import nodemailer from 'nodemailer';

const tl = (n) =>
  n == null ? '?' : new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(n);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function describe(event, product, watch) {
  const name = product.title ? product.title + (product.color ? ` (${product.color})` : '') : product.url;
  const lines = [];
  let subject;
  let tags;
  let priority = 3;

  switch (event.type) {
    case 'start': {
      subject = `Takip başladı: ${name}`;
      tags = ['eyes'];
      lines.push(`Şu anki fiyat: ${tl(event.price)}`);
      if (event.wantedStatus.length) {
        const status = event.wantedStatus.map(
          (s) => `${s.name} ${s.available === true ? '✅ stokta' : s.available === false ? '❌ stokta yok' : '❔ listede görünmüyor'}`,
        );
        lines.push(`İstediğin bedenler: ${status.join(' · ')}`);
        const missing = event.wantedStatus.filter((s) => s.available === null).map((s) => s.name);
        if (missing.length) {
          const all = product.sizes.map((s) => s.name).join(', ');
          lines.push(
            `⚠️ ${missing.join(', ')} bedeni şu an üründe görünmüyor (tükenmiş olabilir ya da beden adı farklı yazılmış olabilir). Üründeki bedenler: ${all}`,
          );
        }
      } else {
        lines.push(event.available.length ? `Stoktaki bedenler: ${event.available.join(', ')}` : 'Şu an hiçbir beden stokta değil.');
      }
      if (watch.target_price != null) {
        lines.push(`Hedef fiyatın: ${tl(watch.target_price)}${event.belowTarget ? ' (fiyat zaten hedefin altında!)' : ''}`);
      }
      lines.push('Stoğa girince ya da fiyat düşünce haber vereceğim.');
      break;
    }
    case 'stock':
      subject = `🟢 Stokta: ${event.sizes.join(', ')} · ${name}`;
      tags = ['green_circle'];
      priority = 5;
      lines.push(`${event.sizes.join(', ')} beden stoğa girdi! Fiyat: ${tl(event.price)}`);
      break;
    case 'price':
      subject = `📉 Fiyat düştü: ${tl(event.oldPrice)} → ${tl(event.price)} · ${name}`;
      tags = ['chart_with_downwards_trend'];
      priority = 4;
      lines.push(`Fiyat ${tl(event.oldPrice)} iken ${tl(event.price)} oldu.`);
      lines.push(event.available.length ? `Stoktaki bedenlerin: ${event.available.join(', ')}` : 'İstediğin bedenler şu an stokta değil.');
      break;
    case 'broken':
      subject = `⚠️ Okunamıyor: ${name}`;
      tags = ['warning'];
      lines.push(`Bu ürünü birkaç kez üst üste okuyamadım (${event.error}).`);
      lines.push('Ürün kaldırılmış ya da site değişmiş olabilir. Tekrar okuyabildiğimde takibe devam ederim.');
      break;
    default:
      throw new Error(`Bilinmeyen bildirim: ${event.type}`);
  }
  return { subject, lines, tags, priority, name, url: product.url };
}

function emailHtml(messages, panelUrl) {
  const cards = messages
    .map(
      (m) => `
    <div style="border:1px solid #e3e3e3;border-radius:10px;padding:14px 16px;margin:0 0 12px">
      <div style="font-weight:600;font-size:15px;margin-bottom:6px">${esc(m.subject)}</div>
      ${m.lines.map((l) => `<div style="color:#333;font-size:14px;line-height:1.5">${esc(l)}</div>`).join('')}
      <a href="${esc(m.url)}" style="display:inline-block;margin-top:10px;background:#111;color:#fff;text-decoration:none;padding:8px 14px;border-radius:8px;font-size:14px">Ürüne git</a>
    </div>`,
    )
    .join('');
  const footer = panelUrl
    ? `<div style="color:#888;font-size:12px;margin-top:8px">Takip listeni <a href="${esc(panelUrl)}">panelden</a> yönetebilirsin.</div>`
    : '';
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px">${cards}${footer}</div>`;
}

export function createOutbox({ dryRun = false } = {}) {
  const emails = new Map(); // adres -> mesajlar
  const pushes = [];

  return {
    add(watch, product, event) {
      const message = describe(event, product, watch);
      if (watch.email) {
        if (!emails.has(watch.email)) emails.set(watch.email, []);
        emails.get(watch.email).push(message);
      }
      if (watch.ntfy) pushes.push({ topic: watch.ntfy, message });
    },

    get size() {
      return [...emails.values()].reduce((n, list) => n + list.length, 0) + pushes.length;
    },

    // Hata olursa diğer bildirimlere devam eder, başarısız sayısını döndürür
    async flush() {
      let failed = 0;
      const panelUrl = process.env.PANEL_URL;

      if (dryRun) {
        for (const [to, list] of emails) for (const m of list) console.log(`[e-posta → ${to}] ${m.subject}\n  ${m.lines.join('\n  ')}`);
        for (const p of pushes) console.log(`[ntfy → ${p.topic}] ${p.message.subject}`);
        return 0;
      }

      if (emails.size) {
        const user = (process.env.GMAIL_USER ?? '').trim();
        const transport = nodemailer.createTransport({
          service: 'gmail',
          auth: { user, pass: (process.env.GMAIL_APP_PASSWORD ?? '').replace(/\s+/g, '') },
        });
        for (const [to, list] of emails) {
          try {
            await transport.sendMail({
              from: `Ürün Takip <${user}>`,
              to,
              subject: list.length === 1 ? list[0].subject : `${list.length} yeni bildirim: ${list[0].subject}`,
              text: list.map((m) => `${m.subject}\n${m.lines.join('\n')}\n${m.url}`).join('\n\n'),
              html: emailHtml(list, panelUrl),
            });
          } catch (e) {
            failed += list.length;
            console.error(`E-posta gönderilemedi: ${e.message}`);
          }
        }
      }

      for (const { topic, message } of pushes) {
        try {
          const res = await fetch(process.env.NTFY_SERVER || 'https://ntfy.sh', {
            method: 'POST',
            body: JSON.stringify({
              topic,
              title: message.subject,
              message: message.lines.join('\n'),
              click: message.url,
              tags: message.tags,
              priority: message.priority,
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (e) {
          failed++;
          console.error(`ntfy bildirimi gönderilemedi: ${e.message}`);
        }
      }
      return failed;
    },
  };
}
