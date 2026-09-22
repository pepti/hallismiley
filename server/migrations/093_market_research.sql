-- 093_market_research — reference copy of the migration in server/config/schema.js
-- Market-research tables for the Markaðsstjóri agent (Halli, 2026-09-01):
-- Icelandic companies gathered from public sources (Skatturinn fyrirtækjaskrá +
-- ársreikningaskrá, keldan.is public figures, Hagstofa aggregates, Creditinfo's
-- public list, trade-association member lists). One row per company, one row
-- per company-year of figures, and sizing aggregates. Written only by
-- server/scripts/market-import.js from a gitignored staging JSON
-- (company/markadur/market.json). Nothing in the app reads these yet — the
-- admin list view is ENHANCEMENTS #16. Pure "expand" (invariant 14): three new
-- tables, no ALTER.
--
-- Money is BIGINT ISK (072 convention). admin_cost_ratio is Halli's fit signal
-- ("skrifstofu- og stjórnunarkostnaður" / tekjur) and is GENERATED so it can
-- never disagree with its inputs — the importer must not write it.

CREATE TABLE IF NOT EXISTS market_companies (
  id                SERIAL PRIMARY KEY,
  kennitala         VARCHAR(10)  NOT NULL UNIQUE CHECK (kennitala ~ '^[0-9]{10}$'),
  name              TEXT         NOT NULL,
  isat_code         VARCHAR(10),
  isat_label        TEXT,
  sector_group      VARCHAR(20)  NOT NULL DEFAULT 'annad'
                    CHECK (sector_group IN ('smasala','heildsala','idnadur','thjonusta','annad')),
  postcode          VARCHAR(5),
  municipality      TEXT,
  website           TEXT,
  platform_detected VARCHAR(20)
                    CHECK (platform_detected IS NULL OR platform_detected IN
                      ('shopify','wix','wordpress','woocommerce','squarespace',
                       'dk','regla','payday','none','other','custom','unknown')),
  list_type         VARCHAR(10)  NOT NULL CHECK (list_type IN ('smb','large')),
  fit_score         NUMERIC(5,2) CHECK (fit_score IS NULL OR fit_score BETWEEN 0 AND 100),
  tier_fit          VARCHAR(10)  CHECK (tier_fit IS NULL OR tier_fit IN ('vefur','verslun','rekstur')),
  fit_notes         TEXT,
  summary           TEXT,
  status            VARCHAR(20)  NOT NULL DEFAULT 'candidate'
                    CHECK (status IN ('candidate','researched','shortlist','handed_to_sales','rejected')),
  sources           JSONB        NOT NULL DEFAULT '[]'::jsonb
                    CHECK (jsonb_typeof(sources) = 'array'),
  report_path       TEXT,
  researched_by     TEXT,
  researched_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_companies_list_status ON market_companies (list_type, status);

CREATE INDEX IF NOT EXISTS idx_market_companies_sector ON market_companies (sector_group);

CREATE INDEX IF NOT EXISTS idx_market_companies_fit ON market_companies (fit_score DESC NULLS LAST);

DROP TRIGGER IF EXISTS trg_market_companies_updated_at ON market_companies;

CREATE TRIGGER trg_market_companies_updated_at BEFORE UPDATE ON market_companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS market_financials (
  id                   SERIAL PRIMARY KEY,
  company_id           INTEGER  NOT NULL REFERENCES market_companies(id) ON DELETE CASCADE,
  fiscal_year          SMALLINT NOT NULL CHECK (fiscal_year BETWEEN 1990 AND 2100),
  revenue_isk          BIGINT   CHECK (revenue_isk IS NULL OR revenue_isk >= 0),
  operating_profit_isk BIGINT,
  net_profit_isk       BIGINT,
  equity_isk           BIGINT,
  total_assets_isk     BIGINT   CHECK (total_assets_isk IS NULL OR total_assets_isk >= 0),
  admin_cost_isk       BIGINT   CHECK (admin_cost_isk IS NULL OR admin_cost_isk >= 0),
  admin_cost_ratio     NUMERIC(8,4) GENERATED ALWAYS AS (
                         CASE WHEN revenue_isk > 0 AND admin_cost_isk IS NOT NULL
                              THEN ROUND(admin_cost_isk::numeric / revenue_isk, 4) END) STORED,
  employees            INTEGER      CHECK (employees IS NULL OR employees >= 0),
  fte                  NUMERIC(8,2) CHECK (fte IS NULL OR fte >= 0),
  source_url           TEXT,
  extracted_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, fiscal_year)
);

CREATE INDEX IF NOT EXISTS idx_market_financials_year ON market_financials (fiscal_year, revenue_isk DESC NULLS LAST);

DROP TRIGGER IF EXISTS trg_market_financials_updated_at ON market_financials;

CREATE TRIGGER trg_market_financials_updated_at BEFORE UPDATE ON market_financials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS market_stats (
  id             SERIAL PRIMARY KEY,
  sector_group   VARCHAR(20) NOT NULL DEFAULT 'all'
                 CHECK (sector_group IN ('all','smasala','heildsala','idnadur','thjonusta','annad')),
  isat_code      VARCHAR(10) NOT NULL DEFAULT '',
  size_class     VARCHAR(20) NOT NULL DEFAULT 'all',
  metric         VARCHAR(40) NOT NULL,
  value          NUMERIC(20,2) NOT NULL,
  unit           VARCHAR(10) NOT NULL DEFAULT 'count'
                 CHECK (unit IN ('count','isk','fte','pct')),
  reference_year SMALLINT NOT NULL CHECK (reference_year BETWEEN 1990 AND 2100),
  source_url     TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sector_group, isat_code, size_class, metric, reference_year)
);

DROP TRIGGER IF EXISTS trg_market_stats_updated_at ON market_stats;

CREATE TRIGGER trg_market_stats_updated_at BEFORE UPDATE ON market_stats
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
