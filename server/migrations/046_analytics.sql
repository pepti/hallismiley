-- Migration: 045_analytics
-- First-party, cookieless web analytics.
--   page_views       — high-volume columnar table the dashboard aggregates over.
--   analytics_events — low-volume, extensible conversion table (event_type + JSONB props).
--
-- NO raw PII at rest: visitor_token is an irreversible daily hash of
-- (ip + user-agent + a rotating in-memory salt). The salt lives only in process
-- memory and rotates each UTC day, so a token cannot be reversed to an IP and
-- cannot be correlated across days. See server/services/analyticsSalt.js.
--
-- Authoritative copy lives in server/config/schema.js; this file is for
-- human reference and manual psql application.

CREATE TABLE IF NOT EXISTS page_views (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  path          TEXT        NOT NULL,
  referrer_host TEXT,
  device        TEXT        NOT NULL DEFAULT 'unknown'
                            CHECK (device IN ('mobile','tablet','desktop','bot','unknown')),
  browser       TEXT        NOT NULL DEFAULT 'unknown',
  os            TEXT        NOT NULL DEFAULT 'unknown',
  locale        TEXT        NOT NULL DEFAULT 'unknown'
                            CHECK (locale IN ('en','is','unknown')),
  visitor_token TEXT        NOT NULL,
  view_date     DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_page_views_view_date     ON page_views (view_date);
CREATE INDEX IF NOT EXISTS idx_page_views_path          ON page_views (path);
CREATE INDEX IF NOT EXISTS idx_page_views_visitor_date  ON page_views (view_date, visitor_token);
CREATE INDEX IF NOT EXISTS idx_page_views_referrer_host ON page_views (referrer_host) WHERE referrer_host IS NOT NULL;

CREATE TABLE IF NOT EXISTS analytics_events (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_type    TEXT        NOT NULL
                            CHECK (event_type IN ('contact_submit','party_rsvp','shop_checkout')),
  path          TEXT,
  locale        TEXT,
  props         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  event_date    DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type_date ON analytics_events (event_type, event_date);
