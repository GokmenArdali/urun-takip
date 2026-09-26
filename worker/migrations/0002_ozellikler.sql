-- Ürün resmi, sitedeki eski (üstü çizili) fiyat ve Zara mağaza stoğu
ALTER TABLE products ADD COLUMN image TEXT;
ALTER TABLE products ADD COLUMN list_price REAL;
ALTER TABLE products ADD COLUMN stores TEXT;            -- JSON: [{id, name, sizes: [{name, stock}]}]

-- Yüzde hedef, durdurma, mağaza stoğu takibi, son etkinlik (hatırlatma için)
ALTER TABLE watches ADD COLUMN target_percent REAL;
ALTER TABLE watches ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE watches ADD COLUMN store_stock INTEGER NOT NULL DEFAULT 0;
ALTER TABLE watches ADD COLUMN last_activity INTEGER;
UPDATE watches SET last_activity = created_at WHERE last_activity IS NULL;

-- Fiyat geçmişi: fiyat değişince ve fiyat aynı kalsa bile 12 saatte bir kayıt
CREATE TABLE IF NOT EXISTS price_history (
  product_id INTEGER NOT NULL,
  t INTEGER NOT NULL,
  price REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS price_history_product ON price_history(product_id, t);
