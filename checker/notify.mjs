// Bildirim metinlerini hazırlar; e-posta (Gmail) ve ntfy ile gönderir.
// DİKKAT: GitHub kayıtları herkese açık, e-posta adresleri ve ntfy konuları asla loglanmamalı.
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import webpush from 'web-push';

const tl = (n) =>
  n == null ? '?' : new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const panelUrl = () => (process.env.PANEL_URL ?? process.env.API_URL ?? '').trim().replace(/\/$/, '');

// Panelle aynı imza: e-postadaki linkler giriş gerektirmeden tek bir takibi yönetir
export function actionLink(watchId, action) {
  const base = panelUrl();
  const key = (process.env.API_TOKEN ?? '').trim();
  if (!base || !key || !watchId) return null;
  const sig = crypto.createHmac('sha256', key).update(`link:${watchId}:${action}`).digest('hex').slice(0, 24);
  return `${base}/t/${watchId}/${action}/${sig}`;
}

const discount = (price, old) => (old > price && price > 0 ? Math.round((1 - price / old) * 100) : 0);

export function describe(event, product, watch) {
  const name = product.title || 'Ürün';
  const full = product.color ? `${name} · ${product.color}` : name;
  const m = {
    kind: event.type,
    name,
    color: product.color,
    image: product.image,
    url: product.url,
    price: product.price,
    oldPrice: product.listPrice,
    lines: [],
    chips: null,
    insight: null,
    stores: null,
    colors: null,
    cta: { label: 'Ürüne git', url: product.url },
    secondary: [],
    tags: [],
    priority: 3,
  };
  const leave = actionLink(watch.id, 'birak');
  if (leave) m.secondary.push({ label: 'Takibi bırak', url: leave });

  switch (event.type) {
    case 'start': {
      m.badge = 'Takip başladı';
      m.subject = `Takip başladı · ${full}`;
      m.tags = ['eyes'];
      m.price = event.price;
      if (event.wantedStatus.length) {
        m.chips = event.wantedStatus.map((s) => ({ label: s.name, state: s.available === true ? 'in' : s.available === false ? 'out' : 'missing' }));
        const missing = event.wantedStatus.filter((s) => s.available === null).map((s) => s.name);
        if (missing.length) {
          m.lines.push(
            `${missing.join(', ')} bedeni şu an üründe görünmüyor (tükenmiş olabilir ya da farklı yazılmış olabilir). Üründeki bedenler: ${product.sizes.map((s) => s.name).join(', ')}`,
          );
        }
      } else {
        m.chips = product.sizes.map((s) => ({ label: s.name, state: s.available ? 'in' : 'out' }));
      }
      if (event.target != null) {
        const pct = watch.target_percent ? ` (%${watch.target_percent} indirim)` : '';
        m.lines.push(`Hedef fiyatın: ${tl(event.target)}${pct}${event.belowTarget ? ' — fiyat zaten hedefin altında!' : ''}`);
      }
      if (event.stores) m.stores = event.stores;
      if (event.otherColors) {
        m.lines.push(`Diğer renklerde stokta: ${event.otherColors.map((c) => `${c.name} (${c.sizes.join(', ')})`).join(', ')}`);
      }
      m.lines.push('Stoğa girince ya da fiyat düşünce haber vereceğim.');
      break;
    }
    case 'stock':
      m.badge = 'Stokta';
      m.subject = `Stokta: ${event.sizes.join(', ')} · ${full}`;
      m.tags = ['green_circle'];
      m.priority = 5;
      m.price = event.price;
      m.chips = event.sizes.map((s) => ({ label: s, state: 'in' }));
      m.lines.push(`${event.sizes.join(', ')} beden stoğa girdi. Kapışılmadan göz at!`);
      break;
    case 'color':
      m.badge = 'Başka renkte';
      m.subject = `Başka renkte stokta: ${event.colors.map((c) => c.name).slice(0, 3).join(', ')} · ${full}`;
      m.tags = ['art'];
      m.priority = 4;
      m.colors = event.colors;
      m.lines.push('İstediğin beden şu renklerde stoğa girdi:');
      break;
    case 'store':
      m.badge = 'Mağazada';
      m.subject = `İstanbul mağazasında: ${event.stores.map((s) => s.name).slice(0, 3).join(', ')} · ${full}`;
      m.tags = ['round_pushpin'];
      m.priority = 4;
      m.stores = event.stores;
      m.lines.push('İstediğin beden şu mağazalarda stoğa girdi:');
      break;
    case 'price': {
      m.badge = 'Fiyat düştü';
      m.subject = `Fiyat düştü: ${tl(event.oldPrice)} → ${tl(event.price)} · ${full}`;
      m.tags = ['chart_with_downwards_trend'];
      m.priority = 4;
      m.price = event.price;
      m.oldPrice = Math.max(event.oldPrice, product.listPrice ?? 0);
      if (event.insight?.fakeDiscount) {
        m.insight = {
          tone: 'warn',
          text: `Dikkat: indirimden kısa süre önce fiyat ${tl(event.insight.fakeDiscount.ref)} → ${tl(event.insight.fakeDiscount.peak)} artırılmış. Yeni fiyat, birkaç hafta önceki fiyattan ucuz değil.`,
        };
      } else if (event.insight?.lowest30) {
        m.insight = { tone: 'good', text: 'Son 30 günün en düşük fiyatı' };
      }
      m.chips = event.available.length ? event.available.map((s) => ({ label: s, state: 'in' })) : null;
      m.lines.push(event.available.length ? 'İstediğin bedenlerden stokta olanlar:' : 'İstediğin bedenler şu an stokta değil.');
      if (event.target != null) m.lines.push(`Hedefin: ${tl(event.target)}`);
      break;
    }
    case 'reminder': {
      m.badge = 'Hatırlatma';
      m.subject = `Hâlâ takip etmek istiyor musun? · ${full}`;
      m.tags = ['hourglass'];
      m.lines.push('Bu ürün için 60 gündür bir değişiklik olmadı. Takibe devam etmek istiyorsan aşağıdaki butona bas.');
      m.lines.push('7 gün içinde basmazsan takibi durduracağım; istediğin zaman panelden tekrar açabilirsin.');
      const keep = actionLink(watch.id, 'devam');
      if (keep) m.cta = { label: 'Takibe devam et', url: keep };
      break;
    }
    case 'broken':
      m.badge = 'Okunamıyor';
      m.subject = `Okunamıyor · ${full}`;
      m.tags = ['warning'];
      m.lines.push(`Bu ürünü birkaç kez üst üste okuyamadım (${event.error}).`);
      m.lines.push('Ürün kaldırılmış ya da site değişmiş olabilir. Tekrar okuyabildiğimde takibe devam ederim.');
      break;
    default:
      throw new Error(`Bilinmeyen bildirim: ${event.type}`);
  }
  return m;
}

