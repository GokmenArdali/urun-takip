// E-postadaki linklerin açtığı küçük onay sayfaları (panelle aynı görünüm)

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function linkPage({ title, message, product, button, danger, done }) {
  const card = product
    ? `<a class="product" href="${esc(product.url)}" target="_blank" rel="noopener">
        ${product.image ? `<img src="${esc(product.image)}" alt="">` : '<div class="ph"></div>'}
        <div><div class="name">${esc(product.title ?? 'Ürün')}</div>${product.color ? `<div class="sub">${esc(product.color)}</div>` : ''}</div>
      </a>`
    : '';
  const action = button
    ? `<form method="post"><button class="btn ${danger ? 'danger' : ''}" type="submit">${esc(button)}</button></form>`
    : '';
  return `<!doctype html>
<html lang="tr" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · Ürün Takip</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<script>try{var t=localStorage.getItem('tema');if(t==='light')document.documentElement.dataset.theme='light'}catch(e){}</script>
<style>
  :root[data-theme="dark"] { --bg:#0c0c0d; --surface:#151517; --line:rgba(255,255,255,.08); --text:#f2efe8; --muted:#8e8b84; --accent:#d4b98c; --accent-ink:#17140f; --danger:#e58a7c; }
  :root[data-theme="light"] { --bg:#f6f4ef; --surface:#ffffff; --line:rgba(23,22,26,.09); --text:#17161a; --muted:#6f6b63; --accent:#9a7a45; --accent-ink:#ffffff; --danger:#b54a3c; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px 16px; background:var(--bg); color:var(--text); font:15px/1.5 Inter, system-ui, sans-serif; }
  main { width:100%; max-width:420px; text-align:center; }
  .brand { font-family:"Instrument Serif", Georgia, serif; font-size:22px; letter-spacing:.2px; color:var(--muted); margin-bottom:28px; }
  .brand b { color:var(--accent); font-weight:400; }
  h1 { font-family:"Instrument Serif", Georgia, serif; font-weight:400; font-size:36px; line-height:1.1; margin:0 0 10px; }
  p { color:var(--muted); margin:0 0 24px; }
  .product { display:flex; gap:14px; align-items:center; text-align:left; padding:12px; border:1px solid var(--line); border-radius:16px; background:var(--surface); color:inherit; text-decoration:none; margin-bottom:24px; }
  .product img, .ph { width:64px; height:80px; object-fit:cover; border-radius:10px; background:var(--line); flex:none; }
  .name { font-weight:500; }
  .sub { color:var(--muted); font-size:13px; }
  .btn { width:100%; padding:14px 18px; border-radius:999px; border:0; font:600 15px Inter, sans-serif; cursor:pointer; background:var(--accent); color:var(--accent-ink); }
  .btn.danger { background:transparent; color:var(--danger); border:1px solid var(--danger); }
  .done { width:52px; height:52px; margin:0 auto 18px; border-radius:50%; display:grid; place-items:center; background:var(--accent); color:var(--accent-ink); font-size:24px; }
  .back { display:inline-block; margin-top:22px; color:var(--muted); font-size:13px; }
</style>
</head>
<body>
<main>
  <div class="brand">Ürün <b>Takip</b></div>
  ${done ? '<div class="done">✓</div>' : ''}
  <h1>${esc(title)}</h1>
  <p>${esc(message)}</p>
  ${card}
  ${action}
  <a class="back" href="/">Panele git</a>
</main>
</body>
</html>`;
}
