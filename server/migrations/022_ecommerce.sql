-- Migration: 022_ecommerce
-- eCommerce (Shop) MVP — products, orders, order_items, product_images,
-- plus a processed_webhook_events table for Stripe idempotency.
--
-- Money is stored in the smallest currency unit as an integer:
--   ISK has no subunit (1 ISK = 1 unit).
--   EUR is stored in cents.
-- Prices are VAT-inclusive (24% VSK) — no separate tax line item.
--
-- Authoritative copy lives in server/config/schema.js; this file is for
-- human reference and manual psql application.

CREATE TABLE IF NOT EXISTS products (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug          TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  description   TEXT        NOT NULL DEFAULT '',
  price_isk     INTEGER     NOT NULL CHECK (price_isk > 0),
  price_eur     INTEGER     NOT NULL CHECK (price_eur > 0),
  stock         INTEGER     NOT NULL DEFAULT 0 CHECK (stock >= 0),
  weight_grams  INTEGER,
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_slug   ON products (slug);
CREATE INDEX IF NOT EXISTS idx_products_active ON products (active) WHERE active = TRUE;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS product_images (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id  TEXT        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         TEXT        NOT NULL,
  position    INTEGER     NOT NULL DEFAULT 0,
  alt_text    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images (product_id);

CREATE TABLE IF NOT EXISTS orders (
  id                        TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_number              TEXT        NOT NULL UNIQUE,
  user_id                   TEXT        REFERENCES users(id) ON DELETE SET NULL,
  guest_email               TEXT,
  guest_name                TEXT,
  currency                  TEXT        NOT NULL CHECK (currency IN ('ISK', 'EUR')),
  subtotal                  INTEGER     NOT NULL CHECK (subtotal >= 0),
  shipping                  INTEGER     NOT NULL DEFAULT 0 CHECK (shipping >= 0),
  total                     INTEGER     NOT NULL CHECK (total >= 0),
  status                    TEXT        NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending','paid','failed','shipped','cancelled','refunded')),
  shipping_method           TEXT        NOT NULL CHECK (shipping_method IN ('flat_rate','local_pickup')),
  shipping_address          JSONB,
  stripe_session_id         TEXT        UNIQUE,
  stripe_payment_intent_id  TEXT        UNIQUE,
  paid_at                   TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_user_id           ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_session_id ON orders (stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_status            ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at_desc   ON orders (created_at DESC);

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS order_items (
  id                      TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id                TEXT        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id              TEXT        NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name_snapshot   TEXT        NOT NULL,
  product_price_snapshot  INTEGER     NOT NULL CHECK (product_price_snapshot >= 0),
  quantity                INTEGER     NOT NULL CHECK (quantity > 0),
  currency                TEXT        NOT NULL CHECK (currency IN ('ISK', 'EUR')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  id          TEXT        PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
