-- Migration: 001_initial_schema
-- Applied automatically by server/scripts/migrate.js on startup.
-- Run manually: psql $DATABASE_URL -f server/migrations/001_initial_schema.sql

CREATE TABLE IF NOT EXISTS projects (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(200)  NOT NULL,
  description TEXT          NOT NULL,
  category    VARCHAR(50)   NOT NULL CHECK (category IN ('carpentry', 'tech')),
  year        SMALLINT      NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  tools_used  TEXT[]        NOT NULL DEFAULT '{}',
  image_url   TEXT,
  featured    BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_projects_category ON projects (category);
CREATE INDEX IF NOT EXISTS idx_projects_featured ON projects (featured);
CREATE INDEX IF NOT EXISTS idx_projects_year     ON projects (year DESC);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         SERIAL PRIMARY KEY,
  token_hash VARCHAR(64)  NOT NULL UNIQUE,
  issued_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ  NOT NULL,
  revoked    BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens (token_hash);
