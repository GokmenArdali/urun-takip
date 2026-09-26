-- Takip edilen ürünler (aynı linki birden fazla kişi takip edebilir, ürün bir kez kontrol edilir)
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  site TEXT NOT NULL,
  title TEXT,
  color TEXT,
  price REAL,
  sizes TEXT,               -- JSON: [{name, available, price}]
  last_checked INTEGER,     -- ms
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL
);

-- Kimin hangi ürünü hangi şartlarla takip ettiği
CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  owner TEXT NOT NULL,
  email TEXT,
  ntfy TEXT,
  sizes TEXT NOT NULL DEFAULT '[]',  -- JSON: istenen bedenler, boş = hepsi
  target_price REAL,
  fast INTEGER NOT NULL DEFAULT 0,
  state TEXT,                        -- JSON: son bilinen durum (kontrol programı yazar)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS watches_product ON watches(product_id);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
