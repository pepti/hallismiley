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
  {
    name: '010_party_tables',
    statements: [
      `CREATE TABLE IF NOT EXISTS party_rsvps (
        id               SERIAL      PRIMARY KEY,
        user_id          TEXT        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        attending        BOOLEAN     NOT NULL,
        dietary_needs    TEXT,
        plus_one         BOOLEAN     NOT NULL DEFAULT FALSE,
        plus_one_name    TEXT,
        plus_one_dietary TEXT,
        message          TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS party_guestbook (
        id         SERIAL      PRIMARY KEY,
        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message    TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS party_photos (
        id         SERIAL      PRIMARY KEY,
        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        file_path  TEXT        NOT NULL,
        caption    TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    ],
  },
  {
    name: '011_halli_bio_content',
    statements: [
      `INSERT INTO site_content (key, value) VALUES (
        'halli_bio',
        '{"hero_tagline":"Where wood meets code","beginning_eyebrow":"Chapter One","beginning_title":"The Beginning","beginning_text":"Born and raised on the edge of the North Atlantic, Halli grew up in Iceland. A land shaped by fire, ice, and the stubborn ingenuity of people who had no choice but to make things themselves. His grandfather built his own house with bare hands. His father kept that tradition alive in the garage on weekends, a place that smelled of pine shavings and linseed oil, where every problem had a solution if you were patient enough to find it.","beginning_text2":"At fourteen, he built his first piece of furniture. A small bookshelf, rough at the joints, proud in the room. It was never quite square. But it stood. That imperfect shelf taught him more about humility, precision, and persistence than any classroom ever would.","craft_eyebrow":"Chapter Two","craft_title":"The Craft","craft_text":"Carpentry chose Halli as much as he chose it. There is a philosophy in working with wood that no other material quite matches. It has grain, history, and personality. Each plank carries the memory of the tree it came from: the years of drought and plenty, the direction of the prevailing wind. To work with wood is to collaborate with something older than yourself.","craft_text2":"Over two decades, he has built dining tables that will outlast him, fitted kitchens into crooked old houses, and joined timber frames for buildings meant to stand a century. His philosophy has not changed since those first clumsy lessons: understand your material, respect your tools, measure twice.","craft_highlight1":"Furniture designed to outlast its maker","craft_highlight2":"Joinery cut by hand, fitted without filler","craft_highlight3":"Every piece built for its exact place and purpose","code_eyebrow":"Chapter Three","code_title":"The Code","code_text":"The path from wood to software was not a straight one. Late nights in a half-finished workshop, Halli started teaching himself to code. Not because he wanted to leave carpentry behind, but because he needed tools that did not exist yet. Inventory systems, project tracking, client portals. If he could build a cabinet, he could build a web application.","code_text2":"What surprised him was how familiar it all felt. The same discipline that keeps a workbench clean keeps a codebase maintainable. The same patience that lets you hand-cut a dovetail lets you debug a complex system. The vocabulary was different. The mindset was identical.","blend_eyebrow":"Chapter Four","blend_title":"The Blend","blend_quote":"A craftsman does not choose their tools at random. They choose the sharpest, the most honest — and they learn to use them until the tool becomes an extension of thought.","blend_text":"The way a craftsman thinks has a name in software: engineering. Not the noun, but the verb — the continuous act of making things more precise, more durable, more honest. Halli brings the same eye to a line of code that he brings to a mortise joint: is it right? Is it honest? Will it hold?","blend_text2":"His clients in both worlds have noticed this. There is a quietness to work done well that transcends medium. A well-fitted door closes with a soft click. A well-designed API does exactly what it says, nothing more, nothing less.","life_eyebrow":"Chapter Five","life_title":"Life Outside Work","life_text":"Between the workshop and the terminal, Halli is a husband and father who tries to leave both pursuits at the door when the evening calls for it. He hikes the Icelandic interior — highland plateaus where the only sound is wind and your own breathing — and returns with the particular clarity that only comes from distance.","life_text2":"Iceland is not just his home; it is his material. The long volcanic winters, the silence, the strange light of summer — all of it bleeds into how he works, what he makes, and what he values.","life_tile1":"Iceland","life_tile2":"Hiking","life_tile3":"Cooking","life_tile4":"Reading","life_tile5":"Coffee","future_eyebrow":"Chapter Six","future_title":"What is Next","future_text":"There are more tables to build. More systems to design. More problems that sit at the junction of physical and digital, waiting for someone who speaks both languages. The studio is taking shape — half workshop, half office — where the two disciplines share walls and tools and ideas.","future_text2":"If you are working on something interesting — a product, a building, a tool that does not exist yet — reach out. The best work always begins with a conversation.","counter1_num":"20+","counter1_label":"Years crafting wood","counter2_num":"10K+","counter2_label":"Lines of code written","counter3_num":"80+","counter3_label":"Projects completed","counter4_num":"1","counter4_label":"Island nation called home"}'::jsonb
      ) ON CONFLICT (key) DO NOTHING`,
    ],
  },
  {
    // Backfill columns added to 003_user_system after it was already applied in production.
    // email_verified and password_reset columns were retrofitted into 003 but never ran on prod.
    name: '012_backfill_auth_columns',
    statements: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified         BOOLEAN     NOT NULL DEFAULT FALSE`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token   TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMPTZ`,
    ],
  },
  {
    // Named sections within a project gallery (e.g. "Kitchen", "Living Room").
    // section_id on project_media is nullable — legacy rows and freshly-uploaded
    // unsorted media live in the "Ungrouped" bucket until an admin assigns them.
    name: '013_project_sections',
    statements: [
      `CREATE TABLE IF NOT EXISTS project_sections (
        id          SERIAL      PRIMARY KEY,
        project_id  INTEGER     NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name        TEXT        NOT NULL,
        sort_order  INTEGER     NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_project_sections_project_id ON project_sections (project_id)`,
      `ALTER TABLE project_media ADD COLUMN IF NOT EXISTS section_id INTEGER
         REFERENCES project_sections(id) ON DELETE SET NULL`,
      `CREATE INDEX IF NOT EXISTS idx_project_media_section_id ON project_media (section_id)`,
    ],
  },
  {
    // Optional free-text description shown under each section heading.
    // Empty / NULL description means the paragraph is not rendered to visitors.
    name: '014_project_section_description',
    statements: [
      `ALTER TABLE project_sections ADD COLUMN IF NOT EXISTS description TEXT`,
    ],
  },
  {
    // Dedicated Video section per project. Holds uploaded video files AND
    // YouTube embeds. Position is per-project (above or below the photo
    // gallery). Data-migrates any existing media_type='video' rows out of
    // project_media into project_videos.
    name: '015_project_videos',
    statements: [
      `CREATE TABLE IF NOT EXISTS project_videos (
        id          SERIAL      PRIMARY KEY,
        project_id  INTEGER     NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind        TEXT        NOT NULL CHECK (kind IN ('file', 'youtube')),
        file_path   TEXT,
        youtube_id  TEXT,
        title       TEXT,
        sort_order  INTEGER     NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT project_videos_payload_check CHECK (
          (kind = 'file'    AND file_path  IS NOT NULL AND youtube_id IS NULL) OR
          (kind = 'youtube' AND youtube_id IS NOT NULL AND file_path  IS NULL)
        )
      )`,
      `CREATE INDEX IF NOT EXISTS idx_project_videos_project_id ON project_videos (project_id)`,
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS video_section_position TEXT
         NOT NULL DEFAULT 'above_gallery'`,
      // CHECK constraint added separately so we can keep IF NOT EXISTS on the column
      `DO $$ BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint WHERE conname = 'projects_video_section_position_check'
         ) THEN
           ALTER TABLE projects ADD CONSTRAINT projects_video_section_position_check
             CHECK (video_section_position IN ('above_gallery', 'below_gallery'));
         END IF;
       END $$`,
      // Data migration — move existing video rows out of project_media.
      // caption → title, keep the existing file path and sort_order.
      `INSERT INTO project_videos (project_id, kind, file_path, title, sort_order, created_at)
       SELECT project_id, 'file', file_path, caption, sort_order, created_at
         FROM project_media
        WHERE media_type = 'video'`,
      `DELETE FROM project_media WHERE media_type = 'video'`,
    ],
  },
  {
    // Media attachments for news articles (images, video files, YouTube embeds).
    name: '016_news_media',
    statements: [
      `CREATE TABLE IF NOT EXISTS news_media (
        id          SERIAL      PRIMARY KEY,
        article_id  INTEGER     NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
        kind        TEXT        NOT NULL DEFAULT 'image',
        file_path   TEXT,
        youtube_id  TEXT,
        caption     TEXT,
        sort_order  INTEGER     NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT news_media_kind_check CHECK (kind IN ('image', 'video_file', 'youtube')),
        CONSTRAINT news_media_payload CHECK (
          (kind = 'image'      AND file_path IS NOT NULL AND youtube_id IS NULL) OR
          (kind = 'video_file' AND file_path IS NOT NULL AND youtube_id IS NULL) OR
          (kind = 'youtube'    AND youtube_id IS NOT NULL AND file_path IS NULL)
        )
      )`,
      `CREATE INDEX IF NOT EXISTS idx_news_media_article ON news_media (article_id)`,
    ],
  },
  {
    name: '017_home_stats_content',
    statements: [
      `INSERT INTO site_content (key, value) VALUES (
        'home_stats',
        '[{"num":"22+","label":"Years Carpentry Experience"},{"num":"15+","label":"Years Coding Experience"},{"num":"6+","label":"Years Tech Management"},{"num":"40","label":"Years of creating all kinds of trouble"}]'::jsonb
      ) ON CONFLICT (key) DO NOTHING`,
    ],
  },
  {
    name: '018_rsvp_custom_fields',
    statements: [
      `ALTER TABLE party_rsvps ADD COLUMN IF NOT EXISTS food_choices JSONB`,
      `ALTER TABLE party_rsvps ADD COLUMN IF NOT EXISTS custom_answers JSONB`,
    ],
  },
];

module.exports = { migrations };