// ---------- E-posta tasarımı ----------

const BADGE = {
  start: ['#8a7550', '#f3ede2'],
  stock: ['#2f7d55', '#e3f3ea'],
  store: ['#2f6f86', '#e2f0f5'],
  price: ['#9a7a45', '#f5ecdc'],
  reminder: ['#6f6b63', '#eeece7'],
  broken: ['#b54a3c', '#f8e5e1'],
};
const CHIP = { in: ['#2f7d55', '#e3f3ea', '#b9dfc9'], out: ['#8e8b84', '#f1efea', '#e2dfd8'], missing: ['#b54a3c', '#f8e5e1', '#eec3bb'] };
const SERIF = "'Instrument Serif', 'Playfair Display', Georgia, 'Times New Roman', serif";
const SANS = "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function chipsHtml(chips) {
  if (!chips?.length) return '';
  return `<div style="margin:12px 0 2px">${chips
    .map((chip) => {
      const [c, bg, border] = CHIP[chip.state] ?? CHIP.out;
      const strike = chip.state === 'out' ? 'text-decoration:line-through;' : '';
      return `<span class="chip-${chip.state}" style="display:inline-block;margin:0 6px 6px 0;padding:4px 11px;border-radius:999px;border:1px solid ${border};background:${bg};color:${c};font:600 12px ${SANS};${strike}">${esc(chip.label)}</span>`;
    })
    .join('')}</div>`;
}

