// E-postadaki linklerin açtığı küçük onay sayfaları (panelle aynı görünüm)

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function linkPage({ title, message, product, button, danger, done }) {
  const card = product
    ? `<a class="product" href="${esc(product.url)}" target="_blank" rel="noopener">
        ${product.image ? `<img src="${esc(product.image)}" alt="" referrerpolicy="no-referrer">` : '<div class="ph"></div>'}
        <div>${product.color ? `<div class="label">${esc(product.color)}</div>` : ''}<div class="name">${esc(product.title ?? 'Ürün')}</div></div>
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
<link rel="icon" type="image/png" href="/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400&family=Hanken+Grotesk:wght@400;500;600&display=swap" rel="stylesheet">
<script>try{if(localStorage.getItem('tema')==='light')document.documentElement.dataset.theme='light'}catch(e){}</script>
<style>
  :root[data-theme="dark"] { --bg:#0b0b0b; --raise:#171717; --line:#232323; --line-2:#343434; --text:#ecebe7; --muted:#7c7a75; --sale:#e0735e; --inv-bg:#ecebe7; --inv-text:#0b0b0b; }
  :root[data-theme="light"] { --bg:#f7f6f3; --raise:#efede8; --line:#e4e1db; --line-2:#cfcbc3; --text:#121212; --muted:#8a867e; --sale:#b3412c; --inv-bg:#121212; --inv-text:#f7f6f3; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; flex-direction:column; background:var(--bg); color:var(--text); font:15px/1.5 "Hanken Grotesk", "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing:antialiased; }
  header { height:64px; display:flex; align-items:center; justify-content:center; border-bottom:1px solid var(--line); }
  .wordmark { font-size:13px; font-weight:600; letter-spacing:.34em; text-transform:uppercase; color:inherit; text-decoration:none; }
  main { flex:1; display:grid; place-items:center; padding:48px 18px; }
  .box { width:100%; max-width:400px; }
  .label { font-size:11px; font-weight:500; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); }
  h1 { font-family:"Bodoni Moda", Didot, serif; font-weight:400; font-size:42px; line-height:1.05; margin:14px 0 12px; letter-spacing:-.4px; }
  p { color:var(--muted); margin:0 0 30px; }
  .product { display:flex; gap:16px; align-items:center; padding:18px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); color:inherit; text-decoration:none; margin-bottom:30px; }
  .product img, .ph { width:60px; height:80px; object-fit:cover; background:var(--raise); flex:none; }
  .name { font-size:14px; margin-top:4px; }
  .btn { width:100%; height:48px; border:1px solid var(--inv-bg); background:var(--inv-bg); color:var(--inv-text); font:600 11.5px "Hanken Grotesk", sans-serif; letter-spacing:.16em; text-transform:uppercase; cursor:pointer; }
  .btn.danger { background:transparent; color:var(--sale); border-color:var(--sale); }
  .back { display:inline-block; margin-top:24px; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); text-underline-offset:5px; }
</style>
</head>
<body>
<header><a class="wordmark" href="/">Ürün Takip</a></header>
<main>
  <div class="box">
    <div class="label">${done ? 'Tamamlandı' : 'Onay'}</div>
    <h1>${esc(title)}</h1>
    <p>${esc(message)}</p>
    ${card}
    ${action}
    <a class="back" href="/">Panele git</a>
  </div>
</main>
</body>
</html>`;
}
