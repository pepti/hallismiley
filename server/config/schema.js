// Shared schema DDL — single source of truth for migrate.js and tests/globalSetup.js.
// Add new migrations as additional objects in the array; never edit existing entries.

const migrations = [
  {
    name: '001_initial_schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS projects (
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
      )`,
      `CREATE OR REPLACE FUNCTION set_updated_at()
       RETURNS TRIGGER AS $$
       BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
       $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects`,
      `CREATE TRIGGER trg_projects_updated_at
         BEFORE UPDATE ON projects
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
      `CREATE INDEX IF NOT EXISTS idx_projects_category ON projects (category)`,
      `CREATE INDEX IF NOT EXISTS idx_projects_featured ON projects (featured)`,
      `CREATE INDEX IF NOT EXISTS idx_projects_year     ON projects (year DESC)`,
      `CREATE TABLE IF NOT EXISTS refresh_tokens (
        id         SERIAL PRIMARY KEY,
        token_hash VARCHAR(64)  NOT NULL UNIQUE,
        issued_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ  NOT NULL,
        revoked    BOOLEAN      NOT NULL DEFAULT FALSE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens (token_hash)`,
    ],
  },
  {
    name: '002_auth_users',
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        email                 TEXT        NOT NULL UNIQUE,
        username              TEXT        NOT NULL UNIQUE,
        password_hash         TEXT        NOT NULL,
        role                  TEXT        NOT NULL DEFAULT 'admin'
                                          CHECK (role IN ('admin', 'editor', 'viewer')),
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at         TIMESTAMPTZ,
        failed_login_attempts INTEGER     NOT NULL DEFAULT 0,
        locked_until          TIMESTAMPTZ
      )`,
      `CREATE INDEX IF NOT EXISTS idx_users_email    ON users (email)`,
      `CREATE INDEX IF NOT EXISTS idx_users_username ON users (username)`,
      `DROP TRIGGER IF EXISTS trg_users_updated_at ON users`,
      `CREATE TRIGGER trg_users_updated_at
         BEFORE UPDATE ON users
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
      `CREATE TABLE IF NOT EXISTS user_sessions (
        id          TEXT        PRIMARY KEY,
        user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ip_address  TEXT,
        user_agent  TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id    ON user_sessions (user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions (expires_at)`,
      `DROP TABLE IF EXISTS refresh_tokens CASCADE`,
    ],
  },
  {
    name: '003_user_system',
    statements: [
      // Migrate old roles before changing the constraint
      `UPDATE users SET role = 'user' WHERE role IN ('editor', 'viewer')`,
      `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`,
      `ALTER TABLE users ADD CONSTRAINT users_role_check
         CHECK (role IN ('admin', 'moderator', 'user'))`,
      `ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user'`,
      // Profile fields
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone        TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar       TEXT NOT NULL DEFAULT 'avatar-01.svg'`,
      // Email verification
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified       BOOLEAN     NOT NULL DEFAULT FALSE`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token   TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_expires TIMESTAMPTZ`,
      // Password reset
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token   TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMPTZ`,
      // Account disable / soft-delete
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled        BOOLEAN     NOT NULL DEFAULT FALSE`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at     TIMESTAMPTZ`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_reason TEXT`,
    ],
  },
  {
    name: '004_project_media',
    statements: [
      `CREATE TABLE IF NOT EXISTS project_media (
        id          SERIAL      PRIMARY KEY,
        project_id  INTEGER     NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        file_path   TEXT        NOT NULL,
        media_type  TEXT        NOT NULL CHECK (media_type IN ('image', 'video')),
        sort_order  INTEGER     NOT NULL DEFAULT 0,
        caption     TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_project_media_project_id ON project_media (project_id)`,
    ],
  },
  {
    name: '005_site_content',
    statements: [
      `CREATE TABLE IF NOT EXISTS site_content (
        key        TEXT        PRIMARY KEY,
        value      JSONB       NOT NULL,
        updated_by TEXT        REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `INSERT INTO site_content (key, value) VALUES (
        'home_skills',
        '{"eyebrow":"Two Decades of","title":"Craft\\n& Code","description":"Twenty years of carpentry precision — reading grain, cutting to the line, fitting without gaps — applied to every line of code. The same principles that make a mortise-and-tenon joint last a century make software maintainable.","items":[{"label":"Languages","value":"JS · Python · SQL"},{"label":"Backend","value":"Node · Express · REST"},{"label":"Database","value":"PostgreSQL · Redis"},{"label":"Carpentry","value":"20+ yrs hand & power tools"},{"label":"Cloud","value":"Azure · Railway"},{"label":"Security","value":"OWASP · OAuth 2.0 · RS256"}],"image_url":"https://images.unsplash.com/photo-1564603527476-8837eac5a22f?w=700&h=900&fit=crop&q=80&auto=format"}'::jsonb
      ) ON CONFLICT (key) DO NOTHING`,
    ],
  },
  {
    name: '008_news',
    statements: [
      `CREATE TABLE IF NOT EXISTS news_articles (
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
      )`,
      `CREATE INDEX IF NOT EXISTS idx_news_articles_slug      ON news_articles (slug)`,
      `CREATE INDEX IF NOT EXISTS idx_news_articles_published ON news_articles (published, published_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_news_articles_category  ON news_articles (category)`,
      `CREATE INDEX IF NOT EXISTS idx_news_articles_author_id ON news_articles (author_id)`,
      `DROP TRIGGER IF EXISTS trg_news_articles_updated_at ON news_articles`,
      `CREATE TRIGGER trg_news_articles_updated_at
         BEFORE UPDATE ON news_articles
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
    ],
  },
  {
    name: '009_user_party_access',
    statements: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS party_access BOOLEAN NOT NULL DEFAULT FALSE`,
    ],
  },
];

module.exports = { migrations };