function rowsHtml(stores, icon = '') {
  if (!stores?.length) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 4px;border-collapse:collapse">${stores
    .map(
      (s) => `<tr><td class="line" style="padding:8px 0;border-top:1px solid #ece9e2;font:500 13px ${SANS};color:#17161a">${icon}${esc(s.name)}</td>
      <td class="line muted" align="right" style="padding:8px 0;border-top:1px solid #ece9e2;font:13px ${SANS};color:#6f6b63">${esc(s.sizes.join(', '))}</td></tr>`,
    )
    .join('')}</table>`;
}

function cardHtml(m) {
  const [bc, bbg] = BADGE[m.kind] ?? BADGE.start;
  const off = discount(m.price, m.oldPrice);
  const price =
    m.price != null
      ? `<div style="margin:10px 0 0;font:600 22px ${SANS};color:#17161a" class="text">${tl(m.price)}
         ${m.oldPrice > m.price ? `<span class="muted" style="font:400 14px ${SANS};color:#8e8b84;text-decoration:line-through;margin-left:6px">${tl(m.oldPrice)}</span>` : ''}
         ${off ? `<span class="off" style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;background:#17161a;color:#f6f4ef;font:600 11px ${SANS};vertical-align:middle">%${off}</span>` : ''}
       </div>`
      : '';
  const insight = m.insight
    ? `<div class="ins-${m.insight.tone}" style="margin:12px 0 0;padding:10px 12px;border-radius:10px;background:${m.insight.tone === 'warn' ? '#fbefe0' : '#e8f4ec'};color:${m.insight.tone === 'warn' ? '#8a5a1e' : '#2f7d55'};font:500 13px ${SANS}">${m.insight.tone === 'warn' ? '⚠' : '✦'} ${esc(m.insight.text)}</div>`
    : '';
  const image = m.image
    ? `<td width="112" valign="top" style="padding:0 18px 0 0"><a href="${esc(m.url)}"><img src="${esc(m.image)}" width="112" alt="" style="display:block;width:112px;height:140px;object-fit:cover;border-radius:12px;background:#ece9e2"></a></td>`
    : '';
  const secondary = m.secondary.map((s) => `<a href="${esc(s.url)}" class="muted" style="color:#8e8b84;font:13px ${SANS};text-decoration:underline">${esc(s.label)}</a>`).join(' &nbsp;·&nbsp; ');

  return `
  <tr><td class="card" style="background:#ffffff;border:1px solid #ece9e2;border-radius:20px;padding:22px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      ${image}
      <td valign="top">
        <span class="badge" style="display:inline-block;padding:4px 10px;border-radius:999px;background:${bbg};color:${bc};font:600 11px ${SANS};letter-spacing:.6px;text-transform:uppercase">${esc(m.badge)}</span>
        <div class="text" style="margin:10px 0 0;font:400 22px/1.2 ${SERIF};color:#17161a">${esc(m.name)}</div>
        ${m.color ? `<div class="muted" style="margin:4px 0 0;font:13px ${SANS};color:#8e8b84">${esc(m.color)}</div>` : ''}
        ${price}
      </td>
    </tr></table>
    ${insight}
    ${m.lines.map((l) => `<div class="text2" style="margin:12px 0 0;font:14px/1.55 ${SANS};color:#3d3a35">${esc(l)}</div>`).join('')}
    ${chipsHtml(m.chips)}
    ${rowsHtml(m.stores, '📍 ')}
    ${rowsHtml(m.colors)}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 0"><tr><td class="cta" style="border-radius:999px;background:#17161a">
      <a href="${esc(m.cta.url)}" class="cta-a" style="display:inline-block;padding:12px 22px;font:600 14px ${SANS};color:#f6f4ef;text-decoration:none">${esc(m.cta.label)} →</a>
    </td></tr></table>
    ${secondary ? `<div style="margin:14px 0 0">${secondary}</div>` : ''}
  </td></tr>
  <tr><td style="height:14px;line-height:14px;font-size:0">&nbsp;</td></tr>`;
}

export function emailHtml(messages) {
  const base = panelUrl();
  const preheader = messages.map((m) => m.subject).join(' · ');
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style>
  @media (prefers-color-scheme: dark) {
    .bg { background:#0c0c0d !important; }
    .card { background:#151517 !important; border-color:#26262a !important; }
    .text { color:#f2efe8 !important; }
    .text2 { color:#c9c5bc !important; }
    .muted { color:#8e8b84 !important; }
    .line { border-color:#26262a !important; color:#f2efe8 !important; }
    .cta { background:#d4b98c !important; }
    .cta-a { color:#17140f !important; }
    .brand { color:#d4b98c !important; }
    .off { background:#f2efe8 !important; color:#17161a !important; }
    .badge { background:rgba(255,255,255,.08) !important; }
    .chip-in { background:rgba(134,211,169,.12) !important; color:#86d3a9 !important; border-color:rgba(134,211,169,.35) !important; }
    .chip-out { background:rgba(255,255,255,.05) !important; color:#8e8b84 !important; border-color:#2a2a2e !important; }
    .chip-missing { background:rgba(236,143,128,.12) !important; color:#ec8f80 !important; border-color:rgba(236,143,128,.35) !important; }
    .ins-good { background:rgba(134,211,169,.12) !important; color:#86d3a9 !important; }
    .ins-warn { background:rgba(240,194,123,.12) !important; color:#f0c27b !important; }
  }
  @media (max-width: 480px) { .card { padding:18px !important; } }
</style></head>
<body style="margin:0;padding:0;background:#f4f2ed" class="bg">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:#f4f2ed"><tr><td align="center" style="padding:28px 14px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:0 6px 18px"><span class="brand" style="font:400 24px ${SERIF};color:#9a7a45">Ürün Takip</span></td></tr>
    ${messages.map(cardHtml).join('')}
    <tr><td class="muted" style="padding:6px 6px 0;font:12px/1.6 ${SANS};color:#8e8b84">
      ${base ? `Takip listeni <a href="${esc(base)}" class="muted" style="color:#8e8b84">panelden</a> yönetebilirsin.` : ''}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function emailText(messages) {
  return messages
    .map((m) =>
      [
        m.subject,
        m.price != null ? `Fiyat: ${tl(m.price)}${m.oldPrice > m.price ? ` (önce ${tl(m.oldPrice)})` : ''}` : null,
        m.insight?.text,
        ...m.lines,
        m.chips?.map((c) => c.label).join(', '),
        m.stores?.map((s) => `${s.name}: ${s.sizes.join(', ')}`).join('\n'),
        m.colors?.map((s) => `${s.name}: ${s.sizes.join(', ')}`).join('\n'),
        `${m.cta.label}: ${m.cta.url}`,
        ...m.secondary.map((s) => `${s.label}: ${s.url}`),
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

function adminHtml(items) {
  return `<div style="font:14px/1.6 ${SANS};color:#17161a;max-width:560px">
    <div style="font:400 22px ${SERIF};color:#9a7a45;margin-bottom:12px">Ürün Takip · Yönetici</div>
    ${items.map((i) => `<div style="border:1px solid #ece9e2;border-radius:12px;padding:12px 14px;margin-bottom:10px"><b>${esc(i.subject)}</b><br>${i.lines.map(esc).join('<br>')}</div>`).join('')}
  </div>`;
}

// Telefonda kısa metin (ntfy ve Web Push için)
function shortBody(m) {
  return [
    m.price != null ? `${tl(m.price)}${m.oldPrice > m.price ? ` (önce ${tl(m.oldPrice)})` : ''}` : null,
    m.insight?.text,
    m.chips?.length && m.kind !== 'start' ? `Beden: ${m.chips.map((c) => c.label).join(', ')}` : null,
    m.stores?.map((s) => `${s.name}: ${s.sizes.join(', ')}`).join('\n'),
    m.colors?.map((s) => `${s.name}: ${s.sizes.join(', ')}`).join('\n'),
    m.kind === 'start' || m.kind === 'reminder' || m.kind === 'broken' ? m.lines[0] : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function createOutbox({ dryRun = false, vapidPublicKey = null } = {}) {
  const emails = new Map(); // adres -> mesajlar
  const ntfys = [];
  const webPushes = [];
  const admin = [];

  let mailer = null;
  const sendMail = async (to, mail) => {
    const user = (process.env.GMAIL_USER ?? '').trim();
    mailer ??= nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass: (process.env.GMAIL_APP_PASSWORD ?? '').replace(/\s+/g, '') },
    });
    try {
      await mailer.sendMail({ from: `Ürün Takip <${user}>`, to, ...mail });
      return true;
    } catch (e) {
      console.error(`E-posta gönderilemedi: ${e.message}`);
      return false;
    }
  };

  return {
    add(watch, product, event) {
      const message = describe(event, product, watch);
      if (watch.email) {
        if (!emails.has(watch.email)) emails.set(watch.email, []);
        emails.get(watch.email).push(message);
      }
      if (watch.ntfy) ntfys.push({ topic: watch.ntfy, message });
      for (const sub of watch.push ?? []) webPushes.push({ sub, message, tag: `urun-${watch.id}-${event.type}` });
    },

    // Yöneticiye (ADMIN_EMAIL) giden sistem uyarıları
    addAdmin(subject, lines) {
      admin.push({ subject, lines });
    },

    get size() {
      return [...emails.values()].reduce((n, list) => n + list.length, 0) + ntfys.length + webPushes.length + admin.length;
    },

    // Kullanıcı bildirimleri. Hata olursa diğerlerine devam eder.
    // Dönüş: başarısız sayısı ve artık geçersiz olan Web Push abonelikleri
    async flush() {
      let failed = 0;
      const expired = [];

      if (dryRun) {
        for (const [to, list] of emails) for (const m of list) console.log(`[e-posta → ${to}] ${m.subject}\n  ${emailText([m]).split('\n').slice(1).join('\n  ')}`);
        for (const p of ntfys) console.log(`[ntfy → ${p.topic}] ${p.message.subject}`);
        for (const p of webPushes) console.log(`[telefon] ${p.message.subject}\n  ${shortBody(p.message).split('\n').join('\n  ')}`);
        return { failed, expired };
      }

      for (const [to, list] of emails) {
        const ok = await sendMail(to, {
          subject: list.length === 1 ? list[0].subject : `${list.length} yeni bildirim · ${list[0].subject}`,
          text: emailText(list),
          html: emailHtml(list),
        });
        if (!ok) failed += list.length;
      }

      for (const { topic, message: m } of ntfys) {
        try {
          const actions = [{ action: 'view', label: m.cta.label, url: m.cta.url, clear: true }];
          for (const s of m.secondary) actions.push({ action: 'view', label: s.label, url: s.url, clear: true });
          const res = await fetch(process.env.NTFY_SERVER || 'https://ntfy.sh', {
            method: 'POST',
            body: JSON.stringify({
              topic,
              title: m.subject,
              message: shortBody(m) || m.name,
              click: m.url,
              tags: m.tags,
              priority: m.priority,
              actions: actions.slice(0, 3),
              ...(m.image ? { attach: m.image, filename: 'urun.jpg' } : {}),
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (e) {
          failed++;
          console.error(`ntfy bildirimi gönderilemedi: ${e.message}`);
        }
      }

      const privateKey = (process.env.VAPID_PRIVATE_KEY ?? '').trim();
      if (webPushes.length && (!privateKey || !vapidPublicKey)) {
        console.error('Telefon bildirimi gönderilemedi: VAPID_PRIVATE_KEY ayarlanmamış');
        failed += webPushes.length;
      } else if (webPushes.length) {
        // VAPID 'subject' https ya da mailto olmalı
        const subject = panelUrl().startsWith('https://') ? panelUrl() : 'mailto:bildirim@example.com';
        webpush.setVapidDetails(subject, vapidPublicKey, privateKey);
        for (const { sub, message: m, tag } of webPushes) {
          try {
            const payload = JSON.stringify({
              title: m.subject,
              body: shortBody(m) || m.name,
              url: m.url,
              image: m.image,
              tag,
              leave: m.secondary[0]?.url ?? null,
            });
            await webpush.sendNotification(sub, payload, { TTL: 24 * 3600, urgency: m.priority >= 4 ? 'high' : 'normal', timeout: 15000 });
          } catch (e) {
            if (e.statusCode === 404 || e.statusCode === 410) expired.push(sub.endpoint);
            else {
              failed++;
              console.error(`Telefon bildirimi gönderilemedi: ${e.statusCode ?? ''} ${e.message}`);
            }
          }
        }
      }
      return { failed, expired };
    },

    async flushAdmin() {
      const to = (process.env.ADMIN_EMAIL ?? '').trim();
      if (!admin.length) return 0;
      if (dryRun || !to) {
        for (const a of admin) console.log(`[yönetici] ${a.subject}\n  ${a.lines.join('\n  ')}`);
        return 0;
      }
      const ok = await sendMail(to, {
        subject: admin.length === 1 ? `[Yönetici] ${admin[0].subject}` : `[Yönetici] ${admin.length} sistem uyarısı`,
        text: admin.map((a) => `${a.subject}\n${a.lines.join('\n')}`).join('\n\n'),
        html: adminHtml(admin),
      });
      return ok ? 0 : admin.length;
    },
  };
}
