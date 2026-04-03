-- Migration 008: News articles system
-- Adds a database-backed news/blog feed with slugs, categories, and publish state.

CREATE TABLE IF NOT EXISTS news_articles (
  id           SERIAL       PRIMARY KEY,
  title        TEXT         NOT NULL,
  slug         TEXT         NOT NULL UNIQUE,
  summary      TEXT         NOT NULL,
  body         TEXT         NOT NULL,
  cover_image  TEXT,
  category     TEXT         NOT NULL DEFAULT 'news',
  author_id    TEXT         REFERENCES users(id) ON DELETE SET NULL,
  published    BOOLEAN      NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT news_articles_summary_length CHECK (LENGTH(summary) <= 300)
);

CREATE INDEX IF NOT EXISTS idx_news_articles_slug         ON news_articles (slug);
CREATE INDEX IF NOT EXISTS idx_news_articles_published    ON news_articles (published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_category     ON news_articles (category);
CREATE INDEX IF NOT EXISTS idx_news_articles_author_id    ON news_articles (author_id);

DROP TRIGGER IF EXISTS trg_news_articles_updated_at ON news_articles;
CREATE TRIGGER trg_news_articles_updated_at
  BEFORE UPDATE ON news_articles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
