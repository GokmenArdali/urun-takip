-- Ürünün diğer renkleri ve bedenleri (başka renkte stok uyarısı için)
ALTER TABLE products ADD COLUMN colors TEXT;       -- JSON: [{name, current, sizes: [{name, available}]}]
ALTER TABLE watches ADD COLUMN other_colors INTEGER NOT NULL DEFAULT 0;

-- Telefon/bilgisayar bildirimleri (Web Push). Kişi, e-posta ya da ntfy konusuyla eşleşir.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  email TEXT,
  ntfy TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subscriptions_email ON push_subscriptions(email);
CREATE INDEX IF NOT EXISTS push_subscriptions_ntfy ON push_subscriptions(ntfy);
