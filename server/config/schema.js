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
  {
    name: '019_rsvp_form_builder',
    statements: [
      // RSVP answers now live in a single JSONB column keyed by the admin-designed
      // field ids. `rsvp_form` itself is stored as site_content.party_rsvp_form.
      `ALTER TABLE party_rsvps ADD COLUMN IF NOT EXISTS answers JSONB`,
      // Wipe existing RSVPs — form structure changed, previous answers no longer meaningful
      `DELETE FROM party_rsvps`,
    ],
  },
  {
    name: '020_oauth_google',
    statements: [
      // Stable Google subject (`sub` claim) — preferred over email as the OAuth key.
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE`,
      // Forward-looking column so GitHub/Apple can be added later without another migration.
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider TEXT
         CHECK (oauth_provider IS NULL OR oauth_provider IN ('google'))`,
      // OAuth-only users have no password — relax NOT NULL on password_hash.
      `ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_users_google_id ON users (google_id)`,
    ],
  },
  {
    name: '021_oauth_facebook',
    statements: [
      // Stable Facebook user id (`id` from Graph API /me).
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_id TEXT UNIQUE`,
      // Widen the CHECK constraint from migration 020 to allow 'facebook'.
      // Postgres auto-names inline column constraints as <table>_<column>_check.
      `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_oauth_provider_check`,
      `ALTER TABLE users ADD CONSTRAINT users_oauth_provider_check
         CHECK (oauth_provider IS NULL OR oauth_provider IN ('google', 'facebook'))`,
      `CREATE INDEX IF NOT EXISTS idx_users_facebook_id ON users (facebook_id)`,
    ],
  },
  {
    // eCommerce (Shop) MVP — products, orders, order_items, product_images,
    // plus a processed_webhook_events table for Stripe idempotency.
    // Money stored in smallest currency unit integers: ISK has no subunit
    // (1 ISK = 1 unit), EUR stored in cents. Prices are VAT-inclusive.
    name: '022_ecommerce',
    statements: [
      `CREATE TABLE IF NOT EXISTS products (
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
      )`,
      `CREATE INDEX IF NOT EXISTS idx_products_slug   ON products (slug)`,
      `CREATE INDEX IF NOT EXISTS idx_products_active ON products (active) WHERE active = TRUE`,
      `DROP TRIGGER IF EXISTS trg_products_updated_at ON products`,
      `CREATE TRIGGER trg_products_updated_at
         BEFORE UPDATE ON products
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,

      `CREATE TABLE IF NOT EXISTS product_images (
        id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        product_id  TEXT        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        url         TEXT        NOT NULL,
        position    INTEGER     NOT NULL DEFAULT 0,
        alt_text    TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images (product_id)`,

      `CREATE TABLE IF NOT EXISTS orders (
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
      )`,
      `CREATE INDEX IF NOT EXISTS idx_orders_user_id          ON orders (user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_stripe_session_id ON orders (stripe_session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_status           ON orders (status)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_created_at_desc  ON orders (created_at DESC)`,
      `DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders`,
      `CREATE TRIGGER trg_orders_updated_at
         BEFORE UPDATE ON orders
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,

      `CREATE TABLE IF NOT EXISTS order_items (
        id                      TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        order_id                TEXT        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id              TEXT        NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        product_name_snapshot   TEXT        NOT NULL,
        product_price_snapshot  INTEGER     NOT NULL CHECK (product_price_snapshot >= 0),
        quantity                INTEGER     NOT NULL CHECK (quantity > 0),
        currency                TEXT        NOT NULL CHECK (currency IN ('ISK', 'EUR')),
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id)`,

      `CREATE TABLE IF NOT EXISTS processed_webhook_events (
        id          TEXT        PRIMARY KEY,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    ],
  },
  {
    // Shop product taxonomy — shape (aero/tall/classic/etc.) and capacity_litres
    // feed the shop filter UI. Both nullable: existing products pre-seed
    // without values will just not match shape/capacity filter chips.
    name: '023_product_taxonomy',
    statements: [
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS shape TEXT`,
      `DO $$ BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint WHERE conname = 'products_shape_check'
         ) THEN
           ALTER TABLE products ADD CONSTRAINT products_shape_check
             CHECK (shape IS NULL OR shape IN ('aero','tall','long','low','cube','classic'));
         END IF;
       END $$`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS capacity_litres INTEGER
         CHECK (capacity_litres IS NULL OR capacity_litres > 0)`,
      `CREATE INDEX IF NOT EXISTS idx_products_shape    ON products (shape)`,
      `CREATE INDEX IF NOT EXISTS idx_products_capacity ON products (capacity_litres)`,
    ],
  },
  {
    // Product variants — generic size/colour/etc. axes so the shop can sell
    // apparel (t-shirt × size × colour), accessories (cap × colour), or
    // future single-SKU items (gift card) with the same code path.
    //
    // products.category          — taxonomy: 'apparel', 'accessories', 'roof_box', …
    // products.variant_axes      — JSONB array, e.g. ["size","color"] or []
    // product_variants           — per-SKU stock + optional price override
    // order_items.product_variant_id  — which exact SKU was purchased (snapshot)
    // order_items.variant_attributes  — JSONB snapshot of the variant at order time
    name: '024_product_variants',
    statements: [
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_axes JSONB NOT NULL DEFAULT '[]'::jsonb`,
      `CREATE INDEX IF NOT EXISTS idx_products_category ON products (category)`,

      `CREATE TABLE IF NOT EXISTS product_variants (
        id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        product_id   TEXT        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        sku          TEXT        NOT NULL UNIQUE,
        attributes   JSONB       NOT NULL,
        price_isk    INTEGER     CHECK (price_isk IS NULL OR price_isk > 0),
        price_eur    INTEGER     CHECK (price_eur IS NULL OR price_eur > 0),
        stock        INTEGER     NOT NULL DEFAULT 0 CHECK (stock >= 0),
        active       BOOLEAN     NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants (product_id)`,
      `CREATE INDEX IF NOT EXISTS idx_product_variants_active    ON product_variants (active) WHERE active = TRUE`,
      // Prevent two variants of the same product sharing the same attribute combination.
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_variants_attrs
         ON product_variants (product_id, attributes)`,
      `DROP TRIGGER IF EXISTS trg_product_variants_updated_at ON product_variants`,
      `CREATE TRIGGER trg_product_variants_updated_at
         BEFORE UPDATE ON product_variants
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,

      // Link order items to a specific variant (nullable for legacy orders).
      // RESTRICT so we can't accidentally remove a variant that has history.
      `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_variant_id TEXT
         REFERENCES product_variants(id) ON DELETE RESTRICT`,
      `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_attributes JSONB`,
      `CREATE INDEX IF NOT EXISTS idx_order_items_variant_id ON order_items (product_variant_id)`,
    ],
  },
  {
    // Editable shop copy — hero block on /#/shop and shared chrome labels
    // across all product detail pages. Follows the existing site_content
    // pattern (see migrations 005, 011 for more examples).
    //
    // shop_hero           — eyebrow/title/subtitle/empty_state on /#/shop
    // shop_product_chrome — labels that appear on every product page
    //                       (back link, VAT note, qty label, button text,
    //                       stock copy templates). Edits affect ALL products.
    //
    // Templates use {n} / {qty} / {name} placeholders replaced client-side.
    name: '025_shop_content',
    statements: [
      `INSERT INTO site_content (key, value) VALUES (
         'shop_hero',
         '{"eyebrow":"From the workshop","title":"Shop","subtitle":"Smiley apparel and goods \u2014 prices include 24% VAT.","empty_state":"No products match your filters."}'::jsonb
       ) ON CONFLICT (key) DO NOTHING`,
      `INSERT INTO site_content (key, value) VALUES (
         'shop_product_chrome',
         '{"back_label":"\u2190 Back to shop","vat_note":"Price includes 24% VAT","qty_label":"Quantity","add_to_cart_label":"Add to cart","out_of_stock_label":"Out of stock","low_stock_template":"Only {n} left \u2014 ships within 24 h","in_stock_template":"{n} in stock","select_options_hint":"Select options to see availability"}'::jsonb
       ) ON CONFLICT (key) DO NOTHING`,
    ],
  },
  {
    // Shared invite code that unlocks the party RSVP + Activities sections.
    // Admins share it out-of-band (Facebook group, DM, etc); guests redeem it
    // on /#/party which flips users.party_access. Stored in site_content so
    // admins can rotate it in-place; never returned from the public GET
    // /api/v1/party/info endpoint.
    name: '026_party_invite_code',
    statements: [
      `INSERT INTO site_content (key, value) VALUES (
         'party_invite_code',
         '"HALLI40"'::jsonb
       ) ON CONFLICT (key) DO NOTHING`,
    ],
  },
  {
    // One-shot patch for existing deployments whose stored party_rsvp_form
    // pre-dates the "expand RSVP form" change (commit 34c6247) — their form
    // only has attendance + message fields, missing the helper signup and
    // the plus-ones question. Idempotent: skipped if no form is stored, or
    // if the fields are already present. The message field is always moved
    // to the end so ordering stays sensible.
    name: '027_party_rsvp_form_patch_helper_fields',
    statements: [
      `DO $$
       DECLARE
         existing    JSONB;
         msg_element JSONB;
         new_fields  JSONB := '[]'::jsonb;
         rebuilt     JSONB;
       BEGIN
         SELECT value INTO existing FROM site_content WHERE key = 'party_rsvp_form';
         IF existing IS NULL OR jsonb_typeof(existing) <> 'array' THEN
           RETURN;
         END IF;

         IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(existing) e WHERE e->>'id' = 'bringing') THEN
           new_fields := new_fields || jsonb_build_object(
             'id',      'bringing',
             'type',    'checkbox-group',
             'label',   'Bringing anyone with you?',
             'options', jsonb_build_array('Spouse / partner', 'Kids')
           );
         END IF;

         IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(existing) e WHERE e->>'id' = 'helping') THEN
           new_fields := new_fields || jsonb_build_object(
             'id',      'helping',
             'type',    'checkbox-group',
             'label',   'Want to help out? (totally optional)',
             'options', jsonb_build_array('Help with planning', 'Host an activity', 'General help on the day')
           );
         END IF;

         IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(existing) e WHERE e->>'id' = 'activity_details') THEN
           new_fields := new_fields || jsonb_build_object(
             'id',          'activity_details',
             'type',        'textarea',
             'label',       'What activity would you host?',
             'placeholder', 'A short description — games, music, a talk, anything…',
             'showIf',      jsonb_build_object('fieldId', 'helping', 'value', 'Host an activity')
           );
         END IF;

         IF jsonb_array_length(new_fields) = 0 THEN
           RETURN;
         END IF;

         SELECT e.value INTO msg_element
         FROM jsonb_array_elements(existing) WITH ORDINALITY AS e(value, idx)
         WHERE e.value->>'id' = 'message'
         ORDER BY idx
         LIMIT 1;

         IF msg_element IS NULL THEN
           rebuilt := existing || new_fields;
         ELSE
           SELECT COALESCE(jsonb_agg(e.value ORDER BY e.idx), '[]'::jsonb)
             INTO rebuilt
             FROM jsonb_array_elements(existing) WITH ORDINALITY AS e(value, idx)
             WHERE e.value->>'id' <> 'message';
           rebuilt := rebuilt || new_fields || jsonb_build_array(msg_element);
         END IF;

         UPDATE site_content
            SET value = rebuilt, updated_at = NOW()
          WHERE key = 'party_rsvp_form';
       END $$`,
    ],
  },
  {
    // Internationalisation (i18n) — Phase 1.
    // Adds preferred_locale to users so emails and API responses are
    // served in the user's language. Constraint allows exactly the two
    // locales we ship; adding a third language requires a new migration.
    name: '028_i18n_user_locale',
    statements: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_locale TEXT NOT NULL DEFAULT 'en'`,
      `DO $$ BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint WHERE conname = 'users_preferred_locale_check'
         ) THEN
           ALTER TABLE users ADD CONSTRAINT users_preferred_locale_check
             CHECK (preferred_locale IN ('en', 'is'));
         END IF;
       END $$`,
    ],
  },
  {
    // Internationalisation (i18n) — Phase 1 continued.
    // Adds a locale column to site_content and promotes the primary key
    // from (key) to (key, locale) so each editable content block can exist
    // in multiple languages. Existing rows are backfilled with locale='en'
    // and duplicated for locale='is' so both languages have content from day one.
    name: '029_i18n_site_content_locale',
    statements: [
      // Add locale column; existing rows default to 'en'.
      `ALTER TABLE site_content ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en'`,
      // Drop the old single-column PK.
      `ALTER TABLE site_content DROP CONSTRAINT IF EXISTS site_content_pkey`,
      // New composite PK covering both key + locale.
      `ALTER TABLE site_content ADD PRIMARY KEY (key, locale)`,
      // Seed Icelandic copies of every English row (same value initially;
      // admins translate via the CMS editor).
      `INSERT INTO site_content (key, locale, value, updated_by, updated_at)
       SELECT key, 'is', value, updated_by, updated_at
         FROM site_content
        WHERE locale = 'en'
       ON CONFLICT (key, locale) DO NOTHING`,
    ],
  },
  {
    // i18n — real Icelandic content for every site_content row seeded in
    // English by earlier migrations. Migration 029 copied English verbatim
    // into the locale='is' rows so the locale switcher worked on day one;
    // this migration replaces those placeholders with fluent Icelandic copy
    // written by a native speaker. Admins can re-edit either locale via the
    // CMS afterwards.
    name: '030_i18n_site_content_icelandic',
    statements: [
      // home_skills — hero/skills block on the landing page.
      `UPDATE site_content SET value = '{"eyebrow":"Í tvo áratugi","title":"Smíði\\n& Kóði","description":"Tuttugu ára nákvæmni í trésmíði — að lesa æðar viðarins, saga eftir línunni, fella saman án glufa — yfirfærð á hverja einustu línu af kóða. Sömu reglur og gera sinklag-fellingu endingargóða í heila öld gera hugbúnað auðveldan að viðhalda.","items":[{"label":"Forritunarmál","value":"JS · Python · SQL"},{"label":"Bakendi","value":"Node · Express · REST"},{"label":"Gagnagrunnur","value":"PostgreSQL · Redis"},{"label":"Smíði","value":"20+ ár með hand- og rafmagnsverkfæri"},{"label":"Ský","value":"Azure · Railway"},{"label":"Öryggi","value":"OWASP · OAuth 2.0 · RS256"}],"image_url":"https://images.unsplash.com/photo-1564603527476-8837eac5a22f?w=700&h=900&fit=crop&q=80&auto=format"}'::jsonb,
           updated_at = NOW()
        WHERE key = 'home_skills' AND locale = 'is'`,

      // home_stats — the counter strip.
      `UPDATE site_content SET value = '[{"num":"22+","label":"ára reynsla í smíði"},{"num":"15+","label":"ára reynsla í forritun"},{"num":"6+","label":"ára reynsla í tæknistjórnun"},{"num":"40","label":"ára af alls kyns uppátækjum"}]'::jsonb,
           updated_at = NOW()
        WHERE key = 'home_stats' AND locale = 'is'`,

      // halli_bio — the long-form biography page.
      `UPDATE site_content SET value = '{"hero_tagline":"Þar sem viður mætir kóða","beginning_eyebrow":"Fyrsti kafli","beginning_title":"Upphafið","beginning_text":"Fæddur og uppalinn á jaðri Norður-Atlantshafsins, ólst Halli upp á Íslandi — landi sem er mótað af eldi, ís og þrjóskri hugkvæmni fólks sem átti ekki annarra kosta völ en að búa hlutina til sjálft. Afi hans byggði sitt eigið hús með berum höndum. Faðir hans hélt þeirri hefð á lífi í bílskúrnum um helgar, staðnum sem lyktaði af furuspæni og hörfræolíu, þar sem hvert vandamál átti sér lausn ef maður var nógu þolinmóður til að finna hana.","beginning_text2":"Fjórtán ára gamall smíðaði hann sitt fyrsta húsgagn. Lítinn bókaskáp, grófan í samsetningum, stoltan í herberginu. Hann var aldrei alveg réttur í hornin. En hann stóð. Þessi ófullkomni skápur kenndi honum meira um auðmýkt, nákvæmni og þrautseigju en nokkur kennslustofa hefði nokkurn tímann getað.","craft_eyebrow":"Annar kafli","craft_title":"Handverkið","craft_text":"Smíðin valdi Halla jafn mikið og hann valdi hana. Það býr í því heimspeki að vinna með við sem ekkert annað efni jafnast á við. Viðurinn hefur æðar, sögu og persónuleika. Hver planki ber minningu um tréið sem hann kom úr: árin í þurrki og velgjöf, stefnu ríkjandi vinda. Að vinna með við er að vinna með einhverju sem er eldra en maður sjálfur.","craft_text2":"Í gegnum tvo áratugi hefur hann smíðað matarborð sem endast lengur en hann sjálfur, smíðað eldhús inn í gömul og hallandi hús og tengt saman timburgrindur fyrir byggingar sem eiga að standa í heila öld. Heimspeki hans hefur ekki breyst síðan þessar fyrstu, klaufalegu tilraunir: skildu efnið þitt, virtu verkfærin og mældu tvisvar.","craft_highlight1":"Húsgögn sem endast lengur en smiðurinn","craft_highlight2":"Fellingar skornar með höndunum, tengdar saman án fyllingar","craft_highlight3":"Hvert verk smíðað fyrir nákvæmlega sinn stað og tilgang","code_eyebrow":"Þriðji kafli","code_title":"Kóðinn","code_text":"Leiðin frá viði til hugbúnaðar var ekki bein. Seint á kvöldin í hálfkláruðum vinnuskúr byrjaði Halli að kenna sjálfum sér að forrita. Ekki vegna þess að hann vildi leggja smíðina á hilluna, heldur vegna þess að hann þurfti verkfæri sem voru ekki til. Birgðakerfi, verkefnaeftirlit, viðskiptavinagáttir. Ef hann gat smíðað skáp, gat hann smíðað vefforrit.","code_text2":"Það sem kom honum á óvart var hversu kunnuglegt þetta allt var. Sami agi sem heldur vinnubekk hreinum heldur kóðagrunni viðráðanlegum. Sama þolinmæðin sem gerir manni kleift að skera sinklag í höndunum gerir manni kleift að leita að göllum í flóknu kerfi. Orðabókin var önnur. Hugarfarið var eins.","blend_eyebrow":"Fjórði kafli","blend_title":"Samþættingin","blend_quote":"Handverksmaður velur ekki verkfæri sín af handahófi. Hann velur þau beittustu, þau heiðarlegustu — og lærir að nota þau þar til verkfærið verður framlenging af hugsun hans.","blend_text":"Hugsunarháttur handverksmannsins á sér nafn í hugbúnaði: verkfræði. Ekki nafnorðið, heldur sögnin — að stöðugt gera hluti nákvæmari, endingargóðari og heiðarlegri. Halli beitir sama auga við línu af kóða og við geirnagla: Er þetta rétt? Er þetta heiðarlegt? Mun þetta halda?","blend_text2":"Viðskiptavinir hans í báðum heimum hafa tekið eftir þessu. Það er kyrrð yfir verki sem er vel unnið, hvaða miðill sem er. Vel felld hurð lokast með mjúkum smelli. Vel hannað API gerir nákvæmlega það sem það segist gera, hvorki meira né minna.","life_eyebrow":"Fimmti kafli","life_title":"Lífið utan vinnu","life_text":"Á milli vinnuskúrsins og tölvunnar er Halli eiginmaður og faðir sem reynir að skilja bæði störfin eftir við dyrnar þegar kvöldið kallar. Hann gengur um hálendi Íslands — há- sléttur þar sem eina hljóðið er vindurinn og eigin andardráttur — og kemur heim með þeirri sérstöku tærleika sem aðeins fjarlægðin veitir.","life_text2":"Ísland er ekki bara heimili hans; það er efniviður hans. Langir eldfjallavetur, þögnin, undarleg birta sumarsins — allt þetta síast inn í vinnubrögð hans, það sem hann skapar og það sem hann metur.","life_tile1":"Ísland","life_tile2":"Göngur","life_tile3":"Matreiðsla","life_tile4":"Lestur","life_tile5":"Kaffi","future_eyebrow":"Sjötti kafli","future_title":"Hvað er næst","future_text":"Það eru fleiri borð sem bíða eftir að vera smíðuð. Fleiri kerfi sem bíða eftir hönnun. Fleiri vandamál sem sitja á mótum hins áþreifanlega og stafræna og bíða eftir einhverjum sem talar bæði tungumálin. Vinnustofan er að taka á sig mynd — hálft vinnuskúr, hálf skrifstofa — þar sem greinarnar tvær deila veggjum, verkfærum og hugmyndum.","future_text2":"Ef þú ert að vinna að einhverju áhugaverðu — vöru, byggingu eða verkfæri sem er ekki til — þá skaltu hafa samband. Besta verkið byrjar alltaf á samtali.","counter1_num":"20+","counter1_label":"ár í viðarsmíði","counter2_num":"10K+","counter2_label":"línur af kóða skrifaðar","counter3_num":"80+","counter3_label":"verkefni kláruð","counter4_num":"1","counter4_label":"eyþjóð sem er heimili"}'::jsonb,
           updated_at = NOW()
        WHERE key = 'halli_bio' AND locale = 'is'`,

      // shop_hero — /shop hero.
      `UPDATE site_content SET value = '{"eyebrow":"Úr verkstæðinu","title":"Verslun","subtitle":"Smiley-fatnaður og varningur — verð með 24% VSK.","empty_state":"Engar vörur passa við síurnar þínar."}'::jsonb,
           updated_at = NOW()
        WHERE key = 'shop_hero' AND locale = 'is'`,

      // shop_product_chrome — labels shared by every product page.
      `UPDATE site_content SET value = '{"back_label":"\\u2190 Til baka í verslun","vat_note":"Verð er með 24% VSK","qty_label":"Fjöldi","add_to_cart_label":"Setja í körfu","out_of_stock_label":"Uppselt","low_stock_template":"Aðeins {n} eftir — sent innan 24 klst.","in_stock_template":"{n} til á lager","select_options_hint":"Veldu valkosti til að sjá framboð"}'::jsonb,
           updated_at = NOW()
        WHERE key = 'shop_product_chrome' AND locale = 'is'`,
    ],
  },
  {
    // i18n — per-locale content on news_articles and products.
    //
    // Approach: nullable "_is" sibling columns rather than a composite
    // (id, locale) primary key. This keeps existing foreign keys in
    // news_media.article_id, order_items.product_id, etc. intact.
    //
    // Controllers read the locale-matched column when req.locale === 'is'
    // AND the _is column is non-null, otherwise they fall back to the
    // primary (English) column. Admins editing an article/product edit
    // the primary row + both locales' text fields at once.
    name: '031_i18n_news_products_locale',
    statements: [
      // News articles — four user-visible text fields gain an IS sibling.
      // cover_image_is is optional because most images are language-neutral.
      `ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS title_is       TEXT`,
      `ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS summary_is     TEXT`,
      `ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS body_is        TEXT`,
      `ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS cover_image_is TEXT`,
      // Length constraint matching the summary check on the primary column.
      `DO $$ BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint WHERE conname = 'news_articles_summary_is_length'
         ) THEN
           ALTER TABLE news_articles ADD CONSTRAINT news_articles_summary_is_length
             CHECK (summary_is IS NULL OR LENGTH(summary_is) <= 300);
         END IF;
       END $$`,

      // Products — name + description gain IS siblings.
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS name_is        TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS description_is TEXT`,
    ],
  },
  {
    // i18n — backfill Icelandic translations for existing news articles
    // that were seeded pre-migration-031 (prod DB already has the launch
    // article without title_is / summary_is / body_is populated).
    //
    // Only writes when the _is column is NULL so we never overwrite a
    // later admin edit. Idempotent on re-run.
    name: '032_i18n_news_icelandic_backfill',
    statements: [
      `UPDATE news_articles
          SET title_is   = COALESCE(title_is,   'Við erum í loftinu! Velkomin á Halli Smiley'),
              summary_is = COALESCE(summary_is, 'Eftir margra mánaða vinnu er síðan loks í loftinu. Hér er sagan á bak við hana — hvað þetta er, hvernig hún er byggð og hvað kemur næst.'),
              body_is    = COALESCE(body_is, '<p>Jæja. Þetta er sem sagt komið í loftið. Ég held áfram að ýta á refresh í þeirri von að sjá hana springa, en einhvern veginn... virkar þetta bara. Velkomin á <strong>Halli Smiley</strong> — minn litla kima á netinu þar sem smíði mætir kóða og hvort tveggja er tekið jafn alvarlega.</p>

<h2>Af hverju vefsíða með verkefnasafni?</h2>

<p>Í hreinskilni sagt? Ég var orðinn þreyttur á því að útskýra hvað ég geri í matarboðum. „Þú ert sem sagt smiður?" Já. „En þú skrifar líka hugbúnað?" Já líka. „Samtímis?" Svona hálfpartinn. Ruglingurinn var raunverulegur. Svo ég bjó til þetta apparat bæði til að sýna vinnuna og til að geta rétt fólki slóð og labbað í burtu.</p>

<p>Ég hef verið í smíðum í yfir tuttugu ár — handverkfæri, rafmagnsverkfæri, fellingar, grindarsmíði, allt það. Og einhvern tímann á leiðinni datt ég af alvöru í forritun. Ekki af því að ég þyrfti þess, heldur af því að kitlið við að leysa vandamál er það sama. Að fella sinklagið svo skápurinn lokist án átaks, eða að finna villu í setustjórnun sem kemur aðeins fram undir tilteknum keppnisskilyrðum — sami heilinn, önnur efni.</p>

<h2>Hvernig hún er byggð</h2>

<p>Þessi síða er <strong>Node.js á bakendanum og hrein JavaScript á framendanum</strong>. Enginn React. Ekkert Next.js. Enginn rammi að taka ákvarðanir fyrir mig. Bara leiðarvísir sem ég skrifaði sjálfur, viðmót sem teiknar sig upp á gamla mátann, og PostgreSQL-gagnagrunnur sem gerir nákvæmlega það sem gagnagrunnar eiga að gera.</p>

<p>Auðkenningin er Lucia v3 með setu-kökum — rétta leiðin með httpOnly, SameSite, allt það. Svo er full CSRF-vörn, hraðatakmörkun, hreinsun á innsendum gögnum, Prometheus-mælingar, formfastir loggar með Pino, og straumrof á gagnagrunnstengingunni. Ég viðurkenni að ég gæti hafa farið örlítið yfir strikið með vöktuninni á vefsíðu fyrir verkefnasafn. Ég sé ekkert eftir því.</p>

<p>Framendinn er eitt-síðu vefforrit með slóðasjá á viðskiptavinahlið. Hann hleðst hratt, virkar án JavaScript fyrir kyrrstæða hlutann, og CSS-ið er handskrifað með CSS-breytum fyrir hönnunarkerfi sem þvælist ekki fyrir mér. Dökka þemað er meðvituð ákvörðun — ég eyði flestum deginum annaðhvort í tréspæni eða skipanalínugluggum, og hvort tveggja kemur betur út í myrkri.</p>

<h2>Hvað er hér að finna</h2>

<p>Nokkrir punktar sem vert er að nefna:</p>

<ul>
  <li><strong>Verkefnasafn</strong> — Bæði smíða- og tækniverkefni á einum stað. Síað eftir grein. Hvert verkefni á sína eigin síðu með myndum, notuðum verkfærum og sögunni á bak við.</li>
  <li><strong>Notendaaðgangar</strong> — Þú getur búið til aðgang, valið mynd og vistað uppáhaldsverkefni. Aðgangarnir eru alvöru — netfangsstaðfesting, lykilorðsendurstilling, heili pakkinn.</li>
  <li><strong>Veislusíðan</strong> — Ég verð 40 ára í ár. Það verður afmælisveisla, og ég smíðaði heilt boðskorta- og skráningarkerfi fyrir hana. Auðvitað gerði ég það.</li>
  <li><strong>Þessi fréttaveita</strong> — Hér mun ég birta greinar um verkefni á meðan þau eru í vinnslu, skrif um tækni, og endrum og eins tuða yfir hreyfingum í viði eða sérkennum JavaScript.</li>
</ul>

<h2>Fyrsta alvöru verkefnið: Stofan Bakhús</h2>

<p>Fyrsta smíðaverkefnið á síðunni er <strong>Stofan Bakhús</strong> — umbreyting á útihúsi í stofu með útsýn í garðinn, sem ég vann fyrir nokkrum árum. Þetta er verkefnið sem ég er hvað stoltastur af frá þeim tíma: almennileg timburgrind, handsmíðaðar fellingar, byggt til að endast áratugum saman. Myndirnar skila þessu ekki nógu vel en þær eru það besta sem ég á.</p>

<p>Fleiri verkefni eru á leiðinni. Ég á nóg af verkum í bakka sem ég þarf að skjalfesta — bæði smíðaverkefni og hugbúnaðarverkefni — og ég bæti þeim við þegar ég finn tíma á milli raunverulegu vinnunnar.</p>

<h2>Hvað kemur næst</h2>

<p>Til skamms tíma: fleiri verkefni, fleiri skrif, almennileg Um mig-síða. Til miðlungs langs tíma: mig langar að bæta við athugasemdakerfi og kannski einhvers konar verkstæðisdagbók þar sem ég fylgist með virkum verkefnum í rauntíma. Til langs tíma: hver veit. Síðan er lifandi fyrirbæri og ég bý hana til eins og ég smíða húsgögn — einn hlut í einu, rétt felldan áður en haldið er áfram.</p>

<p>Ef þú komst alla leið hingað: takk fyrir lesturinn. Búðu þér til aðgang ef þú vilt fylgjast með, eða flettu bara í verkefnunum. Annaðhvort er, þá er ég glaður að þú sért hér.</p>

<p>— Halli</p>')
        WHERE slug = 'were-live-welcome'`,
    ],
  },
  {
    // i18n — per-locale text on projects, project_sections, project_media,
    // project_videos. Same Option B approach as migration 031 for news/
    // products: nullable "_is" sibling columns so existing foreign keys
    // (project_media.project_id, project_sections.project_id, etc.) stay
    // intact.
    //
    // Controllers surface the IS column via COALESCE when req.locale === 'is'
    // and the _is column is non-null; admin editors receive both raw fields
    // so the CMS can show EN + IS side-by-side.
    name: '033_i18n_projects_locale',
    statements: [
      // Projects — title + description each get an IS sibling.
      `ALTER TABLE projects           ADD COLUMN IF NOT EXISTS title_is       TEXT`,
      `ALTER TABLE projects           ADD COLUMN IF NOT EXISTS description_is TEXT`,

      // Project sections — name (section heading) + description (body under it).
      `ALTER TABLE project_sections   ADD COLUMN IF NOT EXISTS name_is        TEXT`,
      `ALTER TABLE project_sections   ADD COLUMN IF NOT EXISTS description_is TEXT`,

      // Project media — caption (appears under each image/video in the gallery).
      `ALTER TABLE project_media      ADD COLUMN IF NOT EXISTS caption_is     TEXT`,

      // Project videos — title (shown above the video embed).
      `ALTER TABLE project_videos     ADD COLUMN IF NOT EXISTS title_is       TEXT`,
    ],
  },
  {
    // i18n — backfill Icelandic translations for the 4 live projects. Only
    // writes when _is is NULL so later admin edits via the CMS are never
    // overwritten. Idempotent on re-run. Keyed by title (slug column
    // doesn't exist on projects); project IDs aren't stable across
    // environments.
    name: '034_i18n_projects_icelandic_backfill',
    statements: [
      // 1) Halli Smiley Portfolio Platform — match both em-dash and plain
      //    hyphen variants in case the admin title has drifted between
      //    environments or was edited after the screenshot was taken.
      `UPDATE projects
          SET title_is       = COALESCE(title_is,       'Halli Smiley — Verkefnavefur'),
              description_is = COALESCE(description_is,
                'Fullt vefforrit byggt frá grunni til að sýna smíðavinnu og hugbúnaðargerð. Með sérsmíðuðu CMS og innbyggðum stjórnborðs-ritli, margþrepa notendakerfi með setustýrðri auðkenningu, viðburðasíðu með rauntíma niðurtalningu fyrir boðsgesti og fullu myndasafni með lightbox. Hönnuð með áberandi dökku þema innblásnu af úrvalsviðmótum tölvuleikja, afhendir vettvangurinn óaðfinnanlega eitt-síðu upplifun án þess að reiða sig á nokkurn framenda-ramma.

Byggt fyrir framleiðslu frá fyrsta degi — kóðagrunnurinn inniheldur formfasta loggun með Pino, Prometheus-mælingar, straumrof, CI/CD með yfir 398 sjálfvirkum prófunum í eininga-, samþættingar- og enda-til-enda svítum, og yfirgripsmikinn vöktunarstafla. Hver einasti hluti, frá Lucia-keyrðu auðkenningarkerfi til stjórnenda-ritaðs vefefnis, var handsmíðaður til að sýna fullt vefþróunar-handverk á hverju lagi tæknistaflans.')
        WHERE title ILIKE 'Halli Smiley%Portfolio Platform'`,

      // 2) Arnarhraun Renovations
      `UPDATE projects
          SET title_is       = COALESCE(title_is,       'Endurnýjun á Arnarhrauni'),
              description_is = COALESCE(description_is, 'Nýtt eldhús, nýtt gólfefni, málning, veggir fjarlægðir.')
        WHERE title = 'Arnarhraun Renovations'`,

      // 3) Seljaland Kitchen
      `UPDATE projects
          SET title_is       = COALESCE(title_is,       'Seljaland eldhús'),
              description_is = COALESCE(description_is, 'Nýtt eldhús fyrir systur mína.')
        WHERE title = 'Seljaland Kitchen'`,

      // 4) Stofan Bakhús
      `UPDATE projects
          SET title_is       = COALESCE(title_is,       'Stofan Bakhús'),
              description_is = COALESCE(description_is,
                'Byggingarverkefni. Það sem gerði verkefnið sérstaklega áhugavert var að enginn annar verktaki kom að því og allar ákvarðanir um innanhússhönnun og framkvæmdir voru teknar af mér í samstarfi við eigendur. Ábyrgð fyrir innanhússhönnun, framkvæmdum, byggingarreglugerðarstöðlum þ.m.t. vikmörkum, heilbrigðis- og öryggiskröfum.')
        WHERE title = 'Stofan Bakhús'`,
    ],
  },
  {
    // i18n — backfill Icelandic for the second seeded news article
    // ('AI Generated videos', slug 'x-11'). Three short strings, same
    // COALESCE-guarded pattern as migration 032.
    name: '035_i18n_ai_news_icelandic_backfill',
    statements: [
      `UPDATE news_articles
          SET title_is   = COALESCE(title_is,   'Myndbönd búin til með gervigreind'),
              summary_is = COALESCE(summary_is, 'Super Grok gervigreindar-myndgerð'),
              body_is    = COALESCE(body_is,    'Dágóð vitleysa')
        WHERE slug = 'x-11'`,
    ],
  },
  {
    // i18n — translate the six contact_* site_content IS rows in place.
    //
    // Background: migration 029 seeded IS rows by duplicating EN rows at the
    // time it ran. Halli has since customised the EN content via the CMS
    // (uppercase labels etc); every CMS save writes to the active locale
    // only, so the IS rows never diverged — they remain byte-for-byte EN
    // copies on production today. The JS DEFAULT_* IS fallbacks in
    // ContactView.js therefore never get a chance to render because the
    // DB fetch succeeds with EN content and merges OVER the defaults.
    //
    // Fix: replace the IS value with real Icelandic copy, guarded by
    // "only when IS is still identical to EN" so:
    //   - Idempotent on re-run (after we translate, the guard fails and
    //     the UPDATE is a no-op)
    //   - Safe against any future genuine IS edits by admin (if Halli
    //     later saves real IS content that differs from EN, this never
    //     overwrites it)
    //
    // Matches Halli's current all-caps header style so the IS page has
    // the same visual rhythm as the EN one. Leaves URLs and proper nouns
    // (HALLI SMILEY brand, product-name pills, GitHub/LinkedIn handles,
    // href values) unchanged.
    name: '036_i18n_contact_icelandic_backfill',
    statements: [
      // contact_hero — landing eyebrow + title + subtitle
      `UPDATE site_content AS is_row
          SET value      = '{"eyebrow":"HAFA SAMBAND","subtitle":"Verkefni, samstarf, ráðgjöf eða bara til að heilsa","title_line1":"SMÍÐUM EITTHVAÐ","title_accent":"Í VIÐI EÐA Í KÓÐA."}'::jsonb,
              updated_at = NOW()
         FROM site_content AS en_row
        WHERE is_row.key = 'contact_hero' AND is_row.locale = 'is'
          AND en_row.key = 'contact_hero' AND en_row.locale = 'en'
          AND is_row.value::text = en_row.value::text`,

      // contact_card — 4-item contact links row. Values (emails, handles,
      // address) are language-neutral; only labels + the "typical reply"
      // meta line get localised.
      `UPDATE site_content AS is_row
          SET value      = '{"items":[{"href":"halli@hallismiley.is","type":"email","label":"NETFANG","value":"halli [at] hallismiley [dot] is"},{"href":"https://github.com/pepti/hallismiley","type":"github","label":"GITHUB","value":"pepti/hallismiley"},{"href":"https://www.linkedin.com/in/halliv/","type":"linkedin","label":"LINKEDIN","value":"halliv"},{"meta":"Yfirleitt svar innan 2–3 daga","type":"location","label":"STAÐSETNING","value":"Hafnarfjörður · GMT"}]}'::jsonb,
              updated_at = NOW()
         FROM site_content AS en_row
        WHERE is_row.key = 'contact_card' AND is_row.locale = 'is'
          AND en_row.key = 'contact_card' AND en_row.locale = 'en'
          AND is_row.value::text = en_row.value::text`,

      // contact_form — section headers + submit button + fallback prompts.
      `UPDATE site_content AS is_row
          SET value      = '{"title":"SEGÐU MÉR HVAÐ ÞÚ ERT AÐ HUGSA UM","eyebrow":"SENDU SKILABOÐ","submit_label":"SENDA SKILABOÐ","fallback_link":"Sendu mér tölvupóst beint.","fallback_prefix":"Frekar netfang?"}'::jsonb,
              updated_at = NOW()
         FROM site_content AS en_row
        WHERE is_row.key = 'contact_form' AND is_row.locale = 'is'
          AND en_row.key = 'contact_form' AND en_row.locale = 'en'
          AND is_row.value::text = en_row.value::text`,

      // contact_availability — "Right now / What I'm open to" + 3 cards.
      // status values ('open', 'limited') are enum-style and stay untranslated.
      `UPDATE site_content AS is_row
          SET value      = '{"cards":[{"body":"Tek að mér verkefni sem stangast ekki á við starf mitt hjá NetApp.","label":"HUGBÚNAÐUR Í LAUSAVINNU","status":"open"},{"body":"Get veitt ráðgjöf um hvers kyns smíðaverkefni á Íslandi — fellingar, húsgögn, innanhússfrágang, húsasmíði og fleira.","label":"SMÍÐARÁÐGJÖF","status":"open"},{"body":"Til í að halda erindi um hvað sem er.","label":"SAMSTARF & ERINDI","status":"limited"}],"title":"HVAÐ ÉG ER TILBÚINN Í","eyebrow":"NÚNA"}'::jsonb,
              updated_at = NOW()
         FROM site_content AS en_row
        WHERE is_row.key = 'contact_availability' AND is_row.locale = 'is'
          AND en_row.key = 'contact_availability' AND en_row.locale = 'en'
          AND is_row.value::text = en_row.value::text`,

      // contact_built_with — "Under the hood / Built with" + two body
      // paragraphs + CTA buttons. Tech-stack pill names and github_url
      // are product identifiers and stay unchanged.
      `UPDATE site_content AS is_row
          SET value      = '{"body1":"Þessi síða er handsmíðað verkefnasafn sem keyrir á Node.js og Express með PostgreSQL gagnagrunni og hreinum JavaScript framenda sem eitt-síðu vefforrit — enginn rammi, ekkert byggingarskref. Auðkenning notar Lucia með CSRF og Helmet hertingu, tölvupóstur fer í gegnum Resend, skráarupphleðsla í gegnum Multer, vöktun gegnum Pino og Sentry, og allt saman er dreift á Azure eða Railway.","body2":"Öll frumskrár eru á GitHub — þér er velkomið að klóna eða fork-a. Ef þig vantar aðstoð við að koma þessu í loftið eða halda því við, hafðu samband og ég aðstoða með ánægju við uppsetningu, hýsingu eða áframhaldandi umsjón.","pills":["Node.js","Express","PostgreSQL","Lucia Auth","Helmet","CSRF","Resend","Multer","Pino","Sentry","Vanilla JS SPA","Azure","Railway"],"title":"BYGGT MEÐ — OG ÞITT AÐ AFRITA","eyebrow":"UNDIR HÚDDINU","github_url":"https://github.com/pepti/hallismiley","email_btn_label":"SENDU MÉR PÓST UM UPPSETNINGU","github_btn_label":"SKOÐA Á GITHUB"}'::jsonb,
              updated_at = NOW()
         FROM site_content AS en_row
        WHERE is_row.key = 'contact_built_with' AND is_row.locale = 'is'
          AND en_row.key = 'contact_built_with' AND en_row.locale = 'en'
          AND is_row.value::text = en_row.value::text`,

      // contact_footer — brand + tagline + nav/legal link labels.
      // hrefs are preserved verbatim (a separate pre-existing bug has them
      // uppercased in EN — intentionally not fixed in this i18n migration).
      `UPDATE site_content AS is_row
          SET value      = '{"nav_links":[{"href":"/HALLI","label":"HALLI"},{"href":"/PROJECTS","label":"VERKEFNI"},{"href":"HTTPS://GITHUB.COM/PEPTI/HALLISMILEY","label":"GITHUB"},{"href":"HTTPS://WWW.LINKEDIN.COM/IN/HALLIV/","label":"LINKEDIN"}],"brand_name":"HALLI SMILEY","copy_suffix":"Verkefnasafn um allt og ekkert.","legal_links":[{"href":"/PRIVACY","label":"PERSÓNUVERNDARSTEFNA"},{"href":"/TERMS","label":"NOTKUNARSKILMÁLAR"}]}'::jsonb,
              updated_at = NOW()
         FROM site_content AS en_row
        WHERE is_row.key = 'contact_footer' AND is_row.locale = 'is'
          AND en_row.key = 'contact_footer' AND en_row.locale = 'en'
          AND is_row.value::text = en_row.value::text`,
    ],
  },
  {
    // i18n — retry of migration 036 with a jsonb equality guard.
    //
    // Migration 036 used `is_row.value::text = en_row.value::text` as its
    // "only translate when IS still duplicates EN" guard. On production
    // that guard matched contact_availability but failed for the other
    // five contact_* rows, even though curl against both locales returned
    // byte-identical JSON. The divergence is at the jsonb::text layer:
    // rows written through different paths (migration 029 seed vs. CMS
    // re-save vs. admin edit round-trips) end up with internal jsonb
    // representations whose canonical text serialization differs by
    // whitespace / key ordering, despite being semantically equal.
    //
    // Fix: switch the guard to the jsonb `=` operator, which compares by
    // parsed value rather than text. This matches all five remaining
    // English-duplicate IS rows and no-ops on contact_availability (whose
    // IS value was already flipped to Icelandic by 036, so `=` is false).
    //
    // All six UPDATE bodies are byte-identical to 036 — only the guard
    // changes. Still idempotent (after this runs, IS differs from EN, so
    // the guard is false on re-run) and still safe against genuine future
    // IS admin edits.
    name: '037_i18n_contact_icelandic_backfill_retry',
    statements: [
      // contact_hero
      `UPDATE site_content AS is_row
          SET value      = '{"eyebrow":"HAFA SAMBAND","subtitle":"Verkefni, samstarf, ráðgjöf eða bara til að heilsa","title_line1":"SMÍÐUM EITTHVAÐ","title_accent":"Í VIÐI EÐA Í KÓÐA."}'::jsonb,
              updated_at = NOW()
         FROM site_content AS en_row
        WHERE is_row.key = 'contact_hero' AND is_row.locale = 'is'
          AND en_row.key = 'contact_hero' AND en_row.locale = 'en'
          AND is_row.value = en_row.value`,

      // contact_card
      `UPDATE site_content AS is_row
          SET value      = '{"items":[{"href":"halli@hallismiley.is","type":"email","label":"NETFANG","value":"halli [at] hallismiley [dot] is"},{"href":"https://github.com/pepti/hallismiley","type":"github","label":"GITHUB","value":"pepti/hallismiley"},{"href":"https://www.linkedin.com/in/halliv/","type":"linkedin","label":"LINKEDIN","value":"halliv"},{"meta":"Yfirleitt svar innan 2–3 daga","type":"location","label":"STAÐSETNING","value":"Hafnarfjörður · GMT"}]}'::jsonb,
              updated_at = NOW()
         FROM site_content AS en_row
        WHERE is_row.key = 'contact_card' AND is_row.locale = 'is'
          AND en_row.key = 'contact_card' AND en_row.locale = 'en'
          AND is_row.value = en_row.value`,

      // contact_form
      `UPDATE site_content AS is_row
          SET value      = '{"title":"SEGÐU MÉR HVAÐ ÞÚ ERT AÐ HUGSA UM","eyebrow":"SENDU SKILABOÐ","submit_label":"SENDA SKILABOÐ","fallback_link":"Sendu mér tölvupóst beint.","fallback_prefix":"Frekar netfang?"}'::jsonb,
              updated_at = NOW()
         FROM site_content AS en_row
        WHERE is_row.key = 'contact_form' AND is_row.locale = 'is'
          AND en_row.key = 'contact_form' AND en_row.locale = 'en'
          AND is_row.value = en_row.value`,

      // contact_availability — already flipped by 036; included for symmetry.
      // The `=` guard evaluates false (IS is Icelandic, EN is English) so
      // this is a guaranteed no-op.
      `UPDATE site_content AS is_row
          SET value      = '{"cards":[{"body":"Tek að mér verkefni sem stangast ekki á við starf mitt hjá NetApp.","label":"HUGBÚNAÐUR Í LAUSAVINNU","status":"open"},{"body":"Get veitt ráðgjöf um hvers kyns smíðaverkefni á Íslandi — fellingar, húsgögn, innanhússfrágang, húsasmíði og fleira.","label":"SMÍÐARÁÐGJÖF","status":"open"},{"body":"Til í að halda erindi um hvað sem er.","label":"SAMSTARF & ERINDI","status":"limited"}],"title":"HVAÐ ÉG ER TILBÚINN Í","eyebrow":"NÚNA"}'::jsonb,
              updated_at = NOW()
         FROM site_content AS en_row
        WHERE is_row.key = 'contact_availability' AND is_row.locale = 'is'
          AND en_row.key = 'contact_availability' AND en_row.locale = 'en'
          AND is_row.value = en_row.value`,

      // contact_built_with
      `UPDATE site_content AS is_row
          SET value      = '{"body1":"Þessi síða er handsmíðað verkefnasafn sem keyrir á Node.js og Express með PostgreSQL gagnagrunni og hreinum JavaScript framenda sem eitt-síðu vefforrit — enginn rammi, ekkert byggingarskref. Auðkenning notar Lucia með CSRF og Helmet hertingu, tölvupóstur fer í gegnum Resend, skráarupphleðsla í gegnum Multer, vöktun gegnum Pino og Sentry, og allt saman er dreift á Azure eða Railway.","body2":"Öll frumskrár eru á GitHub — þér er velkomið að klóna eða fork-a. Ef þig vantar aðstoð við að koma þessu í loftið eða halda því við, hafðu samband og ég aðstoða með ánægju við uppsetningu, hýsingu eða áframhaldandi umsjón.","pills":["Node.js","Express","PostgreSQL","Lucia Auth","Helmet","CSRF","Resend","Multer","Pino","Sentry","Vanilla JS SPA","Azure","Railway"],"title":"BYGGT MEÐ — OG ÞITT AÐ AFRITA","eyebrow":"UNDIR HÚDDINU","github_url":"https://github.com/pepti/hallismiley","email_btn_label":"SENDU MÉR PÓST UM UPPSETNINGU","github_btn_label":"SKOÐA Á GITHUB"}'::jsonb,
              updated_at = NOW()
         FROM site_content AS en_row
        WHERE is_row.key = 'contact_built_with' AND is_row.locale = 'is'
          AND en_row.key = 'contact_built_with' AND en_row.locale = 'en'
          AND is_row.value = en_row.value`,

      // contact_footer
      `UPDATE site_content AS is_row
          SET value      = '{"nav_links":[{"href":"/HALLI","label":"HALLI"},{"href":"/PROJECTS","label":"VERKEFNI"},{"href":"HTTPS://GITHUB.COM/PEPTI/HALLISMILEY","label":"GITHUB"},{"href":"HTTPS://WWW.LINKEDIN.COM/IN/HALLIV/","label":"LINKEDIN"}],"brand_name":"HALLI SMILEY","copy_suffix":"Verkefnasafn um allt og ekkert.","legal_links":[{"href":"/PRIVACY","label":"PERSÓNUVERNDARSTEFNA"},{"href":"/TERMS","label":"NOTKUNARSKILMÁLAR"}]}'::jsonb,
              updated_at = NOW()
         FROM site_content AS en_row
        WHERE is_row.key = 'contact_footer' AND is_row.locale = 'is'
          AND en_row.key = 'contact_footer' AND en_row.locale = 'en'
          AND is_row.value = en_row.value`,
    ],
  },
  {
    // i18n — insert the missing contact_* IS rows.
    //
    // Real root cause (finally diagnosed): on prod, 5 of the 6 contact_*
    // IS rows simply don't exist. The contentController's locale fallback
    // quietly returns the EN row when IS is missing, so curl against
    // ?locale=is looked identical to ?locale=en and we assumed the IS rows
    // existed but held duplicate EN content. They don't. Migrations 036
    // and 037 both no-op'd their UPDATE ... FROM ... WHERE joins because
    // there was no `is_row` to find.
    //
    // Only contact_availability has an IS row (seeded or edited through a
    // different path, now correctly Icelandic via 036).
    //
    // Fix: INSERT ... ON CONFLICT (key, locale) DO UPDATE WHERE ...
    //   - Missing row -> INSERT with Icelandic value
    //   - Existing row still equal to EN -> UPDATE to Icelandic
    //   - Existing row with genuine IS edits -> left untouched (the WHERE
    //     clause on DO UPDATE evaluates false)
    //
    // Idempotent: re-runs find the IS row already Icelandic, DO UPDATE
    // WHERE sees value != EN, and skips.
    name: '038_i18n_contact_icelandic_insert',
    statements: [
      // contact_hero
      `INSERT INTO site_content (key, locale, value)
       VALUES ('contact_hero', 'is', '{"eyebrow":"HAFA SAMBAND","subtitle":"Verkefni, samstarf, ráðgjöf eða bara til að heilsa","title_line1":"SMÍÐUM EITTHVAÐ","title_accent":"Í VIÐI EÐA Í KÓÐA."}'::jsonb)
       ON CONFLICT (key, locale) DO UPDATE
         SET value = EXCLUDED.value,
             updated_at = NOW()
         WHERE site_content.value = (SELECT value FROM site_content WHERE key = 'contact_hero' AND locale = 'en')`,

      // contact_card
      `INSERT INTO site_content (key, locale, value)
       VALUES ('contact_card', 'is', '{"items":[{"href":"halli@hallismiley.is","type":"email","label":"NETFANG","value":"halli [at] hallismiley [dot] is"},{"href":"https://github.com/pepti/hallismiley","type":"github","label":"GITHUB","value":"pepti/hallismiley"},{"href":"https://www.linkedin.com/in/halliv/","type":"linkedin","label":"LINKEDIN","value":"halliv"},{"meta":"Yfirleitt svar innan 2–3 daga","type":"location","label":"STAÐSETNING","value":"Hafnarfjörður · GMT"}]}'::jsonb)
       ON CONFLICT (key, locale) DO UPDATE
         SET value = EXCLUDED.value,
             updated_at = NOW()
         WHERE site_content.value = (SELECT value FROM site_content WHERE key = 'contact_card' AND locale = 'en')`,

      // contact_form
      `INSERT INTO site_content (key, locale, value)
       VALUES ('contact_form', 'is', '{"title":"SEGÐU MÉR HVAÐ ÞÚ ERT AÐ HUGSA UM","eyebrow":"SENDU SKILABOÐ","submit_label":"SENDA SKILABOÐ","fallback_link":"Sendu mér tölvupóst beint.","fallback_prefix":"Frekar netfang?"}'::jsonb)
       ON CONFLICT (key, locale) DO UPDATE
         SET value = EXCLUDED.value,
             updated_at = NOW()
         WHERE site_content.value = (SELECT value FROM site_content WHERE key = 'contact_form' AND locale = 'en')`,

      // contact_availability — already Icelandic on prod via 036; the
      // ON CONFLICT WHERE clause evaluates false and this is a no-op.
      // Included for completeness so a fresh DB gets all six.
      `INSERT INTO site_content (key, locale, value)
       VALUES ('contact_availability', 'is', '{"cards":[{"body":"Tek að mér verkefni sem stangast ekki á við starf mitt hjá NetApp.","label":"HUGBÚNAÐUR Í LAUSAVINNU","status":"open"},{"body":"Get veitt ráðgjöf um hvers kyns smíðaverkefni á Íslandi — fellingar, húsgögn, innanhússfrágang, húsasmíði og fleira.","label":"SMÍÐARÁÐGJÖF","status":"open"},{"body":"Til í að halda erindi um hvað sem er.","label":"SAMSTARF & ERINDI","status":"limited"}],"title":"HVAÐ ÉG ER TILBÚINN Í","eyebrow":"NÚNA"}'::jsonb)
       ON CONFLICT (key, locale) DO UPDATE
         SET value = EXCLUDED.value,
             updated_at = NOW()
         WHERE site_content.value = (SELECT value FROM site_content WHERE key = 'contact_availability' AND locale = 'en')`,

      // contact_built_with
      `INSERT INTO site_content (key, locale, value)
       VALUES ('contact_built_with', 'is', '{"body1":"Þessi síða er handsmíðað verkefnasafn sem keyrir á Node.js og Express með PostgreSQL gagnagrunni og hreinum JavaScript framenda sem eitt-síðu vefforrit — enginn rammi, ekkert byggingarskref. Auðkenning notar Lucia með CSRF og Helmet hertingu, tölvupóstur fer í gegnum Resend, skráarupphleðsla í gegnum Multer, vöktun gegnum Pino og Sentry, og allt saman er dreift á Azure eða Railway.","body2":"Öll frumskrár eru á GitHub — þér er velkomið að klóna eða fork-a. Ef þig vantar aðstoð við að koma þessu í loftið eða halda því við, hafðu samband og ég aðstoða með ánægju við uppsetningu, hýsingu eða áframhaldandi umsjón.","pills":["Node.js","Express","PostgreSQL","Lucia Auth","Helmet","CSRF","Resend","Multer","Pino","Sentry","Vanilla JS SPA","Azure","Railway"],"title":"BYGGT MEÐ — OG ÞITT AÐ AFRITA","eyebrow":"UNDIR HÚDDINU","github_url":"https://github.com/pepti/hallismiley","email_btn_label":"SENDU MÉR PÓST UM UPPSETNINGU","github_btn_label":"SKOÐA Á GITHUB"}'::jsonb)
       ON CONFLICT (key, locale) DO UPDATE
         SET value = EXCLUDED.value,
             updated_at = NOW()
         WHERE site_content.value = (SELECT value FROM site_content WHERE key = 'contact_built_with' AND locale = 'en')`,

      // contact_footer
      `INSERT INTO site_content (key, locale, value)
       VALUES ('contact_footer', 'is', '{"nav_links":[{"href":"/HALLI","label":"HALLI"},{"href":"/PROJECTS","label":"VERKEFNI"},{"href":"HTTPS://GITHUB.COM/PEPTI/HALLISMILEY","label":"GITHUB"},{"href":"HTTPS://WWW.LINKEDIN.COM/IN/HALLIV/","label":"LINKEDIN"}],"brand_name":"HALLI SMILEY","copy_suffix":"Verkefnasafn um allt og ekkert.","legal_links":[{"href":"/PRIVACY","label":"PERSÓNUVERNDARSTEFNA"},{"href":"/TERMS","label":"NOTKUNARSKILMÁLAR"}]}'::jsonb)
       ON CONFLICT (key, locale) DO UPDATE
         SET value = EXCLUDED.value,
             updated_at = NOW()
         WHERE site_content.value = (SELECT value FROM site_content WHERE key = 'contact_footer' AND locale = 'en')`,
    ],
  },
  {
    // CV refactor for the halli_bio page — adds six array keys
    // (skill_groups + experience, one pair per CV section: craft, code, blend).
    //
    // Merge strategy: `defaults || value` means existing keys in `value` win,
    // so admin edits to any other key are preserved. The WHERE guard makes the
    // migration idempotent — it runs once, then short-circuits on re-run.
    //
    // Dollar-quoted JSON literals ($j$...$j$) sidestep single-quote escaping
    // for apostrophes in the English copy (e.g. "customer's room").
    //
    // Legacy keys (craft_highlight1..3, beginning_text2, life_text2) are kept
    // in the row as dead-but-harmless fallback data — the view has a
    // synthesised fallback path that reads craft_highlight1..3 when the new
    // craft_skill_groups array is missing.
    name: '039_halli_bio_cv_arrays',
    statements: [
      // English
      `UPDATE site_content
          SET value = jsonb_build_object(
                'craft_skill_groups', $j$[{"id":"framing","title":"Framing & Structural","items":["Timber-frame construction and traditional joinery","Load-bearing layout, lintel and header sizing","Roof trusses, hip and valley cuts","Insulation, vapour barrier and air-sealing detailing","Retrofit work in heritage and out-of-square buildings"]},{"id":"finish","title":"Finish & Cabinetry","items":["Fitted kitchens and built-in storage","Hand-cut dovetail and mortise-and-tenon joinery","Solid-wood furniture design and fabrication","Hardwood flooring and stair construction","Natural oil and hard-wax finishes"]}]$j$::jsonb,
                'craft_experience',   $j$[{"id":"reykjavik-kitchen","title":"Heritage-home kitchen fit-out","meta":"Reykjavík · 2023 · 6 weeks","outcome":"Custom birch cabinetry fitted into a 1930s building with no square walls. Zero visible shims; every panel scribed on-site."},{"id":"summerhouse-frame","title":"Timber-frame summer house","meta":"South Iceland · 2022 · Lead carpenter","outcome":"Traditional post-and-beam frame, raised in four days with a three-person crew. Still standing square after three winters."},{"id":"walnut-table","title":"Commissioned walnut dining table","meta":"Private client · 2024","outcome":"2.8 m solid walnut slab, hand-planed and finished with hard-wax oil. Designed to outlast its owner."}]$j$::jsonb,
                'code_skill_groups',  $j$[{"id":"backend","title":"Backend & Data","items":["Node.js and Express API design","PostgreSQL schema modelling and migrations","Authentication, CSRF, and role-based access","Background jobs and queue design","Integration with third-party APIs"]},{"id":"frontend","title":"Frontend & UX","items":["Vanilla-JS SPAs without framework bloat","Accessible, keyboard-first UI","i18n and locale-aware content","Responsive layout without CSS frameworks","Performance: lazy loading, asset hygiene"]},{"id":"ops","title":"Ops & Delivery","items":["Linux servers, nginx, TLS, systemd","CI pipelines and deployment automation","Monitoring, logging, incident response","Database backup and restore strategy","Working with non-technical stakeholders"]}]$j$::jsonb,
                'code_experience',    $j$[{"id":"workshop-inventory","title":"Workshop inventory & job-tracking system","meta":"Self-built · production since 2022","outcome":"Internal tool that tracks 400+ materials, open jobs, and client quotes. Replaced three spreadsheets and a whiteboard."},{"id":"client-portal","title":"Contractor client portal","meta":"Freelance · 2024","outcome":"Quote → contract → progress photos in one URL. Cut invoicing friction for a small construction firm."},{"id":"site-rebuild","title":"This website","meta":"Greenfield · Node + Postgres + vanilla JS","outcome":"Full-stack, bilingual, CMS-driven. Every line written, reviewed, and deployed by one person."}]$j$::jsonb,
                'blend_skill_groups', $j$[{"id":"diagnosis","title":"Diagnosis","items":["Seeing the problem behind the stated problem","Reading what a system tells you about itself","Separating symptom from cause under time pressure"]},{"id":"precision","title":"Precision & Measurement","items":["Committing in millimetres or milliseconds","Tolerance-driven thinking","Planning cuts you cannot take back"]},{"id":"horizon","title":"Long-Horizon Thinking","items":["Building for the next twenty years, not the next sprint","Choosing materials and dependencies that age well","Documentation as a gift to future maintainers"]},{"id":"communication","title":"Client Communication","items":["Translating craft vocabulary into business terms","Quoting honestly, including the inconvenient","Saying no to the wrong scope"]}]$j$::jsonb,
                'blend_experience',   $j$[{"id":"cabinet-config","title":"Parametric cabinet configurator","meta":"Hybrid project · 2023","outcome":"Web tool that turns a customer's room dimensions into a cut list and a price. The shop floor reads what the browser sent."},{"id":"job-tracker","title":"Job-site progress app","meta":"Field-tested on three builds","outcome":"Mobile-friendly snapshot of a build's state — what is framed, what is wired, what is blocked. Written by someone who has been on both sides of the paper trail."},{"id":"design-review","title":"Technical design review for a small studio","meta":"Advisory · 2024","outcome":"Two days on-site, a written report, a follow-up call. The same eye that spots a warped joist spots a fragile API contract."}]$j$::jsonb
              ) || value,
              updated_at = NOW()
        WHERE key = 'halli_bio' AND locale = 'en'
          AND (NOT value ? 'craft_skill_groups'
            OR NOT value ? 'craft_experience'
            OR NOT value ? 'code_skill_groups'
            OR NOT value ? 'code_experience'
            OR NOT value ? 'blend_skill_groups'
            OR NOT value ? 'blend_experience')`,

      // Icelandic
      `UPDATE site_content
          SET value = jsonb_build_object(
                'craft_skill_groups', $j$[{"id":"framing","title":"Burðarvirki & uppistöður","items":["Timburrammabygging og hefðbundin samskeyti","Burðarvirkjauppsetning og stærðir bita og þverslár","Þaksperrur og nákvæmar skurðir á hornum","Einangrun, rakavörn og loftþétting","Endurbætur í eldri byggingum og skökkum húsum"]},{"id":"finish","title":"Innréttingar & húsgögn","items":["Sérsmíðuð eldhús og innbyggðar geymslulausnir","Handskornar sinkur og tappa-samskeyti","Hönnun og smíði húsgagna úr harðviði","Harðviðargólf og trappsmíði","Náttúruolíu- og vaxfrágangur"]}]$j$::jsonb,
                'craft_experience',   $j$[{"id":"reykjavik-kitchen","title":"Innrétting eldhúss í gömlu húsi","meta":"Reykjavík · 2023 · 6 vikur","outcome":"Sérsmíðaðar birkiinnréttingar í byggingu frá 1930 þar sem engir veggir eru réttir. Engir sýnilegir fyllingar; hver plata mótuð á staðnum."},{"id":"summerhouse-frame","title":"Timburrammabyggt sumarhús","meta":"Suðurland · 2022 · Aðalsmiður","outcome":"Hefðbundinn stauarammi reistur á fjórum dögum með þriggja manna hópi. Stendur enn rétt eftir þrjá vetur."},{"id":"walnut-table","title":"Borðstofuborð úr valhnetu","meta":"Einkaviðskipti · 2024","outcome":"2,8 m gegnheil valhneta, handsöguð og frágengin með vaxolíu. Hönnuð til að endast lengur en eigandinn."}]$j$::jsonb,
                'code_skill_groups',  $j$[{"id":"backend","title":"Bakendi & gögn","items":["Hönnun API með Node.js og Express","PostgreSQL skema og gagnaflutningur","Auðkenning, CSRF og hlutverkabundið aðgengi","Bakgrunnsverk og biðraðahönnun","Samþætting við þriðja aðila API"]},{"id":"frontend","title":"Viðmót & notendaupplifun","items":["Hreint JavaScript vefforrit án ramma","Aðgengileg viðmót með áherslu á lyklaborð","Fjöltungu- og staðfæringarstuðningur","Svörandi útlit án CSS-ramma","Afköst: lata hleðslu og efnisstjórnun"]},{"id":"ops","title":"Rekstur & afhending","items":["Linux-þjónar, nginx, TLS, systemd","CI-leiðslur og sjálfvirkar uppsetningar","Vöktun, loggun og viðbrögð við atvikum","Öryggisafritun og endurheimt gagnagrunna","Samvinna við ótæknilega hagsmunaaðila"]}]$j$::jsonb,
                'code_experience',    $j$[{"id":"workshop-inventory","title":"Birgða- og verkbókunarkerfi fyrir smíðaverkstæði","meta":"Sjálfsmíðað · í rekstri síðan 2022","outcome":"Innra kerfi sem fylgist með 400+ efnum, opnum verkum og tilboðum. Leysti af þrjú töflureiknirit og eina töflu."},{"id":"client-portal","title":"Viðskiptavinagátt fyrir verktaka","meta":"Lausaverkefni · 2024","outcome":"Tilboð → samningur → framvindumyndir í einni slóð. Minnkaði núning í reikningagerð lítils verktaka."},{"id":"site-rebuild","title":"Þessi vefur","meta":"Nýsmíði · Node + Postgres + hreint JS","outcome":"Full-stack, tvítyngt, CMS-stýrt. Hver lína skrifuð, yfirfarin og birt af einni manneskju."}]$j$::jsonb,
                'blend_skill_groups', $j$[{"id":"diagnosis","title":"Greining","items":["Að sjá vandamálið á bak við það sem er nefnt","Að lesa hvað kerfið segir um sig sjálft","Að aðgreina einkenni frá orsök undir tímapressu"]},{"id":"precision","title":"Nákvæmni & mæling","items":["Að skuldbinda í millímetrum eða millísekúndum","Vikmörk-miðuð hugsun","Að skipuleggja skurði sem ekki verður hægt að taka til baka"]},{"id":"horizon","title":"Langtímahugsun","items":["Að byggja fyrir næstu tuttugu árin, ekki næsta sprett","Að velja efni og skilyrðingar sem eldast vel","Skjölun sem gjöf til framtíðarumsjónarmanna"]},{"id":"communication","title":"Viðskiptavinasamskipti","items":["Að þýða handverksmál yfir á viðskiptamál","Að gera tilboð heiðarlega, þar á meðal óþægilegu atriðin","Að segja nei við röngum umfangi"]}]$j$::jsonb,
                'blend_experience',   $j$[{"id":"cabinet-config","title":"Breytulegur skáphönnunarvefur","meta":"Blendingsverkefni · 2023","outcome":"Vefverkfæri sem breytir málum viðskiptavinarins í skurðalista og verð. Verkstæðisgólfið les það sem vafrinn sendi."},{"id":"job-tracker","title":"Framvinduforrit fyrir byggingarsvæði","meta":"Prófað á þremur byggingum","outcome":"Farsímavænt yfirlit yfir stöðu byggingar — hvað er rammað, hvað er raflagt, hvað er stöðvað. Skrifað af þeim sem hefur staðið báðum megin við pappírinn."},{"id":"design-review","title":"Tæknileg hönnunarrýni fyrir lítið fyrirtæki","meta":"Ráðgjöf · 2024","outcome":"Tvö dagar á staðnum, skrifleg skýrsla, framhaldssímtal. Sama auga sem sér skakkan bita sér einnig viðkvæma API-samninga."}]$j$::jsonb
              ) || value,
              updated_at = NOW()
        WHERE key = 'halli_bio' AND locale = 'is'
          AND (NOT value ? 'craft_skill_groups'
            OR NOT value ? 'craft_experience'
            OR NOT value ? 'code_skill_groups'
            OR NOT value ? 'code_experience'
            OR NOT value ? 'blend_skill_groups'
            OR NOT value ? 'blend_experience')`,
    ],
  },
  {
    // Seed defaults for the two CSS-derived hero images on /halli so admins
    // can replace them via the inline image-edit UI without breaking the
    // signed-out look. `beginning_image_url` is intentionally left absent —
    // its absence triggers the inline _icelandSvg() fallback in HalliView.
    name: '040_halli_bio_image_urls',
    statements: [
      `UPDATE site_content
          SET value = value || jsonb_build_object(
                'craft_image_url', 'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=1600&h=600&fit=crop&q=80',
                'life_image_url',  'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1600&h=600&fit=crop&q=80'
              ),
              updated_at = NOW()
        WHERE key = 'halli_bio' AND locale = 'en'
          AND (NOT value ? 'craft_image_url' OR NOT value ? 'life_image_url')`,

      `UPDATE site_content
          SET value = value || jsonb_build_object(
                'craft_image_url', 'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=1600&h=600&fit=crop&q=80',
                'life_image_url',  'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1600&h=600&fit=crop&q=80'
              ),
              updated_at = NOW()
        WHERE key = 'halli_bio' AND locale = 'is'
          AND (NOT value ? 'craft_image_url' OR NOT value ? 'life_image_url')`,
    ],
  },
  {
    // Case-insensitive uniqueness on username, enforced at the DB level so
    // concurrent updates can't slip a duplicate past a SELECT-then-UPDATE check.
    // Login (authController) already matches LOWER(username) = LOWER($1), so
    // this index also serves that lookup. Existing case-sensitive UNIQUE on
    // users.username (from 002_auth_users) stays in place; the two coexist.
    //
    // LOWER() relies on the database's lc_ctype. Postgres on hosted UTF-8
    // locales (en_US.UTF-8, C.UTF-8, is_IS.UTF-8) lowercases Icelandic
    // letters correctly (Á→á, Þ→þ, Ð→ð, Æ→æ, Ö→ö, etc.). A `C`-locale
    // cluster would not — but every environment we deploy to (Azure
    // Database for PostgreSQL and local dev) uses a UTF-8 locale,
    // and login already depends on the same assumption.
    name: '041_users_username_lower_unique',
    statements: [
      `CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username))`,
    ],
  },
  {
    // Logistics tracker — items the planner needs to buy and bring to the
    // venue. Two independent boolean flags (`bought`, `at_venue`) so the day
    // the cups are bought is decoupled from the day they actually arrive at
    // Mýrarkot. quantity / assigned_to are free text — "5 packs" or "Bjarni"
    // are both valid; assigned_to is intentionally NOT a foreign key so the
    // planner can credit non-guests too (caterer, family).
    name: '042_party_logistics_items',
    statements: [
      `CREATE TABLE IF NOT EXISTS party_logistics_items (
        id           SERIAL      PRIMARY KEY,
        name         TEXT        NOT NULL,
        quantity     TEXT,
        assigned_to  TEXT,
        bought       BOOLEAN     NOT NULL DEFAULT FALSE,
        at_venue     BOOLEAN     NOT NULL DEFAULT FALSE,
        sort_order   INTEGER     NOT NULL DEFAULT 0,
        created_by   TEXT        REFERENCES users(id) ON DELETE SET NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_party_logistics_sort
         ON party_logistics_items (sort_order, id)`,
    ],
  },
  {
    // Strip stale Railway references from the seeded site_content rows.
    // Production moved off Railway to Azure App Service back on 2026-04-09,
    // but earlier migrations (007 home_skills, 030/036/037/038 contact_built_with,
    // and their locale backfills) baked "Railway" into the JSONB values that
    // end up rendered on the homepage Cloud stat and the Contact page
    // "Built with" pills + body prose. The corresponding JS fallbacks in
    // HomeView.js and ContactView.js have been updated; this migration
    // rewrites the DB rows so the live site doesn't keep serving the
    // stale copy.
    //
    // Safe to rerun: each UPDATE filters with `WHERE … LIKE '%Railway%'`,
    // so a second pass touches zero rows. Replacement targets are unique
    // enough that an accidental partial match is implausible (admin edits
    // post-deploy that reintroduce "Railway" would simply not be touched
    // by a re-run, since the migration only runs once anyway).
    name: '043_strip_stale_railway_references',
    statements: [
      // home_skills: cloud stat "Azure · Railway" → "Azure" (en + is rows)
      `UPDATE site_content
          SET value = REPLACE(value::text, '"Azure · Railway"', '"Azure"')::jsonb,
              updated_at = NOW()
        WHERE key = 'home_skills' AND value::text LIKE '%"Azure · Railway"%'`,

      // contact_built_with: strip "Railway" pill, replace "Azure or Railway"
      // / "Azure eða Railway" with "Azure App Service" in body prose. Done
      // as nested REPLACE on the text representation so all three edits land
      // in a single UPDATE.
      `UPDATE site_content
          SET value = REPLACE(REPLACE(REPLACE(
                value::text,
                ',"Railway"',         ''
              ), 'Azure or Railway',  'Azure App Service'
              ), 'Azure eða Railway', 'Azure App Service')::jsonb,
              updated_at = NOW()
        WHERE key = 'contact_built_with' AND value::text LIKE '%Railway%'`,
    ],
  },
  {
    // Seed the admin-editable "halli.js" code-snippet box on /halli with its
    // initial shape. The box was previously hardcoded inside HalliView._code();
    // moving it into site_content lets admins edit every line and have the IS
    // side auto-translate via runAutoTranslateSideEffect. `type: 'literal'`
    // rows tell translator.collectLeaves to skip their `value` so code-shaped
    // strings (like `() => true`) stay byte-identical across locales; the
    // `filename` key is on translator.BLOCK_KEYS for the same reason.
    //
    // `jsonb_build_object(...) || value` puts the seed first so existing keys
    // win the merge — re-running the migration after an admin has edited the
    // snippet leaves those edits untouched. The `NOT value ? 'code_snippet_properties'`
    // guard makes the whole statement a no-op on second run.
    name: '044_halli_bio_code_snippet',
    statements: [
      // English
      `UPDATE site_content
          SET value = jsonb_build_object(
                'code_snippet_filename', 'halli.js',
                'code_snippet_comment',  '// Two disciplines, one craftsman',
                'code_snippet_properties', $j$[
                  {"id":"p_languages","key":"languages","type":"array","value":["JavaScript","Python","SQL"]},
                  {"id":"p_tools","key":"tools","type":"array","value":["hand plane","chisel","vim"]},
                  {"id":"p_philosophy","key":"philosophy","type":"string","value":"measure twice, ship once"},
                  {"id":"p_home","key":"home","type":"string","value":"Iceland"},
                  {"id":"p_craft","key":"craft","type":"literal","value":"() => true"}
                ]$j$::jsonb
              ) || value,
              updated_at = NOW()
        WHERE key = 'halli_bio' AND locale = 'en'
          AND NOT value ? 'code_snippet_properties'`,

      // Icelandic — hand-translated human-language values; filename, language
      // names, and the literal `() => true` mirror the EN seed exactly so the
      // background auto-translate side effect has nothing to overwrite.
      `UPDATE site_content
          SET value = jsonb_build_object(
                'code_snippet_filename', 'halli.js',
                'code_snippet_comment',  '// Tvær iðnir, einn smiður',
                'code_snippet_properties', $j$[
                  {"id":"p_languages","key":"languages","type":"array","value":["JavaScript","Python","SQL"]},
                  {"id":"p_tools","key":"tools","type":"array","value":["handhefill","meitill","vim"]},
                  {"id":"p_philosophy","key":"philosophy","type":"string","value":"mæla tvisvar, smíða einu sinni"},
                  {"id":"p_home","key":"home","type":"string","value":"Ísland"},
                  {"id":"p_craft","key":"craft","type":"literal","value":"() => true"}
                ]$j$::jsonb
              ) || value,
              updated_at = NOW()
        WHERE key = 'halli_bio' AND locale = 'is'
          AND NOT value ? 'code_snippet_properties'`,
    ],
  },
  {
    // Shop redesign step 1 — see docs/SHOP_REDESIGN.md.
    //
    // The existing products.category (from 024_product_variants) held
    // apparel-style values like 'apparel', 'accessories', 'roof_box'. The
    // redesign treats those as *subcategory* and uses `category` for the new
    // top-level taxonomy: 'product' | 'tech_service' | 'carpentry_service'.
    //
    // So: rename the old column → subcategory, then add a fresh top-level
    // category (NOT NULL DEFAULT 'product' backfills existing apparel rows
    // correctly — they become category='product', subcategory='apparel').
    //
    // Service-only fields (duration_minutes, delivery_format, is_bookable)
    // stay NULL/FALSE on physical products and drive the section-page filters
    // and the booking follow-up flow in later build-order steps.
    name: '045_shop_sections',
    statements: [
      // Idempotent rename: only if the old column exists and the new one
      // doesn't. Re-running this migration is a no-op.
      `DO $$ BEGIN
         IF EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='products' AND column_name='category')
            AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='products' AND column_name='subcategory')
         THEN ALTER TABLE products RENAME COLUMN category TO subcategory;
         END IF;
       END $$`,

      // The old idx_products_category was tied to the renamed column name;
      // drop and recreate against the new column. The new top-level category
      // index gets its own line below.
      `DROP INDEX IF EXISTS idx_products_category`,
      `CREATE INDEX IF NOT EXISTS idx_products_subcategory ON products (subcategory)`,

      // New top-level category. NOT NULL DEFAULT backfills existing rows.
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'product'`,
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='products_category_check') THEN
           ALTER TABLE products ADD CONSTRAINT products_category_check
             CHECK (category IN ('product','tech_service','carpentry_service'));
         END IF;
       END $$`,
      `CREATE INDEX IF NOT EXISTS idx_products_category ON products (category)`,

      // Service-only metadata. All nullable / default-false; physical
      // products leave these unset.
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS duration_minutes INTEGER
         CHECK (duration_minutes IS NULL OR duration_minutes > 0)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_format TEXT`,
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='products_delivery_format_check') THEN
           ALTER TABLE products ADD CONSTRAINT products_delivery_format_check
             CHECK (delivery_format IS NULL OR delivery_format IN ('remote','in_person','hybrid'));
         END IF;
       END $$`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS is_bookable BOOLEAN NOT NULL DEFAULT FALSE`,
    ],
  },
  {
    // First-party cookieless web analytics.
    // page_views      = high-volume columnar table we aggregate over.
    // analytics_events = low-volume, extensible conversion table (event_type + JSONB props).
    // NO raw PII at rest: visitor_token is an irreversible daily hash of
    // (ip + user-agent + a rotating in-memory salt). See server/services/analyticsSalt.js.
    // Authoritative copy; human-reference duplicate in server/migrations/046_analytics.sql.
    name: '046_analytics',
    statements: [
      `CREATE TABLE IF NOT EXISTS page_views (
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
      )`,
      `CREATE INDEX IF NOT EXISTS idx_page_views_view_date     ON page_views (view_date)`,
      `CREATE INDEX IF NOT EXISTS idx_page_views_path          ON page_views (path)`,
      `CREATE INDEX IF NOT EXISTS idx_page_views_visitor_date  ON page_views (view_date, visitor_token)`,
      `CREATE INDEX IF NOT EXISTS idx_page_views_referrer_host ON page_views (referrer_host) WHERE referrer_host IS NOT NULL`,

      `CREATE TABLE IF NOT EXISTS analytics_events (
        id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        event_type    TEXT        NOT NULL
                                  CHECK (event_type IN ('contact_submit','party_rsvp','shop_checkout')),
        path          TEXT,
        locale        TEXT,
        props         JSONB       NOT NULL DEFAULT '{}'::jsonb,
        event_date    DATE        NOT NULL DEFAULT CURRENT_DATE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_events_type_date ON analytics_events (event_type, event_date)`,
    ],
  },
  {
    // Key-value application settings (app_settings). One row per setting: a
    // stable string key + a JSONB value. Backs the admin "General settings"
    // page and is the intended home for feature flags later phases introduce.
    // See server/models/Setting.js.
    // Authoritative copy; human-reference duplicate in server/migrations/047_app_settings.sql.
    name: '047_app_settings',
    statements: [
      `CREATE TABLE IF NOT EXISTS app_settings (
        key        TEXT        PRIMARY KEY,
        value      JSONB       NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON app_settings`,
      `CREATE TRIGGER trg_app_settings_updated_at
         BEFORE UPDATE ON app_settings
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
    ],
  },
  {
    // Product inventory codes — SKU + barcode (EAN-13/UPC/GTIN/ISBN). Optional
    // TEXT; sku is indexed for lookup. Surfaced in the admin product editor,
    // with an optional native-camera barcode scanner that fills the field.
    // Authoritative copy; human-reference duplicate in server/migrations/048_product_codes.sql.
    name: '048_product_codes',
    statements: [
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS sku     TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_products_sku ON products (sku)`,
    ],
  },
  {
    // Product collections — admin-managed groups of products (distinct from the
    // free-text `category`). Used for grouping/filtering and for discount
    // targeting (phase 4.1). product_collections is the many-to-many join.
    // Authoritative copy; human-reference duplicate in server/migrations/049_collections.sql.
    name: '049_collections',
    statements: [
      `CREATE TABLE IF NOT EXISTS collections (
        id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        slug        TEXT NOT NULL UNIQUE,
        title       TEXT NOT NULL,
        description TEXT,
        active      BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_collections_slug   ON collections (slug)`,
      `CREATE INDEX IF NOT EXISTS idx_collections_active ON collections (active) WHERE active = TRUE`,
      `DROP TRIGGER IF EXISTS trg_collections_updated_at ON collections`,
      `CREATE TRIGGER trg_collections_updated_at BEFORE UPDATE ON collections
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
      `CREATE TABLE IF NOT EXISTS product_collections (
        product_id    TEXT NOT NULL REFERENCES products(id)    ON DELETE CASCADE,
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (product_id, collection_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_product_collections_collection ON product_collections (collection_id)`,
    ],
  },
  {
    // Discount codes — B2C subset of the icelandicstore engine: code-based,
    // order-level percentage/fixed discounts with min-subtotal, total usage
    // limit, and a date window. (The store's automatic/product/free-shipping/
    // buy-x-get-y types, collection/wholesale targeting, and per-customer
    // redemptions are deliberately out of scope here.) orders gains a
    // discount_code + discount_amount snapshot for when checkout records one.
    // Authoritative copy; human-reference duplicate in server/migrations/050_discounts.sql.
    name: '050_discounts',
    statements: [
      `CREATE TABLE IF NOT EXISTS discounts (
        id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        code          TEXT        NOT NULL,
        title         TEXT        NOT NULL,
        value_type    TEXT        NOT NULL CHECK (value_type IN ('percentage','fixed')),
        value         INTEGER     NOT NULL CHECK (value >= 0),
        currency      TEXT        NOT NULL DEFAULT 'ISK' CHECK (currency IN ('ISK','EUR')),
        min_subtotal  INTEGER     CHECK (min_subtotal IS NULL OR min_subtotal >= 0),
        usage_limit   INTEGER     CHECK (usage_limit IS NULL OR usage_limit >= 1),
        used_count    INTEGER     NOT NULL DEFAULT 0 CHECK (used_count >= 0),
        enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
        starts_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ends_at       TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_discounts_code_lower ON discounts (LOWER(code))`,
      `DROP TRIGGER IF EXISTS trg_discounts_updated_at ON discounts`,
      `CREATE TRIGGER trg_discounts_updated_at BEFORE UPDATE ON discounts
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code   TEXT`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0)`,
    ],
  },
  {
    // Background media library — a flat global library of images/videos the
    // admin can pick the home-hero background from. (The upstream store also
    // had named sections for a tiled mosaic; dropped here — this site's hero is
    // a single video/photo, so no sections/mosaic.) The active landing choice
    // lives in site_content key 'landing_background' { mode, photo_url,
    // veil_percent } with mode video|photo|plain (video = current default).
    // Authoritative copy; human-reference duplicate in server/migrations/051_background_media.sql.
    name: '051_background_media',
    statements: [
      `CREATE TABLE IF NOT EXISTS background_media (
        id          SERIAL      PRIMARY KEY,
        file_path   TEXT        NOT NULL,
        media_type  TEXT        NOT NULL DEFAULT 'image' CHECK (media_type IN ('image','video')),
        caption     TEXT,
        caption_is  TEXT,
        sort_order  INTEGER     NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_background_media_sort ON background_media (sort_order, id)`,
    ],
  },
  {
    // In-app change-request (feedback) tool — non-production only. One testing
    // session submits a batch of items → admin inbox. Parent batch + child
    // items; per-item open/resolved status. Authoritative copy; human-reference
    // duplicate in server/migrations/052_change_requests.sql.
    name: '052_change_requests',
    statements: [
      `CREATE TABLE IF NOT EXISTS change_request_batches (
        id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        submitter_user_id TEXT        REFERENCES users(id) ON DELETE SET NULL,
        submitter_email   TEXT,
        user_agent        TEXT,
        item_count        INTEGER     NOT NULL DEFAULT 0,
        submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `DROP TRIGGER IF EXISTS trg_cr_batches_updated_at ON change_request_batches`,
      `CREATE TRIGGER trg_cr_batches_updated_at BEFORE UPDATE ON change_request_batches
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
      `CREATE TABLE IF NOT EXISTS change_requests (
        id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        batch_id         TEXT        NOT NULL REFERENCES change_request_batches(id) ON DELETE CASCADE,
        page_url         TEXT        NOT NULL,
        page_label       TEXT,
        element_selector TEXT,
        element_label    TEXT,
        note             TEXT        NOT NULL,
        screenshot_path  TEXT,
        status           TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `DROP TRIGGER IF EXISTS trg_cr_updated_at ON change_requests`,
      `CREATE TRIGGER trg_cr_updated_at BEFORE UPDATE ON change_requests
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
      `CREATE INDEX IF NOT EXISTS idx_cr_batch_id ON change_requests (batch_id)`,
      `CREATE INDEX IF NOT EXISTS idx_cr_status   ON change_requests (status)`,
      `CREATE INDEX IF NOT EXISTS idx_cr_batches_submitted_at ON change_request_batches (submitted_at DESC)`,
    ],
  },
  {
    // Per-admin sidebar layout customization (admin "edit mode": rename items,
    // drag-reorder within/across sections, create sections). One JSONB blob per
    // admin user, shaped { v, sections:[{key,title,items:[id]}], labels }. The
    // frontend reconciles it against the code-defined ADMIN_NAV at render, so
    // routes/icons are never persisted (a moved item keeps working). NULL =
    // default layout. Authoritative copy; human-reference duplicate in
    // server/migrations/053_admin_nav_config.sql.
    name: '053_admin_nav_config',
    statements: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_nav_config JSONB`,
    ],
  },
  {
    // Split the single order `status` into independent payment + fulfillment
    // statuses (Shopify-style), plus order tags. The legacy `status` column is
    // kept and derived from the two so existing code/reports keep working.
    // Authoritative copy; human-reference duplicate in
    // server/migrations/054_order_payment_fulfillment_tags.sql.
    name: '054_order_payment_fulfillment_tags',
    statements: [
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status     TEXT NOT NULL DEFAULT 'pending'`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled'`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfilled_at       TIMESTAMPTZ`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS tags               JSONB NOT NULL DEFAULT '[]'::jsonb`,
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_status_check') THEN
           ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
             CHECK (payment_status IN ('pending','paid','refunded','partially_refunded','voided'));
         END IF;
       END $$`,
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_fulfillment_status_check') THEN
           ALTER TABLE orders ADD CONSTRAINT orders_fulfillment_status_check
             CHECK (fulfillment_status IN ('unfulfilled','fulfilled','partial','delivered'));
         END IF;
       END $$`,
      `CREATE INDEX IF NOT EXISTS idx_orders_payment_status     ON orders (payment_status)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status ON orders (fulfillment_status)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_tags               ON orders USING GIN (tags)`,
      // Backfill from the legacy status (guarded so it only touches rows still at
      // the default 'pending' — so re-running never clobbers admin-set values).
      `UPDATE orders SET payment_status = 'paid'   WHERE status = 'paid'     AND payment_status = 'pending'`,
      `UPDATE orders SET payment_status = 'paid', fulfillment_status = 'fulfilled'
         WHERE status = 'shipped' AND payment_status = 'pending'`,
      `UPDATE orders SET payment_status = 'refunded' WHERE status = 'refunded' AND payment_status = 'pending'`,
      `UPDATE orders SET payment_status = 'voided'   WHERE status IN ('cancelled','failed') AND payment_status = 'pending'`,
    ],
  },
  {
    // Extend discounts with a `method` (code vs automatic/no-code) and a `type`
    // (order amount vs free shipping), and add the order-side discount snapshot
    // columns the checkout records (discount_code/discount_amount already exist
    // from 049; add the title + shipping_discount). B2C scope — no product/
    // collection targeting or buy-X-get-Y (intentionally out of scope).
    // Authoritative copy; human-reference duplicate in
    // server/migrations/055_discount_types.sql.
    name: '055_discount_types',
    statements: [
      `ALTER TABLE discounts ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'code'`,
      `ALTER TABLE discounts ADD COLUMN IF NOT EXISTS type   TEXT NOT NULL DEFAULT 'order'`,
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discounts_method_check') THEN
           ALTER TABLE discounts ADD CONSTRAINT discounts_method_check CHECK (method IN ('code','automatic'));
         END IF;
       END $$`,
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discounts_type_check') THEN
           ALTER TABLE discounts ADD CONSTRAINT discounts_type_check CHECK (type IN ('order','free_shipping'));
         END IF;
       END $$`,
      `CREATE INDEX IF NOT EXISTS idx_discounts_automatic ON discounts (enabled) WHERE method = 'automatic'`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_title    TEXT`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_discount INTEGER NOT NULL DEFAULT 0 CHECK (shipping_discount >= 0)`,
    ],
  },
  {
    // Dynamic roles: a `roles` table becomes the source of truth for role names +
    // which admin views each role may access. users.role becomes a FK on
    // roles.name (no data backfill — the column already holds the name). admin
    // gets view_access ['*'] (all views, incl. future ones); the resolver also
    // hard-shortcuts role='admin' so admins can never be locked out. Built-in
    // roles are seeded BEFORE the FK is added / the old CHECK dropped. Each
    // statement is idempotent (the runner applies them without a per-migration
    // transaction). Authoritative copy; human-reference duplicate in
    // server/migrations/056_dynamic_roles.sql.
    name: '056_dynamic_roles',
    statements: [
      `CREATE TABLE IF NOT EXISTS roles (
        name        TEXT        PRIMARY KEY,
        description TEXT        NOT NULL DEFAULT '',
        view_access JSONB       NOT NULL DEFAULT '[]'::jsonb,
        is_system   BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `DROP TRIGGER IF EXISTS trg_roles_updated_at ON roles`,
      `CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON roles
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
      // Seed built-in roles BEFORE the FK / CHECK changes. admin = all views.
      `INSERT INTO roles (name, description, view_access, is_system) VALUES
         ('admin',     'Full access to every admin view',   '["*"]'::jsonb, TRUE),
         ('moderator', 'Content & party management',        '[]'::jsonb,    TRUE),
         ('user',      'Standard account (no admin views)', '[]'::jsonb,    TRUE)
       ON CONFLICT (name) DO NOTHING`,
      // Defensive: coerce any unknown role value so the FK can be added.
      `UPDATE users SET role = 'user' WHERE role NOT IN (SELECT name FROM roles)`,
      // Replace the fixed-enum CHECK with the FK to roles(name).
      `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`,
      `ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user'`,
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_fkey') THEN
           ALTER TABLE users ADD CONSTRAINT users_role_fkey
             FOREIGN KEY (role) REFERENCES roles(name) ON UPDATE CASCADE ON DELETE RESTRICT;
         END IF;
       END $$`,
    ],
  },
  {
    // Warehouse BIN code per product / variant. A bin is a short shelf code like
    // 'A-001'; the BIN System board (admin view 'bins') derives zones (the letter
    // prefix) and the per-zone numeric grid from assigned bins — there is no
    // separate bins registry. Variant bin overrides product bin via COALESCE
    // (mirrors how sku/barcode already work). Indexed for the board's
    // GROUP BY zone + per-bin lookup. Pattern ported from the sibling
    // icelandicstore repo (its 064_product_bin). Authoritative copy;
    // human-reference duplicate in server/migrations/057_product_bin.sql.
    name: '057_product_bin',
    statements: [
      `ALTER TABLE products         ADD COLUMN IF NOT EXISTS bin TEXT`,
      `ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS bin TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_products_bin         ON products (bin)`,
      `CREATE INDEX IF NOT EXISTS idx_product_variants_bin ON product_variants (bin)`,
    ],
  },
  {
    // Logistics items now group into three tables on the planner page — Food,
    // Drinks, and Everything-else. A single `category` column drives the
    // grouping; existing rows default to 'other' so live data is preserved.
    // sort_order stays global (see 042) — each category table renders its own
    // filtered, sort_order-ordered slice, so cross-category sort_order
    // collisions are harmless. The CHECK keeps the column to the three known
    // values; guarded by a pg_constraint lookup so a re-run is a no-op.
    name: '058_party_logistics_category',
    statements: [
      `ALTER TABLE party_logistics_items
         ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other'`,
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint WHERE conname = 'party_logistics_category_chk'
         ) THEN
           ALTER TABLE party_logistics_items
             ADD CONSTRAINT party_logistics_category_chk
             CHECK (category IN ('food','drinks','other'));
         END IF;
       END $$`,
    ],
  },
  {
    // Collaborative to-do list for the planning team (admin/moderator). A TODO
    // carries free-form notes plus an optional due date and a set of assignees,
    // and breaks down into subtasks that each carry their own due date and
    // assignees. `assignees` is a JSONB array of plain name strings — the same
    // free-text philosophy as logistics.assigned_to (so non-guests like a
    // caterer can be credited); the admin UI suggests known guests without
    // constraining to them. Subtasks cascade-delete with their parent TODO.
    name: '059_party_todos',
    statements: [
      `CREATE TABLE IF NOT EXISTS party_todos (
        id          SERIAL      PRIMARY KEY,
        title       TEXT        NOT NULL,
        notes       TEXT,
        done        BOOLEAN     NOT NULL DEFAULT FALSE,
        due_date    DATE,
        assignees   JSONB       NOT NULL DEFAULT '[]'::jsonb,
        sort_order  INTEGER     NOT NULL DEFAULT 0,
        created_by  TEXT        REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_party_todos_sort
         ON party_todos (sort_order, id)`,
      `CREATE TABLE IF NOT EXISTS party_todo_subtasks (
        id          SERIAL      PRIMARY KEY,
        todo_id     INTEGER     NOT NULL REFERENCES party_todos(id) ON DELETE CASCADE,
        title       TEXT        NOT NULL,
        done        BOOLEAN     NOT NULL DEFAULT FALSE,
        due_date    DATE,
        assignees   JSONB       NOT NULL DEFAULT '[]'::jsonb,
        sort_order  INTEGER     NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_party_todo_subtasks_todo
         ON party_todo_subtasks (todo_id, sort_order, id)`,
    ],
  },
  {
    // Party access overhaul: the shared invite code (026) is retired in favour of
    // an email-request -> owner-approval -> magic-link flow. approval_status
    // defaults to 'approved' so every existing row and the normal /signup path are
    // unaffected; only party-page requests are written as 'pending'. The magic-login
    // token is a permanent, reusable bearer credential, so it is stored sha256-HASHED
    // (never plaintext, unlike the older verify/reset tokens) and is revocable by
    // nulling the hash. The approval-action token backs the one-click email approve
    // link (single-use, short-lived). password_hash is already nullable (020), so
    // pending guests are created with no password.
    name: '060_party_access_requests',
    statements: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved'`,
      `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_approval_status_check`,
      `ALTER TABLE users ADD CONSTRAINT users_approval_status_check
         CHECK (approval_status IN ('pending', 'approved', 'declined'))`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by  TEXT REFERENCES users(id) ON DELETE SET NULL`,
      // Permanent, reusable magic-login credential — stored hashed, looked up by hash.
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS magic_login_token_hash       TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS magic_login_token_created_at TIMESTAMPTZ`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_magic_login_token_hash
         ON users (magic_login_token_hash) WHERE magic_login_token_hash IS NOT NULL`,
      // One-click email-approval token — single-use, short-lived, also hashed.
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_action_token_hash TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_action_expires    TIMESTAMPTZ`,
      `CREATE INDEX IF NOT EXISTS idx_users_approval_action_token_hash
         ON users (approval_action_token_hash) WHERE approval_action_token_hash IS NOT NULL`,
      // Retire the shared invite code so it can never be redeemed again.
      `DELETE FROM site_content WHERE key = 'party_invite_code'`,
    ],
  },
  {
    // Multi-role membership: a user may belong to several roles at once. user_roles
    // is the source of truth for the role SET; users.role is kept as a denormalized
    // "primary" role (display, the default at the user-INSERT sites, the
    // WHERE role='admin' notify queries, and the floor). Effective permissions =
    // the union across all of a user's roles (admin in the set => all views). The
    // role_name FK is ON DELETE RESTRICT to preserve the "reassign members before
    // deleting a role" behaviour (the delete handler catches FK 23503 -> roleInUse).
    // Backfills every existing user's current single role as their first membership.
    // Each statement is idempotent. Authoritative copy; human-reference duplicate in
    // server/migrations/061_user_roles.sql.
    name: '061_user_roles',
    statements: [
      `CREATE TABLE IF NOT EXISTS user_roles (
        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_name  TEXT        NOT NULL REFERENCES roles(name) ON UPDATE CASCADE ON DELETE RESTRICT,
        granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        granted_by TEXT        REFERENCES users(id) ON DELETE SET NULL,
        PRIMARY KEY (user_id, role_name)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles (role_name)`,
      // Backfill: every existing user's current role becomes their first membership.
      `INSERT INTO user_roles (user_id, role_name)
         SELECT id, role FROM users ON CONFLICT DO NOTHING`,
      // Mirror users.role (the primary) into user_roles automatically, so every
      // account-creation path (signup, OAuth, customer import, party guests,
      // bootstrap) and every primary-role change yields a membership without
      // touching those ~7 INSERT sites. The invariant "primary is always a
      // membership" is thus enforced in the DB.
      `CREATE OR REPLACE FUNCTION sync_primary_user_role() RETURNS trigger AS $$
       BEGIN
         INSERT INTO user_roles (user_id, role_name)
         VALUES (NEW.id, NEW.role)
         ON CONFLICT DO NOTHING;
         RETURN NEW;
       END;
       $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_users_sync_primary_role ON users`,
      `CREATE TRIGGER trg_users_sync_primary_role
         AFTER INSERT OR UPDATE OF role ON users
         FOR EACH ROW EXECUTE FUNCTION sync_primary_user_role()`,
    ],
  },
  {
    // Party flow change: guests are auto-granted access on request (instant
    // magic link); the owner's "approve" action now sends a party-info
    // ("welcome") email instead of gating access. These columns track that
    // send so the admin queue can list guests who haven't received the info
    // email yet, independent of approval_status (which partyMagicLogin flips
    // to 'approved' on every sign-in and the password-login gate 403s when
    // 'pending' — so it can't double as a "welcome not sent" flag). Also a
    // one-time locale data fix: party-flow guests picked up preferred_locale
    // 'en' from the column default / the old client bug that persisted the
    // English fallback as if chosen; the party audience is Icelandic-first.
    // Human-reference duplicate in server/migrations/062_party_welcome_email.sql.
    name: '062_party_welcome_email',
    statements: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_email_sent_by TEXT REFERENCES users(id) ON DELETE SET NULL`,
      `UPDATE users SET preferred_locale = 'is'
        WHERE preferred_locale = 'en'
          AND role = 'user'
          AND (requested_at IS NOT NULL OR magic_login_token_created_at IS NOT NULL)`,
    ],
  },
  {
    // Cost tracking for the party planner. Logistics rows get a numeric
    // quantity + integer unit_price (whole ISK, matching the shop's
    // whole-krónur convention) so a line cost (qty × price) can be computed;
    // todos get an optional integer cost.
    //
    // quantity was free text ("2 kassar", "6-pack", "1.234 stk"). Conversion
    // rules (Icelandic-first — "." and space are thousands separators, ","
    // is the decimal comma; "." with 1-2 digits also accepted as a decimal):
    //   thousands-grouped  "1.234 stk" / "1 000"  -> 1234 / 1000  + note
    //   simple number      "100" / "2,5 kg" / "6-pack" -> 100 / 2.5 / 6 + note
    //   anything ambiguous, oversized (> 10 int digits, would overflow
    //   NUMERIC(12,2) and ABORT the migration), or non-numeric
    //   ("handfylli", "1,2345", "12345678901") -> quantity NULL and the FULL
    //   original text preserved in quantity_note — never corrupted, never
    //   lost, and startup can never fail on weird prod data.
    // The conversion computes note+number in ONE pass (temp numeric column,
    // shared CASE conditions), then swaps the columns. The DO block only runs
    // while quantity is still text, so a re-run — and a fresh install where
    // 042 just created it as TEXT — is handled. Guards are schema/table
    // qualified so same-named objects elsewhere can't confuse them. Note the
    // POSIX character classes: '\\s' in a JS template literal reaches SQL as
    // 's', so [[:space:]]/[0-9] are required. Human-reference duplicate in
    // server/migrations/063_party_costs.sql.
    name: '063_party_costs',
    statements: [
      `ALTER TABLE party_logistics_items ADD COLUMN IF NOT EXISTS quantity_note TEXT`,
      `ALTER TABLE party_logistics_items ADD COLUMN IF NOT EXISTS unit_price INTEGER`,
      `ALTER TABLE party_todos ADD COLUMN IF NOT EXISTS cost INTEGER`,
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'party_logistics_items'
              AND column_name = 'quantity' AND data_type = 'text'
         ) THEN
           ALTER TABLE party_logistics_items ADD COLUMN quantity_num NUMERIC(12,2);
           UPDATE party_logistics_items p
              SET quantity_num  = s.qnum,
                  quantity_note = s.qnote
             FROM (
               SELECT id,
                      CASE
                        WHEN tt IS NOT NULL AND length(regexp_replace(tt, '[. ]', '', 'g')) <= 10
                          THEN regexp_replace(tt, '[. ]', '', 'g')::numeric
                        WHEN st IS NOT NULL
                          THEN replace(st, ',', '.')::numeric
                        ELSE NULL
                      END AS qnum,
                      CASE
                        WHEN tt IS NOT NULL AND length(regexp_replace(tt, '[. ]', '', 'g')) <= 10
                          THEN NULLIF(btrim(substr(trimmed, length(tt) + 1)), '')
                        WHEN st IS NOT NULL
                          THEN NULLIF(btrim(substr(trimmed, length(st) + 1)), '')
                        ELSE NULLIF(trimmed, '')
                      END AS qnote
                 FROM (
                   SELECT id,
                          btrim(quantity) AS trimmed,
                          substring(btrim(quantity) from '^([0-9]{1,3}([. ][0-9]{3})+)($|[^0-9])')       AS tt,
                          substring(btrim(quantity) from '^([0-9]{1,9}([.,][0-9]{1,2})?)($|[^0-9.,])')   AS st
                     FROM party_logistics_items
                    WHERE quantity IS NOT NULL
                 ) x
             ) s
            WHERE p.id = s.id;
           ALTER TABLE party_logistics_items DROP COLUMN quantity;
           ALTER TABLE party_logistics_items RENAME COLUMN quantity_num TO quantity;
         END IF;
       END $$`,
      `DO $$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint
                         WHERE conname = 'party_logistics_qty_nonneg_chk'
                           AND conrelid = 'public.party_logistics_items'::regclass) THEN
           ALTER TABLE party_logistics_items
             ADD CONSTRAINT party_logistics_qty_nonneg_chk CHECK (quantity IS NULL OR quantity >= 0);
         END IF;
         IF NOT EXISTS (SELECT 1 FROM pg_constraint
                         WHERE conname = 'party_logistics_price_nonneg_chk'
                           AND conrelid = 'public.party_logistics_items'::regclass) THEN
           ALTER TABLE party_logistics_items
             ADD CONSTRAINT party_logistics_price_nonneg_chk CHECK (unit_price IS NULL OR unit_price >= 0);
         END IF;
         IF NOT EXISTS (SELECT 1 FROM pg_constraint
                         WHERE conname = 'party_todos_cost_nonneg_chk'
                           AND conrelid = 'public.party_todos'::regclass) THEN
           ALTER TABLE party_todos
             ADD CONSTRAINT party_todos_cost_nonneg_chk CHECK (cost IS NULL OR cost >= 0);
         END IF;
       END $$`,
    ],
  },
  {
    // Staff-authored, categorized note LOG about a customer (order preferences,
    // how they order, special needs, general) — shown on the admin Customers list
    // and on a customer's order detail. Per-note visibility: 'admin' = admins
    // only, 'staff' = anyone holding the grantable 'customers' view. author_name
    // is a snapshot so a note survives its author being deleted. Ported from
    // icelandicstore (89285ef) with the polymorphic company owner collapsed to
    // user-only (B2C). Human-reference duplicate in
    // server/migrations/064_customer_notes.sql.
    name: '064_customer_notes',
    statements: [
      `CREATE TABLE IF NOT EXISTS customer_notes (
        id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category    TEXT        NOT NULL DEFAULT 'general'
                                CHECK (category IN ('order_prefs','ordering','special_needs','general')),
        body        TEXT        NOT NULL,
        visibility  TEXT        NOT NULL DEFAULT 'admin' CHECK (visibility IN ('admin','staff')),
        author_id   TEXT        REFERENCES users(id) ON DELETE SET NULL,
        author_name TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_customer_notes_user   ON customer_notes (user_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_customer_notes_author ON customer_notes (author_id)`,
      `DROP TRIGGER IF EXISTS trg_customer_notes_updated_at ON customer_notes`,
      `CREATE TRIGGER trg_customer_notes_updated_at
         BEFORE UPDATE ON customer_notes
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
    ],
  },
  {
    // Bulk welcome-invite flow: invited_at marks a customer as already sent the
    // set-password invite so the admin "Send invites" action is idempotent —
    // candidates are approved, passwordless, not-yet-invited customers. Stamped
    // only after a successful send so a mail failure stays retryable. Ported
    // from icelandicstore (66d084c). Human-reference duplicate in
    // server/migrations/065_user_invited_at.sql.
    name: '065_user_invited_at',
    statements: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ`,
    ],
  },
  {
    // Admin override for a guest's RSVP bucket. When set it wins over the
    // status derived from the guest's own `attend_when` answer (see
    // _deriveRsvpStatus), letting the host set/correct an RSVP straight from
    // the admin attendance table — e.g. for a guest who replied by text.
    // NULL = no override (derive from the guest's answer as before). The CHECK
    // is added separately and idempotently so re-runs stay clean.
    name: '066_party_rsvp_admin_status',
    statements: [
      `ALTER TABLE party_rsvps ADD COLUMN IF NOT EXISTS admin_status TEXT`,
      `ALTER TABLE party_rsvps DROP CONSTRAINT IF EXISTS party_rsvps_admin_status_chk`,
      `ALTER TABLE party_rsvps ADD CONSTRAINT party_rsvps_admin_status_chk
         CHECK (admin_status IS NULL OR admin_status IN ('going', 'maybe', 'declined'))`,
    ],
  },
  {
    // Admin-managed companion overrides ("RSVP Stýring") for the attendance
    // table: when a guest phones/texts a change of plan (bringing a spouse,
    // kids and their ages), the host records the CURRENT plan here without
    // touching the guest's original RSVP answers. Shape:
    //   { plus_one: bool, kids_count: int, kids_ages: string }
    // All keys optional; NULL column = not set (UI falls back to the guest's
    // own answer). Validated in the controller like the `answers` JSONB.
    name: '067_party_rsvp_admin_companions',
    statements: [
      `ALTER TABLE party_rsvps ADD COLUMN IF NOT EXISTS admin_companions JSONB`,
    ],
  },
  {
    // Logistics categories become data instead of a hardcoded triple. 058 fixed
    // the set to ('food','drinks','other') via a CHECK; the planner needs to add
    // their own sections ("Skreytingar", "Salur") without a deploy, so the CHECK
    // is replaced by a registry table + FK.
    //
    // `label` is NULL for the three built-ins — their names are i18n keys
    // resolved at render time (party.admin.logisticsCatFood etc.), so they stay
    // translated when the admin flips EN/IS. Custom categories carry a literal
    // label typed by the planner in whichever locale they used; there is no
    // translation pipeline for user data, and inventing one for two words of
    // section title isn't worth it.
    //
    // `is_builtin` guards deletion: dropping 'other' would break the DEFAULT
    // that ON DELETE SET DEFAULT depends on, and dropping food/drinks would
    // orphan i18n keys. The controller enforces it; the column is the record.
    //
    // The FK carries ON DELETE SET DEFAULT so deleting a custom section sweeps
    // its items into 'other' rather than deleting them — losing a priced item
    // because a section was renamed away would be a silent data loss the
    // planner would only notice in the final bill. Existing rows are guaranteed
    // FK-clean because 058's CHECK admitted only the three seeded keys.
    name: '068_party_logistics_categories',
    statements: [
      `CREATE TABLE IF NOT EXISTS party_logistics_categories (
        id          SERIAL      PRIMARY KEY,
        key         TEXT        NOT NULL UNIQUE,
        label       TEXT,
        icon        TEXT,
        sort_order  INTEGER     NOT NULL DEFAULT 0,
        is_builtin  BOOLEAN     NOT NULL DEFAULT FALSE,
        created_by  TEXT        REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      // Seed the three built-ins to match 058's CHECK values and the icons the
      // view used to hardcode. ON CONFLICT DO NOTHING keeps re-runs a no-op and
      // preserves any sort_order the planner has since dragged them into.
      `INSERT INTO party_logistics_categories (key, label, icon, sort_order, is_builtin)
       VALUES ('food', NULL, '🍽️', 1, TRUE),
              ('drinks', NULL, '🥤', 2, TRUE),
              ('other', NULL, '📦', 3, TRUE)
       ON CONFLICT (key) DO NOTHING`,
      `ALTER TABLE party_logistics_items DROP CONSTRAINT IF EXISTS party_logistics_category_chk`,
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint WHERE conname = 'party_logistics_category_fk'
         ) THEN
           ALTER TABLE party_logistics_items
             ADD CONSTRAINT party_logistics_category_fk
             FOREIGN KEY (category) REFERENCES party_logistics_categories (key)
             ON UPDATE CASCADE ON DELETE SET DEFAULT;
         END IF;
       END $$`,
      `CREATE INDEX IF NOT EXISTS idx_party_logistics_categories_sort
         ON party_logistics_categories (sort_order, id)`,
    ],
  },
  {
    // Project plan for running the party as an operation: what gets picked up,
    // set up, minded during the party, and packed away afterwards. The existing
    // to-do list (059) answers "who is doing what"; this answers "how many
    // helpers do we need, and when" — hence time_minutes and people_needed,
    // which the admin view sums per phase into a staffing strip.
    //
    // Phases are data, not an enum, for the same reason logistics categories
    // are (068): every party invents its own steps ("Sækja tjald", "Þrífa
    // salinn") and none of them are worth a deploy. Same registry shape, same
    // NULL-label-means-i18n-key convention, same is_builtin deletion guard.
    // 'other' is the sweep target for ON DELETE SET DEFAULT so deleting a phase
    // reparents its tasks instead of destroying planning work.
    //
    // linked_todo_id is a soft pointer at the per-person to-do list: a plan task
    // can spawn or adopt a TODO so the person acting on it sees it in their own
    // list. ON DELETE SET NULL — deleting the TODO unlinks, it does not delete
    // the plan task, because the work still needs doing even if nobody is
    // currently assigned to it.
    //
    // time_minutes and people_needed are nullable: "unknown yet" is a real and
    // common state during planning, and NULL keeps it out of the totals rather
    // than pretending an unestimated task takes zero minutes.
    name: '069_party_plan',
    statements: [
      `CREATE TABLE IF NOT EXISTS party_plan_phases (
        id          SERIAL      PRIMARY KEY,
        key         TEXT        NOT NULL UNIQUE,
        label       TEXT,
        icon        TEXT,
        sort_order  INTEGER     NOT NULL DEFAULT 0,
        is_builtin  BOOLEAN     NOT NULL DEFAULT FALSE,
        created_by  TEXT        REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `INSERT INTO party_plan_phases (key, label, icon, sort_order, is_builtin)
       VALUES ('pickup',   NULL, '🚗', 1, TRUE),
              ('setup',    NULL, '🔨', 2, TRUE),
              ('during',   NULL, '🎉', 3, TRUE),
              ('teardown', NULL, '🧹', 4, TRUE),
              ('other',    NULL, '📦', 5, TRUE)
       ON CONFLICT (key) DO NOTHING`,
      `CREATE INDEX IF NOT EXISTS idx_party_plan_phases_sort
         ON party_plan_phases (sort_order, id)`,
      `CREATE TABLE IF NOT EXISTS party_plan_tasks (
        id             SERIAL      PRIMARY KEY,
        title          TEXT        NOT NULL,
        notes          TEXT,
        done           BOOLEAN     NOT NULL DEFAULT FALSE,
        phase          TEXT        NOT NULL DEFAULT 'other'
                                   REFERENCES party_plan_phases(key)
                                   ON UPDATE CASCADE ON DELETE SET DEFAULT,
        time_minutes   INTEGER     CHECK (time_minutes IS NULL OR time_minutes >= 0),
        people_needed  INTEGER     CHECK (people_needed IS NULL OR people_needed >= 0),
        assignees      JSONB       NOT NULL DEFAULT '[]'::jsonb,
        linked_todo_id INTEGER     REFERENCES party_todos(id) ON DELETE SET NULL,
        sort_order     INTEGER     NOT NULL DEFAULT 0,
        created_by     TEXT        REFERENCES users(id) ON DELETE SET NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_party_plan_tasks_sort
         ON party_plan_tasks (phase, sort_order, id)`,
      `CREATE INDEX IF NOT EXISTS idx_party_plan_tasks_linked
         ON party_plan_tasks (linked_todo_id)`,
    ],
  },
  {
    // Photo album: turns party_photos from an images-only side table into the
    // backing store for the guest-facing album, where guests dump whole camera
    // rolls — photos and videos, originals kept at full quality.
    //
    // thumb_path exists because we keep originals and have no server-side image
    // processing (no sharp anywhere in this project). The browser generates the
    // thumbnail — a canvas downscale for photos, a captured poster frame for
    // videos — and uploads it alongside the original, so the grid never pulls
    // full-res files down a phone connection. It is NULLABLE on purpose: a
    // browser that cannot decode the file (HEVC video, say) still gets to
    // upload it, it just lands without a thumbnail. Losing the thumbnail must
    // never cost us the original.
    //
    // media_type mirrors project_media's image/video CHECK rather than sniffing
    // the extension at render time, so the frontend knows to render a <video>
    // and a play badge without parsing file_path.
    name: '070_party_photo_album',
    statements: [
      `ALTER TABLE party_photos
         ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image'`,
      `ALTER TABLE party_photos
         ADD COLUMN IF NOT EXISTS thumb_path TEXT`,
      // Named constraint added separately so re-running the migration is a
      // no-op; ADD CONSTRAINT has no IF NOT EXISTS in PostgreSQL 16.
      `DO $$ BEGIN
         ALTER TABLE party_photos
           ADD CONSTRAINT party_photos_media_type_check
           CHECK (media_type IN ('image', 'video'));
       EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      // (created_at DESC, id DESC) matches the default "newest first" ordering
      // exactly, so paging through a few hundred rows stays an index scan.
      `CREATE INDEX IF NOT EXISTS idx_party_photos_created
         ON party_photos (created_at DESC, id DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_party_photos_user
         ON party_photos (user_id)`,
    ],
  },
  {
    // The album is fully public by owner decision (2026-07-26): anyone who can
    // reach /party can view and upload without an account, so uploads may have
    // no owner — user_id becomes nullable. NULL means "anonymous visitor";
    // such photos can only be deleted by admin/moderator, since there is no
    // owner to claim them. The FK and its ON DELETE CASCADE are unchanged for
    // rows that DO have an owner.
    name: '071_party_photos_public',
    statements: [
      `ALTER TABLE party_photos ALTER COLUMN user_id DROP NOT NULL`,
    ],
  },
  {
    // Bókhald — the real books, not a preview. The design is driven by Icelandic
    // law rather than by convenience, because the statutory rules map almost 1:1
    // onto schema decisions:
    //
    //   Reglugerð 505/2013 gr. 8 — every entry must record WHO posted it, WHEN,
    //     and WHICH source document it rests on  -> created_by / posted_at /
    //     source_type+source_id are NOT NULL on the ledger.
    //   Reglugerð 505/2013 gr. 9 — once posted, an entry may never be altered or
    //     deleted; corrections are separate offsetting entries  -> the
    //     books_forbid_posted_* triggers below make that a database guarantee,
    //     not a code convention. Drafts (posted_at IS NULL) stay editable.
    //   Reglugerð 505/2013 gr. 16 / Reglugerð 50/1993 — organised, gapless number
    //     series per document type  -> bookkeeping_counters, allocated under a row
    //     lock at ISSUE time (a Postgres SEQUENCE leaks gaps on rollback).
    //   Bókhaldslög 145/1994 gr. 10a — books are kept in ISK  -> every money
    //     column is BIGINT ISK; foreign-currency documents are translated at the
    //     transaction-date rate and keep their original amount for audit.
    //
    // Money is BIGINT, not INTEGER: ISK has no subunit, so an INTEGER column tops
    // out around 2.1 billion ISK — reachable by a cumulative balance or a
    // year-end aggregate, and the failure mode is a 22003 mid-transaction.
    name: '072_bookkeeping',
    statements: [
      // ---------------------------------------------------------------- accounts
      // The chart of accounts is DATA, not constants in code, so it can be
      // corrected without a deploy. `input_vat_blocked` encodes the statutory
      // exclusions from input-VAT deduction (Skatturinn: risna/entertainment,
      // staff meals, passenger vehicles under 5,000 kg, holiday property) so the
      // UI can warn before a non-deductible claim is made rather than after.
      `CREATE TABLE IF NOT EXISTS ledger_accounts (
        id                 TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        code               TEXT        NOT NULL UNIQUE,
        name               TEXT        NOT NULL,
        name_en            TEXT        NOT NULL,
        type               TEXT        NOT NULL
                                       CHECK (type IN ('asset','liability','equity','revenue','expense')),
        vat_code           TEXT        NOT NULL DEFAULT 'none'
                                       CHECK (vat_code IN ('none','output_24','output_11','output_0','input_24','input_11','exempt')),
        input_vat_blocked  BOOLEAN     NOT NULL DEFAULT FALSE,
        description        TEXT        NOT NULL DEFAULT '',
        is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
        sort               INTEGER     NOT NULL DEFAULT 0,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ledger_accounts_type ON ledger_accounts (type, sort)`,
      `DROP TRIGGER IF EXISTS trg_ledger_accounts_updated_at ON ledger_accounts`,
      `CREATE TRIGGER trg_ledger_accounts_updated_at
         BEFORE UPDATE ON ledger_accounts
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,

      // ---------------------------------------------------------------- counters
      // One row per document series. Consumed with SELECT ... FOR UPDATE inside
      // the transaction that creates the document, so a rollback returns the
      // number and the series stays gapless (gr. 16). Receipts are a SEPARATE
      // series from sales invoices, as Reglugerð 50/1993 requires.
      `CREATE TABLE IF NOT EXISTS bookkeeping_counters (
        name        TEXT        PRIMARY KEY,
        next_value  BIGINT      NOT NULL CHECK (next_value > 0),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      // ------------------------------------------------------------ fiscal period
      // A period is the VSK settlement window ('2026-P1' = Jan+Feb). Filing a VAT
      // return locks its period; the books_assert_period_open trigger then refuses
      // any further posting dated inside it, so a number already reported to
      // Skatturinn cannot silently change afterwards. Late items post into the
      // open period as an explicit prior-period correction.
      `CREATE TABLE IF NOT EXISTS fiscal_periods (
        period      TEXT        PRIMARY KEY,
        starts_on   DATE        NOT NULL,
        ends_on     DATE        NOT NULL,
        status      TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked')),
        locked_at   TIMESTAMPTZ,
        locked_by   TEXT        REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fiscal_periods_range CHECK (ends_on >= starts_on),
        CONSTRAINT fiscal_periods_locked_meta
          CHECK ((status = 'locked') = (locked_at IS NOT NULL))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_fiscal_periods_range ON fiscal_periods (starts_on, ends_on)`,

      // ---------------------------------------------------------------- fx rates
      // Bókhaldslög gr. 10a: the books are in ISK. A EUR document is translated at
      // the rate of its own transaction date — never at "today's" rate — so the
      // rate is stored per date with its provenance and can be audited later.
      `CREATE TABLE IF NOT EXISTS fx_rates (
        id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        rate_date   DATE        NOT NULL,
        currency    TEXT        NOT NULL CHECK (currency IN ('EUR','USD','GBP','DKK')),
        rate        NUMERIC(14,6) NOT NULL CHECK (rate > 0),
        source      TEXT        NOT NULL CHECK (source IN ('cbi','manual')),
        created_by  TEXT        REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (rate_date, currency)
      )`,

      // -------------------------------------------------------------- fylgiskjöl
      // Supporting documents. "No fylgiskjal, no deduction" is the operative rule,
      // so entries link here and the dashboard surfaces a missing-document queue.
      // checksum_sha256 is the gr. 14 áreiðanleiki (reliability) evidence: proof
      // the stored file has not been altered since it was filed.
      `CREATE TABLE IF NOT EXISTS books_documents (
        id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        kind             TEXT        NOT NULL DEFAULT 'receipt'
                                     CHECK (kind IN ('receipt','supplier_invoice','bank_statement','contract','other')),
        original_name    TEXT        NOT NULL,
        file_path        TEXT        NOT NULL,
        mime_type        TEXT        NOT NULL,
        byte_size        BIGINT      NOT NULL CHECK (byte_size > 0),
        checksum_sha256  TEXT        NOT NULL,
        note             TEXT        NOT NULL DEFAULT '',
        created_by       TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_books_documents_created ON books_documents (created_at DESC)`,

      // ----------------------------------------------------------------- invoices
      // The seller block is SNAPSHOTTED onto every invoice. It would be tempting to
      // render it from settings at PDF time, but then editing a setting silently
      // reprints every historical invoice with different statutory content — an
      // audit-trail break disguised as a formatting change.
      //
      // status holds only real state transitions. 'paid' and 'overdue' are DERIVED
      // at read time from amount_paid and due_at, so they cannot drift out of sync.
      `CREATE TABLE IF NOT EXISTS invoices (
        id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        series                TEXT        NOT NULL DEFAULT 'invoice'
                                          CHECK (series IN ('invoice','receipt')),
        invoice_number        BIGINT      NOT NULL CHECK (invoice_number > 0),
        order_id              TEXT        REFERENCES orders(id) ON DELETE RESTRICT,
        user_id               TEXT        REFERENCES users(id) ON DELETE SET NULL,
        seller_name           TEXT        NOT NULL,
        seller_kennitala      TEXT        NOT NULL,
        seller_vat_number     TEXT        NOT NULL,
        seller_address        TEXT        NOT NULL DEFAULT '',
        customer_name         TEXT        NOT NULL,
        customer_kennitala    TEXT,
        customer_email        TEXT,
        customer_address      TEXT        NOT NULL DEFAULT '',
        customer_country      TEXT        NOT NULL DEFAULT 'IS',
        issued_at             TIMESTAMPTZ NOT NULL,
        due_at                TIMESTAMPTZ NOT NULL,
        terms_days            INTEGER     NOT NULL DEFAULT 14 CHECK (terms_days >= 0),
        currency              TEXT        NOT NULL DEFAULT 'ISK' CHECK (currency = 'ISK'),
        original_currency     TEXT        NOT NULL DEFAULT 'ISK'
                                          CHECK (original_currency IN ('ISK','EUR')),
        original_total_gross  BIGINT      CHECK (original_total_gross IS NULL OR original_total_gross >= 0),
        fx_rate               NUMERIC(14,6) NOT NULL DEFAULT 1 CHECK (fx_rate > 0),
        subtotal_net          BIGINT      NOT NULL CHECK (subtotal_net >= 0),
        vat_total             BIGINT      NOT NULL CHECK (vat_total >= 0),
        total_gross           BIGINT      NOT NULL CHECK (total_gross >= 0),
        discount_total        BIGINT      NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
        shipping_gross        BIGINT      NOT NULL DEFAULT 0 CHECK (shipping_gross >= 0),
        amount_paid           BIGINT      NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
        amount_credited       BIGINT      NOT NULL DEFAULT 0 CHECK (amount_credited >= 0),
        -- Money returned to the customer. A refund is TWO separate facts and needs
        -- two counters: the credit note reverses the SALE (amount_credited), and
        -- the disbursement records the CASH leaving (amount_refunded). Collapsing
        -- them makes a paid-then-refunded invoice unrepresentable.
        amount_refunded       BIGINT      NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),
        zero_rate_reason      TEXT,
        note                  TEXT        NOT NULL DEFAULT '',
        status                TEXT        NOT NULL DEFAULT 'issued'
                                          CHECK (status IN ('draft','issued','credited','cancelled')),
        created_by            TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT invoices_totals_consistent
          CHECK (subtotal_net + vat_total = total_gross),
        -- Each counter is bounded by its own meaning rather than by a combined sum.
        -- The obvious-looking "paid + credited <= total" is
        -- WRONG: a fully paid invoice that is then fully refunded legitimately has
        -- both at the full amount, and that constraint made the entire refund flow
        -- impossible (the credit note wrote its rows, then the invoice UPDATE
        -- violated the CHECK and rolled the whole transaction back).
        CONSTRAINT invoices_paid_within_total    CHECK (amount_paid <= total_gross),
        CONSTRAINT invoices_credited_within_total CHECK (amount_credited <= total_gross),
        CONSTRAINT invoices_refund_within_paid   CHECK (amount_refunded <= amount_paid),
        CONSTRAINT invoices_fx_audit
          CHECK ((original_currency = 'ISK') = (original_total_gross IS NULL)),
        CONSTRAINT invoices_due_after_issue CHECK (due_at >= issued_at)
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_invoices_series_number
         ON invoices (series, invoice_number)`,
      // One invoice per order is the idempotency key the backfill and the Stripe
      // webhook both rely on; a 23505 here is a benign "already invoiced" race.
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_invoices_order_id
         ON invoices (order_id) WHERE order_id IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_invoices_issued_at ON invoices (issued_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_invoices_customer_email ON invoices (customer_email)`,
      `CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices (user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_invoices_open
         ON invoices (due_at) WHERE status = 'issued'`,
      `DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices`,
      `CREATE TRIGGER trg_invoices_updated_at
         BEFORE UPDATE ON invoices
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,

      // VAT is per LINE, at the line's own snapshotted rate. The source system
      // this replaces posted one aggregate VAT leg, which makes a per-rate VSK
      // return impossible to reproduce from the ledger — the exact figure
      // Skatturinn asks for in boxes A/B/D of RSK 10.01.
      `CREATE TABLE IF NOT EXISTS invoice_lines (
        id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        invoice_id        TEXT        NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
        product_id        TEXT        REFERENCES products(id) ON DELETE SET NULL,
        sku               TEXT,
        description       TEXT        NOT NULL,
        quantity          NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
        unit_price_gross  BIGINT      NOT NULL CHECK (unit_price_gross >= 0),
        vat_rate          SMALLINT    NOT NULL DEFAULT 24 CHECK (vat_rate IN (0,11,24)),
        -- An order-level discount is ALLOCATED across the lines it applies to, but
        -- the allocated amount is kept visible rather than quietly folded into
        -- unit_price_gross. Reglugerð 50/1993 requires the invoice to state
        -- quantity and unit price, and a customer who was shown 9.900 kr. must not
        -- receive a document claiming the item cost 8.910 kr.
        gross_before_discount BIGINT  NOT NULL CHECK (gross_before_discount >= 0),
        discount_gross    BIGINT      NOT NULL DEFAULT 0 CHECK (discount_gross >= 0),
        line_net          BIGINT      NOT NULL CHECK (line_net >= 0),
        line_vat          BIGINT      NOT NULL CHECK (line_vat >= 0),
        line_gross        BIGINT      NOT NULL CHECK (line_gross >= 0),
        revenue_account   TEXT        NOT NULL,
        sort_order        INTEGER     NOT NULL DEFAULT 0,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT invoice_lines_totals_consistent
          CHECK (line_net + line_vat = line_gross),
        CONSTRAINT invoice_lines_discount_consistent
          CHECK (gross_before_discount - discount_gross = line_gross),
        CONSTRAINT invoice_lines_zero_rate_has_no_vat
          CHECK (vat_rate <> 0 OR line_vat = 0)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines (invoice_id, sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_invoice_lines_vat_rate ON invoice_lines (invoice_id, vat_rate)`,

      // idempotency_key is supplied by the caller and UNIQUE, so a retried request
      // is a no-op instead of a second payment. The system this replaces deduped on
      // a caller-supplied timestamp window, which silently swallowed genuine second
      // payments of the same amount — money received and never booked.
      `CREATE TABLE IF NOT EXISTS payments (
        id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        invoice_id       TEXT        NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
        -- 'in'  = money received from the customer
        -- 'out' = money returned to them (a refund disbursement)
        -- One settlement ledger with a direction, rather than a second table:
        -- both sides share the same idempotency, immutability and audit machinery,
        -- and the amount stays positive so the CHECK still means what it says.
        direction        TEXT        NOT NULL DEFAULT 'in' CHECK (direction IN ('in','out')),
        amount           BIGINT      NOT NULL CHECK (amount > 0),
        method           TEXT        NOT NULL
                                     CHECK (method IN ('bank_transfer','cash','card','stripe','other')),
        received_at      TIMESTAMPTZ NOT NULL,
        reference        TEXT        NOT NULL DEFAULT '',
        idempotency_key  TEXT        NOT NULL,
        created_by       TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      // Scoped to the invoice, not global. A globally unique key meant that a
      // caller reusing a key across invoices (a bank-import batch, a bulk
      // settlement) silently matched the FIRST invoice's payment and returned a
      // cheerful 200 for money that was never booked against the second.
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_payments_invoice_idempotency
         ON payments (invoice_id, idempotency_key)`,
      `CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments (invoice_id, received_at)`,

      // A credit note is the ONLY way to undo an issued invoice — never a delete,
      // never an edit (gr. 9). stripe_refund_id makes the refund webhook idempotent.
      `CREATE TABLE IF NOT EXISTS credit_notes (
        id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        credit_note_number  BIGINT      NOT NULL UNIQUE CHECK (credit_note_number > 0),
        invoice_id          TEXT        NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
        amount_net          BIGINT      NOT NULL CHECK (amount_net >= 0),
        amount_vat          BIGINT      NOT NULL CHECK (amount_vat >= 0),
        amount_gross        BIGINT      NOT NULL CHECK (amount_gross > 0),
        reason              TEXT        NOT NULL,
        issued_at           TIMESTAMPTZ NOT NULL,
        stripe_refund_id    TEXT        UNIQUE,
        created_by          TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT credit_notes_totals_consistent
          CHECK (amount_net + amount_vat = amount_gross)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON credit_notes (invoice_id)`,

      // ------------------------------------------------------------------ ledger
      // source_type/source_id say WHICH document an entry rests on (gr. 8).
      // reverses_entry_id is the cross-reference gr. 9 requires when correcting.
      `CREATE TABLE IF NOT EXISTS journal_entries (
        id                 TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        entry_number       BIGINT      UNIQUE CHECK (entry_number > 0),
        entry_date         DATE        NOT NULL,
        memo               TEXT        NOT NULL,
        source_type        TEXT        NOT NULL
                                       CHECK (source_type IN ('invoice','payment','credit_note','expense',
                                                              'payroll','vat_settlement','opening','manual',
                                                              'reversal','stripe','bank')),
        source_id          TEXT,
        document_id        TEXT        REFERENCES books_documents(id) ON DELETE SET NULL,
        reverses_entry_id  TEXT        REFERENCES journal_entries(id) ON DELETE RESTRICT,
        is_correction      BOOLEAN     NOT NULL DEFAULT FALSE,
        posted_at          TIMESTAMPTZ,
        created_by         TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT journal_entries_posted_has_number
          CHECK ((posted_at IS NULL) = (entry_number IS NULL))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries (entry_date, id)`,
      `CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON journal_entries (source_type, source_id)`,
      `CREATE INDEX IF NOT EXISTS idx_journal_entries_posted
         ON journal_entries (entry_date) WHERE posted_at IS NOT NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_journal_reversal
         ON journal_entries (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL`,

      `CREATE TABLE IF NOT EXISTS journal_lines (
        id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        entry_id    TEXT        NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
        account_id  TEXT        NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
        debit       BIGINT      NOT NULL DEFAULT 0 CHECK (debit >= 0),
        credit      BIGINT      NOT NULL DEFAULT 0 CHECK (credit >= 0),
        memo        TEXT        NOT NULL DEFAULT '',
        vat_rate    SMALLINT    CHECK (vat_rate IS NULL OR vat_rate IN (0,11,24)),
        sort_order  INTEGER     NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT journal_lines_one_side CHECK ((debit = 0) <> (credit = 0))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines (entry_id, sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines (account_id)`,

      // ----------------------------------------------------------------- expenses
      // vat_code 'reverse_charge_24' is the Icelandic self-assessment case: buying
      // services from abroad (Azure, GitHub, Sentry...) for use in Iceland obliges
      // the buyer to charge themselves VSK once the total reaches 10,000 ISK in a
      // two-month period. It nets to zero when the activity is taxable, but it must
      // still appear on the return, so it is modelled explicitly rather than skipped.
      `CREATE TABLE IF NOT EXISTS expenses (
        id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        supplier_name         TEXT        NOT NULL,
        supplier_kennitala    TEXT,
        supplier_country      TEXT        NOT NULL DEFAULT 'IS',
        supplier_invoice_no   TEXT,
        expense_date          DATE        NOT NULL,
        description           TEXT        NOT NULL DEFAULT '',
        amount_net            BIGINT      NOT NULL CHECK (amount_net >= 0),
        amount_vat            BIGINT      NOT NULL CHECK (amount_vat >= 0),
        amount_gross          BIGINT      NOT NULL CHECK (amount_gross > 0),
        vat_code              TEXT        NOT NULL DEFAULT 'input_24'
                                          CHECK (vat_code IN ('input_24','input_11','exempt','none','reverse_charge_24')),
        vat_deductible        BOOLEAN     NOT NULL DEFAULT TRUE,
        non_deductible_reason TEXT,
        account_id            TEXT        NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
        document_id           TEXT        REFERENCES books_documents(id) ON DELETE SET NULL,
        original_currency     TEXT        NOT NULL DEFAULT 'ISK',
        original_amount_gross BIGINT,
        fx_rate               NUMERIC(14,6) NOT NULL DEFAULT 1 CHECK (fx_rate > 0),
        created_by            TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT expenses_totals_consistent
          CHECK (amount_net + amount_vat = amount_gross),
        CONSTRAINT expenses_non_deductible_has_reason
          CHECK (vat_deductible OR non_deductible_reason IS NOT NULL)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (expense_date DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_expenses_missing_document
         ON expenses (expense_date) WHERE document_id IS NULL`,
      // Not UNIQUE on purpose: a repeated supplier invoice number is a strong
      // duplicate signal that the UI should raise, but legitimately repeats across
      // suppliers and after a supplier renumbers. Detection warns; it never blocks.
      `CREATE INDEX IF NOT EXISTS idx_expenses_duplicate_probe
         ON expenses (supplier_kennitala, supplier_invoice_no)`,
      `DROP TRIGGER IF EXISTS trg_expenses_updated_at ON expenses`,
      `CREATE TRIGGER trg_expenses_updated_at
         BEFORE UPDATE ON expenses
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,

      // -------------------------------------------------------------- VAT returns
      // A filed return is an immutable SNAPSHOT of the six RSK 10.01 boxes. The
      // annual RSK 10.25 reconciliation compares the books against what was
      // actually filed, which is impossible if the return is recomputed live.
      `CREATE TABLE IF NOT EXISTS vat_returns (
        id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        period          TEXT        NOT NULL UNIQUE REFERENCES fiscal_periods(period) ON DELETE RESTRICT,
        box_a_net_24    BIGINT      NOT NULL,
        box_b_net_11    BIGINT      NOT NULL,
        box_c_net_zero  BIGINT      NOT NULL,
        box_d_output    BIGINT      NOT NULL,
        box_e_input     BIGINT      NOT NULL,
        box_f_payable   BIGINT      NOT NULL,
        detail          JSONB       NOT NULL DEFAULT '{}'::jsonb,
        preflight       JSONB       NOT NULL DEFAULT '{}'::jsonb,
        filed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        filed_by        TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        note            TEXT        NOT NULL DEFAULT '',
        CONSTRAINT vat_returns_net_consistent
          CHECK (box_f_payable = box_d_output - box_e_input)
      )`,

      // ------------------------------------------- Stripe / bank reconciliation
      // Stripe is mirrored at BALANCE-TRANSACTION granularity so a payout can be
      // decomposed into gross charges, fees and refunds. Booking a net payout as
      // revenue understates both turnover and output VAT — which bókhaldslög gr. 37
      // treats as under-reporting of revenue, so the schema keeps the parts apart.
      `CREATE TABLE IF NOT EXISTS stripe_transactions (
        id                 TEXT        PRIMARY KEY,
        type               TEXT        NOT NULL,
        currency           TEXT        NOT NULL,
        amount_minor       BIGINT      NOT NULL,
        fee_minor          BIGINT      NOT NULL DEFAULT 0,
        net_minor          BIGINT      NOT NULL,
        available_on       DATE,
        created_on         TIMESTAMPTZ NOT NULL,
        payout_id          TEXT,
        charge_id          TEXT,
        payment_intent_id  TEXT,
        refund_id          TEXT,
        order_id           TEXT        REFERENCES orders(id) ON DELETE SET NULL,
        raw                JSONB       NOT NULL DEFAULT '{}'::jsonb,
        journal_entry_id   TEXT        REFERENCES journal_entries(id) ON DELETE SET NULL,
        synced_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_stripe_transactions_payout ON stripe_transactions (payout_id)`,
      `CREATE INDEX IF NOT EXISTS idx_stripe_transactions_created ON stripe_transactions (created_on DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_stripe_transactions_unposted
         ON stripe_transactions (created_on) WHERE journal_entry_id IS NULL`,

      // The count of unmatched bank lines is the single best health metric for a
      // small set of books, so match state is first-class rather than derived.
      `CREATE TABLE IF NOT EXISTS bank_transactions (
        id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        account_code      TEXT        NOT NULL,
        booked_on         DATE        NOT NULL,
        value_on          DATE,
        description       TEXT        NOT NULL,
        counterparty      TEXT,
        reference         TEXT,
        amount            BIGINT      NOT NULL,
        balance_after     BIGINT,
        import_batch      TEXT        NOT NULL,
        dedupe_hash       TEXT        NOT NULL UNIQUE,
        match_state       TEXT        NOT NULL DEFAULT 'unmatched'
                                      CHECK (match_state IN ('unmatched','matched','explained','ignored')),
        matched_entry_id  TEXT        REFERENCES journal_entries(id) ON DELETE SET NULL,
        matched_payment_id TEXT       REFERENCES payments(id) ON DELETE SET NULL,
        note              TEXT        NOT NULL DEFAULT '',
        created_by        TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_bank_transactions_booked ON bank_transactions (booked_on DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_bank_transactions_unmatched
         ON bank_transactions (booked_on) WHERE match_state = 'unmatched'`,
      `DROP TRIGGER IF EXISTS trg_bank_transactions_updated_at ON bank_transactions`,
      `CREATE TRIGGER trg_bank_transactions_updated_at
         BEFORE UPDATE ON bank_transactions
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,

      // ------------------------------------------------------------------ payroll
      // Every statutory rate is EFFECTIVE-DATED DATA, never a constant in code.
      // Iceland re-sets the tax bands, persónuafsláttur, tryggingagjald and pension
      // percentages each January; a hardcoded rate is a guaranteed annual bug.
      // `confirmed_by`/`confirmed_at` record that a human checked the year's figures
      // against Skatturinn — payroll refuses to run an unconfirmed year.
      `CREATE TABLE IF NOT EXISTS payroll_rates (
        id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tax_year            SMALLINT    NOT NULL UNIQUE CHECK (tax_year BETWEEN 2020 AND 2100),
        bands               JSONB       NOT NULL,
        personal_allowance  BIGINT      NOT NULL CHECK (personal_allowance >= 0),
        municipal_rate      NUMERIC(6,4) NOT NULL CHECK (municipal_rate >= 0),
        social_security     NUMERIC(6,4) NOT NULL CHECK (social_security >= 0),
        pension_employee    NUMERIC(6,4) NOT NULL CHECK (pension_employee >= 0),
        pension_employer    NUMERIC(6,4) NOT NULL CHECK (pension_employer >= 0),
        source_note         TEXT        NOT NULL DEFAULT '',
        confirmed_at        TIMESTAMPTZ,
        confirmed_by        TEXT        REFERENCES users(id) ON DELETE SET NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `DROP TRIGGER IF EXISTS trg_payroll_rates_updated_at ON payroll_rates`,
      `CREATE TRIGGER trg_payroll_rates_updated_at
         BEFORE UPDATE ON payroll_rates
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,

      // reference_wage_category is the reiknað endurgjald class (RSK). Getting it
      // wrong is the single largest tax exposure for an owner-operator, so the class
      // and the date it was confirmed with an adviser are stored on the employee.
      `CREATE TABLE IF NOT EXISTS employees (
        id                       TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id                  TEXT        REFERENCES users(id) ON DELETE SET NULL,
        full_name                TEXT        NOT NULL,
        kennitala                TEXT        NOT NULL UNIQUE,
        email                    TEXT,
        bank_account             TEXT,
        pension_fund             TEXT        NOT NULL DEFAULT '',
        union_name               TEXT,
        union_rate               NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (union_rate >= 0),
        extra_pension_employee   NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (extra_pension_employee >= 0),
        extra_pension_employer   NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (extra_pension_employer >= 0),
        allowance_factor         NUMERIC(5,4) NOT NULL DEFAULT 1 CHECK (allowance_factor BETWEEN 0 AND 1),
        monthly_salary           BIGINT      NOT NULL DEFAULT 0 CHECK (monthly_salary >= 0),
        reference_wage_category  TEXT,
        reference_wage_amount    BIGINT      CHECK (reference_wage_amount IS NULL OR reference_wage_amount >= 0),
        reference_wage_confirmed_at DATE,
        reference_wage_confirmed_note TEXT,
        is_active                BOOLEAN     NOT NULL DEFAULT TRUE,
        created_by               TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `DROP TRIGGER IF EXISTS trg_employees_updated_at ON employees`,
      `CREATE TRIGGER trg_employees_updated_at
         BEFORE UPDATE ON employees
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,

      `CREATE TABLE IF NOT EXISTS payroll_runs (
        id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        period            TEXT        NOT NULL UNIQUE CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
        pay_date          DATE        NOT NULL,
        tax_year          SMALLINT    NOT NULL,
        gross_total       BIGINT      NOT NULL CHECK (gross_total >= 0),
        withholding_total BIGINT      NOT NULL CHECK (withholding_total >= 0),
        pension_employee_total BIGINT NOT NULL CHECK (pension_employee_total >= 0),
        pension_employer_total BIGINT NOT NULL CHECK (pension_employer_total >= 0),
        social_security_total  BIGINT NOT NULL CHECK (social_security_total >= 0),
        union_total       BIGINT      NOT NULL DEFAULT 0 CHECK (union_total >= 0),
        net_total         BIGINT      NOT NULL CHECK (net_total >= 0),
        status            TEXT        NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','settled')),
        created_by        TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS payslips (
        id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        run_id            TEXT        NOT NULL REFERENCES payroll_runs(id) ON DELETE RESTRICT,
        employee_id       TEXT        NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
        gross             BIGINT      NOT NULL CHECK (gross >= 0),
        pension_employee  BIGINT      NOT NULL CHECK (pension_employee >= 0),
        taxable_base      BIGINT      NOT NULL CHECK (taxable_base >= 0),
        computed_tax      BIGINT      NOT NULL CHECK (computed_tax >= 0),
        allowance_used    BIGINT      NOT NULL CHECK (allowance_used >= 0),
        withholding       BIGINT      NOT NULL CHECK (withholding >= 0),
        union_dues        BIGINT      NOT NULL DEFAULT 0 CHECK (union_dues >= 0),
        extra_pension_employee BIGINT NOT NULL DEFAULT 0 CHECK (extra_pension_employee >= 0),
        net_pay           BIGINT      NOT NULL CHECK (net_pay >= 0),
        pension_employer  BIGINT      NOT NULL CHECK (pension_employer >= 0),
        extra_pension_employer BIGINT NOT NULL DEFAULT 0 CHECK (extra_pension_employer >= 0),
        social_security   BIGINT      NOT NULL CHECK (social_security >= 0),
        breakdown         JSONB       NOT NULL DEFAULT '{}'::jsonb,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (run_id, employee_id)
      )`,

      // -------------------------------------------------------------- audit trail
      // Append-only record of every mutation, written in the SAME transaction as
      // the change it describes. Reglugerð 505/2013 gr. 8 requires an identifiable
      // person behind every entry; this is where "who did what" is answerable.
      `CREATE TABLE IF NOT EXISTS books_audit_log (
        id           BIGSERIAL   PRIMARY KEY,
        actor_id     TEXT        REFERENCES users(id) ON DELETE SET NULL,
        action       TEXT        NOT NULL,
        entity_type  TEXT        NOT NULL,
        entity_id    TEXT,
        summary      JSONB       NOT NULL DEFAULT '{}'::jsonb,
        request_id   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_books_audit_entity
         ON books_audit_log (entity_type, entity_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_books_audit_created ON books_audit_log (created_at DESC)`,

      // ---------------------------------------------------------------- deadlines
      // Icelandic filing dates shift for weekends and holidays, so they are DATA
      // taken from Skatturinn's Skattadagatal rather than computed with date math.
      `CREATE TABLE IF NOT EXISTS tax_deadlines (
        id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        kind         TEXT        NOT NULL
                                 CHECK (kind IN ('vsk','payroll','annual_return','annual_accounts','rates_review','other')),
        period       TEXT,
        due_on       DATE        NOT NULL,
        label_is     TEXT        NOT NULL,
        label_en     TEXT        NOT NULL,
        note         TEXT        NOT NULL DEFAULT '',
        completed_at TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (kind, period, due_on)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_tax_deadlines_due
         ON tax_deadlines (due_on) WHERE completed_at IS NULL`,

      // =================================================================
      // Statutory enforcement triggers — the part that makes this a set of
      // books rather than a CRUD app over financial-looking tables.
      // =================================================================

      // Reglugerð 505/2013 gr. 9. Drafts (posted_at IS NULL) remain editable and
      // deletable; posting is a one-way door. Note this also blocks UN-posting,
      // since any UPDATE of a row whose OLD.posted_at is set is refused.
      `CREATE OR REPLACE FUNCTION books_forbid_posted_entry_mutation()
       RETURNS TRIGGER AS $$
       BEGIN
         IF TG_OP = 'DELETE' THEN
           IF OLD.posted_at IS NOT NULL THEN
             RAISE EXCEPTION 'Posted journal entry % cannot be deleted (Reglugerd 505/2013 gr. 9); post a reversing entry instead', OLD.id
               USING ERRCODE = 'restrict_violation';
           END IF;
           RETURN OLD;
         END IF;
         IF OLD.posted_at IS NOT NULL THEN
           RAISE EXCEPTION 'Posted journal entry % cannot be altered (Reglugerd 505/2013 gr. 9); post a reversing entry instead', OLD.id
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_journal_entries_append_only ON journal_entries`,
      `CREATE TRIGGER trg_journal_entries_append_only
         BEFORE UPDATE OR DELETE ON journal_entries
         FOR EACH ROW EXECUTE FUNCTION books_forbid_posted_entry_mutation()`,

      // Same rule for the lines, looked up through the parent. When a DRAFT entry
      // is deleted the FK cascade reaches here after the parent row is already
      // gone, so the lookup finds nothing and the delete is correctly allowed.
      //
      // BOTH parents are checked on UPDATE, not just OLD. Checking only the source
      // left a hole: moving a BALANCED PAIR of lines out of a draft and into a
      // posted entry passed this trigger (source is a draft) and passed the
      // deferred balance trigger (the target still balances), so the content of a
      // posted, numbered entry could be rewritten. Reparenting is refused outright
      // — a line belongs to the entry it was posted with.
      `CREATE OR REPLACE FUNCTION books_forbid_posted_line_mutation()
       RETURNS TRIGGER AS $$
       DECLARE v_posted TIMESTAMPTZ;
       BEGIN
         IF TG_OP = 'UPDATE' AND NEW.entry_id IS DISTINCT FROM OLD.entry_id THEN
           RAISE EXCEPTION 'A journal line cannot be moved between entries (Reglugerd 505/2013 gr. 9)'
             USING ERRCODE = 'restrict_violation';
         END IF;
         SELECT posted_at INTO v_posted FROM journal_entries
           WHERE id = OLD.entry_id;
         IF v_posted IS NOT NULL THEN
           RAISE EXCEPTION 'Lines of a posted journal entry cannot be altered or deleted (Reglugerd 505/2013 gr. 9)'
             USING ERRCODE = 'restrict_violation';
         END IF;
         IF TG_OP = 'UPDATE' THEN
           SELECT posted_at INTO v_posted FROM journal_entries WHERE id = NEW.entry_id;
           IF v_posted IS NOT NULL THEN
             RAISE EXCEPTION 'A journal line cannot be attached to a posted entry (Reglugerd 505/2013 gr. 9)'
               USING ERRCODE = 'restrict_violation';
           END IF;
           RETURN NEW;
         END IF;
         RETURN OLD;
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_journal_lines_append_only ON journal_lines`,
      `CREATE TRIGGER trg_journal_lines_append_only
         BEFORE UPDATE OR DELETE ON journal_lines
         FOR EACH ROW EXECUTE FUNCTION books_forbid_posted_line_mutation()`,

      // INSERT needs its own guard: without it, appending a balanced PAIR of lines
      // to an already-posted entry rewrites posted history and passes every other
      // check. This is why postEntry builds the entry as a draft, writes its lines,
      // and only then flips it to posted — by the time an entry carries posted_at,
      // its line set is final.
      `CREATE OR REPLACE FUNCTION books_forbid_line_insert_into_posted()
       RETURNS TRIGGER AS $$
       DECLARE v_posted TIMESTAMPTZ;
       BEGIN
         SELECT posted_at INTO v_posted FROM journal_entries WHERE id = NEW.entry_id;
         IF v_posted IS NOT NULL THEN
           RAISE EXCEPTION 'Lines cannot be added to a posted journal entry (Reglugerd 505/2013 gr. 9)'
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_journal_lines_no_insert_posted ON journal_lines`,
      `CREATE TRIGGER trg_journal_lines_no_insert_posted
         BEFORE INSERT ON journal_lines
         FOR EACH ROW EXECUTE FUNCTION books_forbid_line_insert_into_posted()`,

      // Double entry, enforced by the database. The application also checks this
      // before posting, but a CHECK cannot see sibling rows and any future writer
      // of journal_lines would otherwise be able to post an unbalanced entry.
      // DEFERRABLE INITIALLY DEFERRED so the check runs at COMMIT, after all the
      // lines of an entry exist.
      `CREATE OR REPLACE FUNCTION books_assert_entry_balanced()
       RETURNS TRIGGER AS $$
       DECLARE
         v_entry  TEXT;
         v_posted TIMESTAMPTZ;
         v_debit  BIGINT;
         v_credit BIGINT;
       BEGIN
         v_entry := COALESCE(NEW.entry_id, OLD.entry_id);
         SELECT posted_at INTO v_posted FROM journal_entries WHERE id = v_entry;
         -- No row: the draft was deleted in this transaction. Drafts may be
         -- unbalanced while they are being built; only posted entries must balance.
         IF v_posted IS NULL THEN RETURN NULL; END IF;
         SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
           INTO v_debit, v_credit FROM journal_lines WHERE entry_id = v_entry;
         IF v_debit <> v_credit THEN
           RAISE EXCEPTION 'Journal entry % is unbalanced: debit % <> credit %', v_entry, v_debit, v_credit
             USING ERRCODE = 'check_violation';
         END IF;
         RETURN NULL;
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_journal_lines_balanced ON journal_lines`,
      `CREATE CONSTRAINT TRIGGER trg_journal_lines_balanced
         AFTER INSERT OR UPDATE OR DELETE ON journal_lines
         DEFERRABLE INITIALLY DEFERRED
         FOR EACH ROW EXECUTE FUNCTION books_assert_entry_balanced()`,

      // The draft -> posted transition happens on journal_entries, so the balance
      // check has to fire there too or an unbalanced draft could be posted.
      `CREATE OR REPLACE FUNCTION books_assert_posted_entry_balanced()
       RETURNS TRIGGER AS $$
       DECLARE v_debit BIGINT; v_credit BIGINT;
       BEGIN
         IF NEW.posted_at IS NULL THEN RETURN NULL; END IF;
         SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
           INTO v_debit, v_credit FROM journal_lines WHERE entry_id = NEW.id;
         IF v_debit = 0 AND v_credit = 0 THEN
           RAISE EXCEPTION 'Journal entry % has no lines and cannot be posted', NEW.id
             USING ERRCODE = 'check_violation';
         END IF;
         IF v_debit <> v_credit THEN
           RAISE EXCEPTION 'Journal entry % is unbalanced: debit % <> credit %', NEW.id, v_debit, v_credit
             USING ERRCODE = 'check_violation';
         END IF;
         RETURN NULL;
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_journal_entries_balanced ON journal_entries`,
      `CREATE CONSTRAINT TRIGGER trg_journal_entries_balanced
         AFTER INSERT OR UPDATE ON journal_entries
         DEFERRABLE INITIALLY DEFERRED
         FOR EACH ROW EXECUTE FUNCTION books_assert_posted_entry_balanced()`,

      // A filed VSK period is closed. Without this, a figure already reported to
      // Skatturinn changes retroactively and the annual RSK 10.25 reconciliation
      // cannot be made to tie.
      `CREATE OR REPLACE FUNCTION books_assert_period_open()
       RETURNS TRIGGER AS $$
       BEGIN
         IF NEW.posted_at IS NULL THEN RETURN NEW; END IF;
         -- "Is ANY covering period locked", not "what is the status of the
         -- covering period". SELECT ... INTO takes the first row of however many
         -- match and discards the rest, so with two overlapping rows the lock
         -- check silently depended on which one Postgres happened to return —
         -- verified by probing it: the same posting was refused or allowed
         -- depending on row order. ensureFiscalPeriod only ever writes canonical
         -- non-overlapping VSK periods, so overlap should not arise, but a
         -- statutory control should not rest on that.
         IF EXISTS (SELECT 1 FROM fiscal_periods
                     WHERE NEW.entry_date BETWEEN starts_on AND ends_on
                       AND status = 'locked') THEN
           RAISE EXCEPTION 'Accounting period covering % is locked; post the correction into the open period instead', NEW.entry_date
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_journal_entries_period_open ON journal_entries`,
      `CREATE TRIGGER trg_journal_entries_period_open
         BEFORE INSERT OR UPDATE ON journal_entries
         FOR EACH ROW EXECUTE FUNCTION books_assert_period_open()`,

      // An ISSUED invoice is a primary accounting document (frumgagn) and falls
      // under the same gr. 9 rule as the ledger: no edits, no deletion, corrections
      // by credit note only. Without this, an invoice could be deleted by removing
      // its lines first (invoice_lines RESTRICT only blocks the reverse order),
      // leaving its journal entry orphaned — the ledger would still hold the truth
      // while the document it rests on had vanished, which breaks both the gr. 8
      // audit trail and the 7-year retention duty.
      //
      // Settlement columns stay writable, because recording a payment or a credit
      // note is not an alteration of the document's statutory content.
      `CREATE OR REPLACE FUNCTION books_protect_issued_invoice()
       RETURNS TRIGGER AS $$
       BEGIN
         IF TG_OP = 'DELETE' THEN
           IF OLD.status <> 'draft' THEN
             RAISE EXCEPTION 'Invoice % has been issued and cannot be deleted (Reglugerd 505/2013 gr. 9); issue a credit note instead', OLD.invoice_number
               USING ERRCODE = 'restrict_violation';
           END IF;
           RETURN OLD;
         END IF;
         IF OLD.status = 'draft' THEN
           -- The only way out of 'draft' is issuance. Anything else is a typo.
           IF NEW.status NOT IN ('draft', 'issued', 'cancelled') THEN
             RAISE EXCEPTION 'A draft invoice can only become issued or cancelled, not %', NEW.status
               USING ERRCODE = 'restrict_violation';
           END IF;
           RETURN NEW;
         END IF;
         -- Issued: status may only move FORWARD. Without a transition whitelist an
         -- invoice could be laundered back to 'draft', edited freely, and re-issued
         -- — three statements that defeat everything below.
         IF NEW.status NOT IN ('issued', 'credited', 'cancelled') THEN
           RAISE EXCEPTION 'Invoice % cannot return to %; it has been issued (Reglugerd 505/2013 gr. 9)', OLD.invoice_number, NEW.status
             USING ERRCODE = 'restrict_violation';
         END IF;
         -- Issued: only settlement and status may move.
         IF (NEW.series, NEW.invoice_number, NEW.order_id, NEW.user_id,
             NEW.seller_name, NEW.seller_kennitala, NEW.seller_vat_number, NEW.seller_address,
             NEW.customer_name, NEW.customer_kennitala, NEW.customer_email, NEW.customer_address,
             NEW.customer_country, NEW.issued_at, NEW.due_at, NEW.terms_days,
             NEW.currency, NEW.original_currency, NEW.original_total_gross, NEW.fx_rate,
             NEW.zero_rate_reason,
             NEW.subtotal_net, NEW.vat_total, NEW.total_gross, NEW.discount_total,
             NEW.shipping_gross, NEW.note, NEW.created_by)
            IS DISTINCT FROM
            (OLD.series, OLD.invoice_number, OLD.order_id, OLD.user_id,
             OLD.seller_name, OLD.seller_kennitala, OLD.seller_vat_number, OLD.seller_address,
             OLD.customer_name, OLD.customer_kennitala, OLD.customer_email, OLD.customer_address,
             OLD.customer_country, OLD.issued_at, OLD.due_at, OLD.terms_days,
             OLD.currency, OLD.original_currency, OLD.original_total_gross, OLD.fx_rate,
             OLD.zero_rate_reason,
             OLD.subtotal_net, OLD.vat_total, OLD.total_gross, OLD.discount_total,
             OLD.shipping_gross, OLD.note, OLD.created_by)
         THEN
           RAISE EXCEPTION 'Invoice % has been issued; its content cannot be altered (Reglugerd 505/2013 gr. 9). Only payment, credit and status may change.', OLD.invoice_number
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_invoices_issued_immutable ON invoices`,
      `CREATE TRIGGER trg_invoices_issued_immutable
         BEFORE UPDATE OR DELETE ON invoices
         FOR EACH ROW EXECUTE FUNCTION books_protect_issued_invoice()`,

      // Lines of an issued invoice are part of that document. Deleting them was the
      // route by which the invoice itself became deletable; reparenting them was the
      // route by which an issued invoice's rate mix could be rewritten underneath
      // issueCreditNote, which reads invoice_lines to split the VAT reversal. Both
      // parents are checked, and moving a line between invoices is refused outright.
      `CREATE OR REPLACE FUNCTION books_protect_issued_invoice_line()
       RETURNS TRIGGER AS $$
       DECLARE v_status TEXT; v_number BIGINT;
       BEGIN
         IF TG_OP = 'UPDATE' AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
           RAISE EXCEPTION 'An invoice line cannot be moved between invoices (Reglugerd 505/2013 gr. 9)'
             USING ERRCODE = 'restrict_violation';
         END IF;
         SELECT status, invoice_number INTO v_status, v_number FROM invoices
           WHERE id = OLD.invoice_id;
         -- No row: the parent draft is being deleted in this transaction.
         IF v_status IS NOT NULL AND v_status <> 'draft' THEN
           RAISE EXCEPTION 'Lines of issued invoice % cannot be altered or deleted (Reglugerd 505/2013 gr. 9)', v_number
             USING ERRCODE = 'restrict_violation';
         END IF;
         IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_invoice_lines_immutable ON invoice_lines`,
      `CREATE TRIGGER trg_invoice_lines_immutable
         BEFORE UPDATE OR DELETE ON invoice_lines
         FOR EACH ROW EXECUTE FUNCTION books_protect_issued_invoice_line()`,

      // Same reasoning as journal lines: an issued invoice's line set is final, so
      // new lines cannot be appended to it. invoiceService writes the invoice as a
      // draft, inserts its lines, then flips it to 'issued'.
      `CREATE OR REPLACE FUNCTION books_forbid_invoice_line_insert_into_issued()
       RETURNS TRIGGER AS $$
       DECLARE v_status TEXT; v_number BIGINT;
       BEGIN
         SELECT status, invoice_number INTO v_status, v_number FROM invoices
           WHERE id = NEW.invoice_id;
         IF v_status IS NOT NULL AND v_status <> 'draft' THEN
           RAISE EXCEPTION 'Lines cannot be added to issued invoice % (Reglugerd 505/2013 gr. 9)', v_number
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_invoice_lines_no_insert_issued ON invoice_lines`,
      `CREATE TRIGGER trg_invoice_lines_no_insert_issued
         BEFORE INSERT ON invoice_lines
         FOR EACH ROW EXECUTE FUNCTION books_forbid_invoice_line_insert_into_issued()`,

      // Filed returns and the audit log are write-once, full stop.
      `CREATE OR REPLACE FUNCTION books_forbid_any_mutation()
       RETURNS TRIGGER AS $$
       BEGIN
         RAISE EXCEPTION '% rows are append-only and cannot be altered or deleted', TG_TABLE_NAME
           USING ERRCODE = 'restrict_violation';
       END; $$ LANGUAGE plpgsql`,
      // A recorded payment and an issued credit note are themselves primary
      // documents. Correcting either means posting a reversal, never editing the
      // row — otherwise a payment could be quietly resized after the fact and the
      // ledger entry that documents it would no longer match.
      `DROP TRIGGER IF EXISTS trg_payments_immutable ON payments`,
      `CREATE TRIGGER trg_payments_immutable
         BEFORE UPDATE OR DELETE ON payments
         FOR EACH ROW EXECUTE FUNCTION books_forbid_any_mutation()`,
      `DROP TRIGGER IF EXISTS trg_credit_notes_immutable ON credit_notes`,
      `CREATE TRIGGER trg_credit_notes_immutable
         BEFORE UPDATE OR DELETE ON credit_notes
         FOR EACH ROW EXECUTE FUNCTION books_forbid_any_mutation()`,

      `DROP TRIGGER IF EXISTS trg_vat_returns_immutable ON vat_returns`,
      `CREATE TRIGGER trg_vat_returns_immutable
         BEFORE UPDATE OR DELETE ON vat_returns
         FOR EACH ROW EXECUTE FUNCTION books_forbid_any_mutation()`,
      `DROP TRIGGER IF EXISTS trg_books_audit_log_immutable ON books_audit_log`,
      `CREATE TRIGGER trg_books_audit_log_immutable
         BEFORE UPDATE OR DELETE ON books_audit_log
         FOR EACH ROW EXECUTE FUNCTION books_forbid_any_mutation()`,

      // =================================================================
      // Seeds. Idempotent so re-running the migration is a no-op, and
      // additive only — nothing here deletes or overwrites live data.
      // =================================================================

      // Chart of accounts. Flagged in docs/BOOKKEEPING-SYSTEM.md as requiring the
      // accountant's confirmation before the first real posting; the codes are a
      // conventional Icelandic small-company layout, not a standard mandated by law.
      // Note 1310 Innskattur is an ASSET (a receivable from the state). The system
      // this replaces typed it as a liability, which rendered input VAT as a
      // negative liability on the balance sheet.
      `INSERT INTO ledger_accounts (code, name, name_en, type, vat_code, input_vat_blocked, sort, description) VALUES
         ('1100','Viðskiptakröfur','Accounts receivable','asset','none',FALSE,100,'Safnreikningur útgefinna reikninga'),
         ('1200','Vörubirgðir','Inventory','asset','none',FALSE,110,''),
         ('1310','Innskattur','Input VAT','asset','none',FALSE,120,'Krafa á Skattinn — endurgreiðanlegur innskattur'),
         ('1400','Kortagreiðslur í vinnslu','Card settlement clearing','asset','none',FALSE,130,'Stripe-staða áður en útborgun berst í banka'),
         ('1900','Bankainnstæða','Bank account','asset','none',FALSE,140,''),
         ('1910','Sjóður','Cash on hand','asset','none',FALSE,150,'Reiðufé í posa/kassa'),
         ('1990','Óvissureikningur','Suspense','asset','none',FALSE,190,'Færslur sem bíða skýringar — á að vera 0 við uppgjör'),
         ('2100','Viðskiptaskuldir','Accounts payable','liability','none',FALSE,200,''),
         ('2200','Útskattur 24%','Output VAT 24%','liability','output_24',FALSE,210,''),
         ('2210','Útskattur 11%','Output VAT 11%','liability','output_11',FALSE,220,''),
         ('2290','Virðisaukaskattur til greiðslu','VAT settlement','liability','none',FALSE,230,'Uppgjörsreikningur VSK-skila'),
         ('2300','Staðgreiðsla launa','Withholding tax payable','liability','none',FALSE,240,''),
         ('2310','Tryggingagjald','Social security payable','liability','none',FALSE,250,''),
         ('2320','Lífeyrissjóður','Pension payable','liability','none',FALSE,260,''),
         ('2330','Séreignarsparnaður','Supplementary pension payable','liability','none',FALSE,270,''),
         ('2340','Félagsgjöld stéttarfélags','Union dues payable','liability','none',FALSE,280,''),
         ('2350','Ógreidd laun','Net wages payable','liability','none',FALSE,290,''),
         ('3100','Hlutafé','Share capital','equity','none',FALSE,300,''),
         ('3200','Óráðstafað eigið fé','Retained earnings','equity','none',FALSE,310,''),
         ('4100','Sala vöru 24%','Goods sales 24%','revenue','output_24',FALSE,400,''),
         ('4110','Sala þjónustu 24%','Service sales 24%','revenue','output_24',FALSE,410,'Smíði, uppsetning, hugbúnaðarvinna'),
         ('4200','Sala 11%','Sales 11%','revenue','output_11',FALSE,420,'Lækkað þrep — t.d. bækur'),
         ('4300','Sala til útlanda (0%)','Export sales (0%)','revenue','output_0',FALSE,430,'Núllskattlagt — krefst útflutningsgagna'),
         ('4900','Afslættir veittir','Discounts given','revenue','output_24',FALSE,490,''),
         ('5100','Kostnaðarverð sölu','Cost of goods sold','expense','none',FALSE,500,''),
         ('5200','Efni og aðföng','Materials and supplies','expense','input_24',FALSE,510,''),
         ('6100','Laun','Wages','expense','none',FALSE,600,''),
         ('6110','Tryggingagjald','Social security expense','expense','none',FALSE,610,''),
         ('6120','Lífeyrisframlag atvinnurekanda','Employer pension','expense','none',FALSE,620,''),
         ('6200','Húsnæðiskostnaður','Premises','expense','input_24',FALSE,630,''),
         ('6300','Tölvu- og hugbúnaðarkostnaður','Software and IT','expense','input_24',FALSE,640,'Oft frá útlöndum — athugið veltuskatt (reverse charge)'),
         ('6400','Sími og internet','Telecoms','expense','input_24',FALSE,650,''),
         ('6500','Bankakostnaður og greiðslugjöld','Bank and payment fees','expense','exempt',FALSE,660,'Stripe-gjöld — meðferð VSK óstaðfest, sjá bókhaldsskjal'),
         ('6600','Bifreiðakostnaður','Vehicle costs','expense','input_24',FALSE,670,'Innskattur er EKKI frádráttarbær af fólksbifreið undir 5.000 kg'),
         ('6700','Sérfræðiþjónusta','Professional services','expense','input_24',FALSE,680,'Bókhald, lögfræði'),
         ('6800','Annar rekstrarkostnaður','Other operating costs','expense','input_24',FALSE,690,''),
         ('6900','Risna og gjafir','Entertainment and gifts','expense','none',TRUE,700,'Innskattur ekki frádráttarbær (risna)'),
         ('6910','Fæði starfsmanna','Staff meals','expense','none',TRUE,710,'Innskattur ekki frádráttarbær (mötuneyti/fæði)'),
         ('7100','Afskriftir','Depreciation','expense','none',FALSE,720,''),
         ('7900','Tekjuskattur','Corporate income tax','expense','none',FALSE,790,'20% hjá ehf.'),
         ('8100','Gengismunur','FX gain/loss','expense','none',FALSE,810,''),
         ('8200','Vaxtagjöld','Interest expense','expense','none',FALSE,820,''),
         ('8900','Sléttun','Rounding differences','expense','none',FALSE,890,'')
       ON CONFLICT (code) DO NOTHING`,

      // Invoice numbers start at 1001 so the first real invoice is not "1" — a
      // conventional courtesy that also makes test data obvious at a glance.
      `INSERT INTO bookkeeping_counters (name, next_value) VALUES
         ('invoice', 1001), ('receipt', 1), ('credit_note', 1), ('journal_entry', 1)
       ON CONFLICT (name) DO NOTHING`,

      // VSK periods for 2026-2027. ledgerService.ensureFiscalPeriod() creates any
      // period on demand, so a year boundary is never a hard stop.
      `INSERT INTO fiscal_periods (period, starts_on, ends_on) VALUES
         ('2026-P1','2026-01-01','2026-02-28'), ('2026-P2','2026-03-01','2026-04-30'),
         ('2026-P3','2026-05-01','2026-06-30'), ('2026-P4','2026-07-01','2026-08-31'),
         ('2026-P5','2026-09-01','2026-10-31'), ('2026-P6','2026-11-01','2026-12-31'),
         ('2027-P1','2027-01-01','2027-02-28'), ('2027-P2','2027-03-01','2027-04-30'),
         ('2027-P3','2027-05-01','2027-06-30'), ('2027-P4','2027-07-01','2027-08-31'),
         ('2027-P5','2027-09-01','2027-10-31'), ('2027-P6','2027-11-01','2027-12-31')
       ON CONFLICT (period) DO NOTHING`,

      // 2026 statutory payroll figures, from Skatturinn "Key rates and amounts 2026".
      // Deliberately left UNCONFIRMED (confirmed_at IS NULL): payroll refuses to run
      // until a human has checked them, which is also how the January rate change is
      // caught every year.
      // municipal_rate 0.1494 is the AVERAGE útsvar embedded in the published
      // combined band rates; it must be replaced with the registered municipality's
      // actual rate before the first payslip.
      `INSERT INTO payroll_rates
         (tax_year, bands, personal_allowance, municipal_rate, social_security,
          pension_employee, pension_employer, source_note)
       VALUES (2026,
         '[{"upTo":498122,"rate":0.3149},{"upTo":1398450,"rate":0.3799},{"upTo":null,"rate":0.4629}]'::jsonb,
         72492, 0.1494, 0.0635, 0.04, 0.115,
         'Skatturinn: Key rates and amounts 2026. Bond rates include average municipal tax 14.94% — replace municipal_rate with the registered municipality rate. Tryggingagjald 6.35%. Pension 4% + 11.5%.')
       ON CONFLICT (tax_year) DO NOTHING`,

      // Filing dates from Skatturinn's Skattadagatal 2026 — copied, not computed,
      // because they shift for weekends and public holidays.
      `INSERT INTO tax_deadlines (kind, period, due_on, label_is, label_en, note) VALUES
         ('vsk','2026-P1','2026-04-07','VSK-skil jan–feb','VAT return Jan–Feb',''),
         ('vsk','2026-P2','2026-06-02','VSK-skil mar–apr','VAT return Mar–Apr',''),
         ('vsk','2026-P3','2026-08-05','VSK-skil maí–jún','VAT return May–Jun',''),
         ('vsk','2026-P4','2026-10-05','VSK-skil júl–ágú','VAT return Jul–Aug',''),
         ('vsk','2026-P5','2026-12-07','VSK-skil sep–okt','VAT return Sep–Oct',''),
         ('vsk','2026-P6','2027-02-05','VSK-skil nóv–des','VAT return Nov–Dec',''),
         ('annual_return','2026','2026-05-31','Skattframtal lögaðila','Entity tax return',''),
         ('annual_accounts','2025','2026-08-31','Ársreikningur til ársreikningaskrár','Annual accounts filing','Sekt 600.000 kr. við vanskil'),
         ('rates_review','2027','2027-01-05','Yfirfara skatthlutföll og persónuafslátt 2027','Re-verify 2027 payroll rates','Staðfesta á skatturinn.is áður en laun eru reiknuð')
       ON CONFLICT (kind, period, due_on) DO NOTHING`,
    ],
  },
  {
    // Phase 4: expenses (the input-VAT side) and fylgiskjöl.
    //
    // The tables themselves ship in 072; this adds the protections that make an
    // expense a primary accounting document rather than an editable row, plus the
    // indexes the new screens actually query.
    name: '073_books_expenses',
    statements: [
      // An expense posts a journal entry the moment it is created, so its
      // financial content falls under the same gr. 9 rule as everything else:
      // correct it by reversing, not by editing.
      //
      // Three fields stay writable, and they are the point of the design:
      //   document_id  — the receipt is very often attached LATER. The whole
      //                  "missing documents" queue exists to chase exactly that,
      //                  so freezing it would break the feature it supports.
      //   description  — free-text note about what the purchase was for.
      //   note-ish     — likewise. Neither affects the ledger.
      `CREATE OR REPLACE FUNCTION books_protect_expense()
       RETURNS TRIGGER AS $$
       BEGIN
         IF TG_OP = 'DELETE' THEN
           RAISE EXCEPTION 'Expense % cannot be deleted; it is posted to the ledger (Reglugerd 505/2013 gr. 9). Reverse its journal entry instead', OLD.id
             USING ERRCODE = 'restrict_violation';
         END IF;
         IF (NEW.supplier_name, NEW.supplier_kennitala, NEW.supplier_country,
             NEW.supplier_invoice_no, NEW.expense_date,
             NEW.amount_net, NEW.amount_vat, NEW.amount_gross,
             NEW.vat_code, NEW.vat_deductible, NEW.account_id,
             NEW.original_currency, NEW.original_amount_gross, NEW.fx_rate,
             NEW.created_by)
            IS DISTINCT FROM
            (OLD.supplier_name, OLD.supplier_kennitala, OLD.supplier_country,
             OLD.supplier_invoice_no, OLD.expense_date,
             OLD.amount_net, OLD.amount_vat, OLD.amount_gross,
             OLD.vat_code, OLD.vat_deductible, OLD.account_id,
             OLD.original_currency, OLD.original_amount_gross, OLD.fx_rate,
             OLD.created_by)
         THEN
           RAISE EXCEPTION 'Expense % is posted; its financial content cannot be altered (Reglugerd 505/2013 gr. 9). Only the attached document and description may change.', OLD.id
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_expenses_immutable ON expenses`,
      `CREATE TRIGGER trg_expenses_immutable
         BEFORE UPDATE OR DELETE ON expenses
         FOR EACH ROW EXECUTE FUNCTION books_protect_expense()`,

      // A document is evidence; once attached to an expense it must stay
      // retrievable for seven years. Detaching is allowed (expenses.document_id
      // is SET NULL), replacing the FILE is not.
      `CREATE OR REPLACE FUNCTION books_protect_document()
       RETURNS TRIGGER AS $$
       BEGIN
         IF TG_OP = 'DELETE' THEN
           RAISE EXCEPTION 'Supporting documents cannot be deleted — they are the 7-year evidence trail (bokhaldslog 145/1994 gr. 20)'
             USING ERRCODE = 'restrict_violation';
         END IF;
         IF (NEW.file_path, NEW.checksum_sha256, NEW.byte_size, NEW.mime_type, NEW.created_by)
            IS DISTINCT FROM
            (OLD.file_path, OLD.checksum_sha256, OLD.byte_size, OLD.mime_type, OLD.created_by)
         THEN
           RAISE EXCEPTION 'The stored file behind a supporting document cannot be swapped; upload a new document instead'
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_books_documents_immutable ON books_documents`,
      `CREATE TRIGGER trg_books_documents_immutable
         BEFORE UPDATE OR DELETE ON books_documents
         FOR EACH ROW EXECUTE FUNCTION books_protect_document()`,

      // Re-uploading the identical file is almost always a double-entry attempt
      // rather than a second genuine receipt. Not UNIQUE — the same PDF can
      // legitimately support two periods' entries — but indexed so the duplicate
      // check is cheap.
      `CREATE INDEX IF NOT EXISTS idx_books_documents_checksum
         ON books_documents (checksum_sha256)`,

      // Backs the supplier-history lookup on the expense form and the
      // "same supplier, same invoice number" duplicate warning.
      `CREATE INDEX IF NOT EXISTS idx_expenses_supplier
         ON expenses (LOWER(supplier_name), expense_date DESC)`,

      // Backs the AR aging and statement queries, which group by the customer key
      // (user_id when known, else the lowercased email).
      `CREATE INDEX IF NOT EXISTS idx_invoices_customer_key
         ON invoices (COALESCE(user_id, LOWER(customer_email)))
         WHERE status IN ('issued','credited')`,
    ],
  },
  {
    // Per-product VAT rate.
    //
    // Until now every invoice line was hardcoded to 24% (or 0% on an export),
    // which made the whole per-rate apparatus — the 4200/2210 accounts, the
    // multi-bucket VSK return, the per-rate credit-note split — unreachable code.
    // That matters because the 11% band is a CLOSED statutory list and one of the
    // things on it is books and printed matter: the moment a catalogue or a book is
    // sold, charging 24% on it is simply the wrong tax.
    //
    // The rate is snapshotted onto invoice_lines at issue (already the case), so
    // changing a product's rate later never rewrites a historical invoice.
    name: '074_product_vat_rate',
    statements: [
      `ALTER TABLE products
         ADD COLUMN IF NOT EXISTS vat_rate SMALLINT NOT NULL DEFAULT 24`,
      // Same closed set as invoice_lines and server/utils/vat.js — the three rates
      // Iceland actually has.
      `DO $$ BEGIN
         ALTER TABLE products
           ADD CONSTRAINT products_vat_rate_check CHECK (vat_rate IN (0, 11, 24));
       EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    ],
  },
  {
    // Phase 6: reconciliation gaps found while wiring the Stripe sync.
    name: '075_books_reconciliation',
    statements: [
      // Attribution on a Stripe sync. 072 recorded WHEN a settlement was synced but
      // not WHO ran it, and Reglugerð 505/2013 gr. 8 wants an identifiable person
      // behind every entry — including the automated ones, where "which admin
      // triggered this" is the only answer available.
      `ALTER TABLE stripe_transactions
         ADD COLUMN IF NOT EXISTS synced_by TEXT REFERENCES users(id) ON DELETE RESTRICT`,

      // A settled Stripe row and a resolved bank line are both evidence of a posting.
      // Neither is append-only at the row level — a bank line legitimately moves from
      // unmatched to matched — but the LINK to the journal entry must not be quietly
      // repointed at a different entry once set, or the trail from ledger to source
      // breaks silently.
      `CREATE OR REPLACE FUNCTION books_freeze_settled_link()
       RETURNS TRIGGER AS $$
       BEGIN
         IF OLD.journal_entry_id IS NOT NULL
            AND NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id THEN
           RAISE EXCEPTION 'This row is already linked to a journal entry; that link cannot be repointed (Reglugerd 505/2013 gr. 8)'
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_stripe_link_frozen ON stripe_transactions`,
      `CREATE TRIGGER trg_stripe_link_frozen
         BEFORE UPDATE ON stripe_transactions
         FOR EACH ROW EXECUTE FUNCTION books_freeze_settled_link()`,

      // Which invoice a bank receipt settled. 072 recorded the payment id, which is
      // enough to trace the posting but not enough to answer "which invoice did this
      // deposit pay" without a join through payments — the question the AR screen and
      // the operator both actually ask.
      `ALTER TABLE bank_transactions
         ADD COLUMN IF NOT EXISTS matched_invoice_id TEXT
           REFERENCES invoices(id) ON DELETE RESTRICT`,

      // Backs the reconciliation screen's default view and the unmatched count.
      `CREATE INDEX IF NOT EXISTS idx_bank_transactions_open
         ON bank_transactions (account_code, booked_on DESC)
         WHERE match_state = 'unmatched'`,
      // Backs the "has this Stripe payout already been posted" lookup.
      `CREATE INDEX IF NOT EXISTS idx_stripe_transactions_payout
         ON stripe_transactions (payout_id) WHERE payout_id IS NOT NULL`,
    ],
  },
  {
    // ── 076: payroll, made runnable ──────────────────────────────────────────
    //
    // Migration 072 laid down the payroll SHAPE and got the important decision right:
    // every statutory rate is effective-dated data in payroll_rates, with confirmed_at
    // and confirmed_by, because Iceland re-sets the bands, persónuafsláttur,
    // tryggingagjald and pension percentages each January, and a hardcoded rate is a
    // guaranteed annual bug. This migration builds on that rather than beside it —
    // there must be exactly one payroll schema in this database.
    //
    // What 072 left out is the LIFECYCLE of a run:
    //
    //   * no draft state, so figures could not be reviewed before becoming money owed
    //     to Skatturinn
    //   * no link from a run to the journal entry it posted, so the ledger and the
    //     payroll register were two sets of numbers with no way to tie them
    //   * no reversal, so a mistake could only be fixed by editing history
    //   * no append-only enforcement, so a posted run was editable
    //   * `period` was UNIQUE outright, which does one job right (a second POSTED run
    //     for a month would double every remittance) and one wrong (a draft alongside
    //     a posted run is exactly how a correction gets prepared)
    //
    // It also capped allowance_factor at 1, which is wrong: persónuafsláttur can be
    // partly transferred from a spouse, so above the standard credit is legal.
    name: '076_books_payroll_lifecycle',
    statements: [
      // ── Employees ────────────────────────────────────────────────────────────

      // 'owner' is what turns on the reiknað endurgjald check. Paying yourself below
      // the RSK minimum for your category is the commonest mistake a one-person ehf.
      // makes, and nothing about the payslip looks wrong at the time.
      `ALTER TABLE employees
         ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'employee'`,
      `ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_employment_type_check`,
      `ALTER TABLE employees
         ADD CONSTRAINT employees_employment_type_check
         CHECK (employment_type IN ('employee','owner','contractor'))`,

      // An owner with no category cannot be checked against the minimum, which is the
      // one thing an owner most needs checked.
      `ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_owner_has_category`,
      `ALTER TABLE employees
         ADD CONSTRAINT employees_owner_has_category
         CHECK (employment_type <> 'owner' OR reference_wage_category IS NOT NULL)`,

      // Employment dates, so a payslip for someone who left in March is a warning
      // rather than something nobody notices until the annual return.
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS started_on DATE`,
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS ended_on DATE`,
      `ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_dates_ordered`,
      `ALTER TABLE employees
         ADD CONSTRAINT employees_dates_ordered
         CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on)`,
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT ''`,

      // Per-employee pension rates. NULL means "use the statutory rate for the year",
      // which is a different statement from 0 — hence nullable rather than defaulted.
      // A collective agreement can be more generous than the statutory minimum, so an
      // override that is LOWER is flagged by the preflight rather than refused here.
      `ALTER TABLE employees
         ADD COLUMN IF NOT EXISTS pension_employee_rate NUMERIC(6,4)`,
      `ALTER TABLE employees
         ADD COLUMN IF NOT EXISTS pension_employer_rate NUMERIC(6,4)`,
      `ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_pension_rates_sane`,
      `ALTER TABLE employees
         ADD CONSTRAINT employees_pension_rates_sane
         CHECK ((pension_employee_rate IS NULL OR pension_employee_rate BETWEEN 0 AND 0.5)
            AND (pension_employer_rate IS NULL OR pension_employer_rate BETWEEN 0 AND 0.5))`,

      // 072 capped the personal-credit factor at 1. Persónuafsláttur can be partly
      // transferred from a spouse, so a factor above 1 is legitimate, and capping it
      // silently over-withholds for the households it was meant to help.
      `ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_allowance_factor_check`,
      `ALTER TABLE employees
         ADD CONSTRAINT employees_allowance_factor_check
         CHECK (allowance_factor BETWEEN 0 AND 2)`,

      // ── Runs ─────────────────────────────────────────────────────────────────

      // draft -> posted -> reversed, with 'settled' kept from 072 for a run whose wages
      // have gone out. The draft is the point: payroll figures should be looked at
      // before they become a liability to Skatturinn.
      `ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_status_check`,
      `ALTER TABLE payroll_runs
         ADD CONSTRAINT payroll_runs_status_check
         CHECK (status IN ('draft','posted','settled','reversed'))`,
      `ALTER TABLE payroll_runs ALTER COLUMN status SET DEFAULT 'draft'`,

      // The UNIQUE on period was doing two jobs and getting one wrong. Replaced with a
      // partial index so only a POSTED (or settled) run is exclusive per month.
      `ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_period_key`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_payroll_posted_period
         ON payroll_runs (period) WHERE status IN ('posted','settled')`,

      // The link to the ledger.
      `ALTER TABLE payroll_runs
         ADD COLUMN IF NOT EXISTS journal_entry_id TEXT
           REFERENCES journal_entries(id) ON DELETE RESTRICT`,
      `ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ`,
      `ALTER TABLE payroll_runs
         ADD COLUMN IF NOT EXISTS posted_by TEXT REFERENCES users(id) ON DELETE RESTRICT`,
      // The preflight as it stood at posting, including any override and its reason. A
      // year later, "why was this posted with the owner below the minimum" is a
      // question the record can answer.
      `ALTER TABLE payroll_runs
         ADD COLUMN IF NOT EXISTS preflight JSONB NOT NULL DEFAULT '{}'::jsonb`,
      `ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE payroll_runs
         ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
      `DROP TRIGGER IF EXISTS trg_payroll_runs_updated_at ON payroll_runs`,
      `CREATE TRIGGER trg_payroll_runs_updated_at
         BEFORE UPDATE ON payroll_runs
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,

      // A posted run without a journal entry would be a liability recorded nowhere.
      `ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_posted_has_entry`,
      `ALTER TABLE payroll_runs
         ADD CONSTRAINT payroll_posted_has_entry
         CHECK (status = 'draft' OR (journal_entry_id IS NOT NULL AND posted_at IS NOT NULL))`,

      // ── Payslips ─────────────────────────────────────────────────────────────

      // Identity as it stood on the day, because a payslip is a document, not a view
      // over the employees table. Renaming someone must not rewrite their old payslips.
      `ALTER TABLE payslips ADD COLUMN IF NOT EXISTS employee_name TEXT`,
      `ALTER TABLE payslips ADD COLUMN IF NOT EXISTS employee_kennitala TEXT`,
      // The filed PDF. Deliberately separate from the figures — the trigger below
      // allows it to be attached after posting for exactly that reason.
      `ALTER TABLE payslips
         ADD COLUMN IF NOT EXISTS document_id TEXT
           REFERENCES books_documents(id) ON DELETE RESTRICT`,
      `CREATE INDEX IF NOT EXISTS idx_payslips_employee
         ON payslips (employee_id, created_at DESC)`,

      // The identity that makes a payslip checkable at rest, rather than only by
      // re-running the code that produced it. If a new deduction type is ever added,
      // this constraint has to be extended with it — which is the point: a deduction
      // the net does not account for cannot be stored.
      `ALTER TABLE payslips DROP CONSTRAINT IF EXISTS payslip_net_adds_up`,
      `ALTER TABLE payslips
         ADD CONSTRAINT payslip_net_adds_up
         CHECK (net_pay = gross - withholding - pension_employee - extra_pension_employee - union_dues)`,
      // Withholding is the computed tax less the credit, so it can never exceed it.
      `ALTER TABLE payslips DROP CONSTRAINT IF EXISTS payslip_withholding_within_tax`,
      `ALTER TABLE payslips
         ADD CONSTRAINT payslip_withholding_within_tax
         CHECK (withholding <= computed_tax)`,
      // 072 used ON DELETE RESTRICT, which would leave payslips behind when a DRAFT run
      // is discarded. CASCADE is right here: a draft's payslips are part of the draft,
      // and the trigger below is what stops a POSTED run being deleted at all.
      `ALTER TABLE payslips DROP CONSTRAINT IF EXISTS payslips_run_id_fkey`,
      `ALTER TABLE payslips
         ADD CONSTRAINT payslips_run_id_fkey
         FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE`,

      // ── Append-only, once posted ─────────────────────────────────────────────
      //
      // Reglugerð 505/2013 gr. 9, the same rule the journal follows. Correcting a
      // posted run means reversing it and posting a new one, so the mistake and the
      // fix are both on record.
      `CREATE OR REPLACE FUNCTION books_protect_payroll_run()
       RETURNS TRIGGER AS $$
       BEGIN
         IF TG_OP = 'DELETE' THEN
           IF OLD.status <> 'draft' THEN
             RAISE EXCEPTION 'Payroll run % has been posted and cannot be deleted; reverse it instead (Reglugerd 505/2013 gr. 9)', OLD.period
               USING ERRCODE = 'restrict_violation';
           END IF;
           RETURN OLD;
         END IF;
         IF OLD.status IN ('posted','settled')
            AND NEW.status NOT IN ('posted','settled','reversed') THEN
           RAISE EXCEPTION 'A posted payroll run can only be settled or reversed, not returned to %', NEW.status
             USING ERRCODE = 'restrict_violation';
         END IF;
         IF OLD.status = 'reversed' AND NEW.status <> 'reversed' THEN
           RAISE EXCEPTION 'A reversed payroll run is final'
             USING ERRCODE = 'restrict_violation';
         END IF;
         IF OLD.status <> 'draft' AND (
              NEW.period <> OLD.period OR NEW.pay_date <> OLD.pay_date
              OR NEW.gross_total <> OLD.gross_total
              OR NEW.withholding_total <> OLD.withholding_total
              OR NEW.net_total <> OLD.net_total
              OR NEW.social_security_total <> OLD.social_security_total
              OR NEW.tax_year <> OLD.tax_year
              OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id) THEN
           RAISE EXCEPTION 'The figures on posted payroll run % are final (Reglugerd 505/2013 gr. 9)', OLD.period
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_payroll_run_protected ON payroll_runs`,
      `CREATE TRIGGER trg_payroll_run_protected
         BEFORE UPDATE OR DELETE ON payroll_runs
         FOR EACH ROW EXECUTE FUNCTION books_protect_payroll_run()`,

      // The payslip guard is not redundant with the run guard. Without it, the run
      // guard could be sidestepped: delete the payslips, and a posted run's totals rest
      // on no document at all.
      `CREATE OR REPLACE FUNCTION books_protect_payslip()
       RETURNS TRIGGER AS $$
       DECLARE v_status TEXT;
       BEGIN
         SELECT status INTO v_status FROM payroll_runs
          WHERE id = COALESCE(NEW.run_id, OLD.run_id);
         -- A parent that no longer exists means its DELETE was permitted, so it was a
         -- draft; let the cascade through rather than blocking on a missing row.
         IF v_status IS NULL OR v_status = 'draft' THEN
           RETURN COALESCE(NEW, OLD);
         END IF;
         -- Attaching the PDF afterwards is the one permitted change: the document is
         -- evidence OF the payslip, not part of its figures.
         IF TG_OP = 'UPDATE'
            AND NEW.run_id = OLD.run_id
            AND NEW.employee_id = OLD.employee_id
            AND NEW.gross = OLD.gross AND NEW.taxable_base = OLD.taxable_base
            AND NEW.withholding = OLD.withholding AND NEW.net_pay = OLD.net_pay
            AND NEW.pension_employee = OLD.pension_employee
            AND NEW.pension_employer = OLD.pension_employer
            AND NEW.social_security = OLD.social_security
            AND NEW.union_dues = OLD.union_dues
            AND OLD.document_id IS NULL AND NEW.document_id IS NOT NULL THEN
           RETURN NEW;
         END IF;
         RAISE EXCEPTION 'Payslips on a posted payroll run are final (Reglugerd 505/2013 gr. 9)'
           USING ERRCODE = 'restrict_violation';
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_payslip_protected ON payslips`,
      `CREATE TRIGGER trg_payslip_protected
         BEFORE UPDATE OR DELETE ON payslips
         FOR EACH ROW EXECUTE FUNCTION books_protect_payslip()`,

      // ── The year's figures are final once used ───────────────────────────────
      //
      // Un-confirming or editing a year that a posted run has used would leave that run
      // resting on rates the system now says nobody has checked, and its payslips would
      // no longer be reproducible from the year's figures.
      `CREATE OR REPLACE FUNCTION books_protect_payroll_rates()
       RETURNS TRIGGER AS $$
       DECLARE v_runs INT;
       BEGIN
         SELECT COUNT(*) INTO v_runs FROM payroll_runs
          WHERE tax_year = OLD.tax_year AND status <> 'draft';
         IF v_runs > 0 THEN
           IF TG_OP = 'DELETE' THEN
             RAISE EXCEPTION 'Tax year % has been used by % posted payroll run(s) and cannot be deleted', OLD.tax_year, v_runs
               USING ERRCODE = 'restrict_violation';
           END IF;
           IF NEW.confirmed_at IS NULL
              OR NEW.bands::text <> OLD.bands::text
              OR NEW.personal_allowance <> OLD.personal_allowance
              OR NEW.social_security <> OLD.social_security
              OR NEW.pension_employee <> OLD.pension_employee
              OR NEW.pension_employer <> OLD.pension_employer THEN
             RAISE EXCEPTION 'Tax year % has been used by % posted payroll run(s); its figures are final', OLD.tax_year, v_runs
               USING ERRCODE = 'restrict_violation';
           END IF;
         END IF;
         RETURN COALESCE(NEW, OLD);
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_payroll_rates_protected ON payroll_rates`,
      `CREATE TRIGGER trg_payroll_rates_protected
         BEFORE UPDATE OR DELETE ON payroll_rates
         FOR EACH ROW EXECUTE FUNCTION books_protect_payroll_rates()`,

      // ── Reiknað endurgjald, per year and category ────────────────────────────
      //
      // 072 put the reference wage on the EMPLOYEE, which records what was agreed with
      // an adviser but cannot answer "is this still the published minimum". RSK
      // republishes the table every year, so the minimum belongs to the year. The
      // employee keeps the category; the amount is looked up.
      `CREATE TABLE IF NOT EXISTS payroll_reference_wages (
        id            TEXT     PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tax_year      SMALLINT NOT NULL REFERENCES payroll_rates(tax_year) ON DELETE CASCADE,
        category      TEXT     NOT NULL,
        description   TEXT     NOT NULL DEFAULT '',
        monthly_min   BIGINT   NOT NULL CHECK (monthly_min >= 0),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tax_year, category)
      )`,

      // ── No seeded rates ─────────────────────────────────────────────────────
      //
      // Deliberately none, and 072 seeded none either. Entering a year's bands from
      // memory would put four authoritative-looking numbers into the database that
      // nobody has checked, and the whole design here is that such numbers must not
      // exist. The screen walks the owner through entering them from Skatturinn's
      // published table; until then payroll refuses to run, and says why.
    ],
  },
  {
    // ── 077: counter sales ───────────────────────────────────────────────────
    //
    // A counter sale is a SALE, so it belongs in the sales ledger with everything else.
    // This migration adds almost nothing, and that is the design: migration 072 already
    // has an `invoices.series` of ('invoice','receipt') and a gapless 'receipt' counter
    // beside the invoice one, so a till sale is a receipt-series row in `invoices`.
    //
    // The alternative — a separate pos_sales table — would give the business two sales
    // ledgers that have to be added together to answer "what did we sell", and the VSK
    // return would have to read both. One of them would eventually be forgotten.
    //
    // What a counter sale does NOT do is go through receivables. An invoice creates a
    // debt and the payment settles it later; at a till the sale and the money are the
    // same event, so the entry debits cash (or the card clearing account) directly. A
    // POS sale that debited 1100 and immediately credited it back would put two legs in
    // the ledger that describe nothing.
    name: '077_books_pos',
    statements: [
      // 'pos' as a journal source. Without it every till entry fails the source_type
      // CHECK — the counter is the last thing in these books that posts.
      `ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_type_check`,
      `ALTER TABLE journal_entries
         ADD CONSTRAINT journal_entries_source_type_check
         CHECK (source_type IN ('invoice','payment','credit_note','expense',
                                'payroll','vat_settlement','opening','manual',
                                'reversal','stripe','bank','pos'))`,

      // A counter sale has no customer to bill, so customer_name carries a standing
      // label rather than a person. Nothing to migrate — noted here because a reader
      // finding 'Almenn sala' in the invoices table should know it is deliberate and
      // not a placeholder somebody forgot to fill in.

      // Backs the till's own history view and the day's takings, without making the
      // invoice register's index do double duty.
      `CREATE INDEX IF NOT EXISTS idx_invoices_receipts
         ON invoices (issued_at DESC, invoice_number DESC)
         WHERE series = 'receipt'`,
    ],
  },
  {
    // ── 078: payroll integrity hardening ─────────────────────────────────────
    //
    // Three holes a review of PR #117 found in the 076 payroll triggers, plus the two
    // columns the corrected séreign posting needs. All CREATE OR REPLACE, because 076 is
    // applied and must not be edited.
    //
    //   1. A posted payslip could be edited or destroyed by REPARENTING it onto a
    //      throwaway draft run — books_protect_payslip resolved the parent as
    //      COALESCE(NEW.run_id, OLD.run_id), i.e. the NEW (draft) run, hit its
    //      draft early-return, and let the move through; deleting the draft then
    //      CASCADEd the payslip away, leaving a posted run resting on nothing. The
    //      journal-line and invoice-line guards already check BOTH parents and refuse
    //      reparenting; this one now does too.
    //   2. The run "figures are final" check compared only some columns — the pension,
    //      séreign and union totals (exactly what the journal credited), the preflight
    //      (the stored answer to "why was this overridden"), and posted_by/posted_at
    //      (gr. 8 attribution) were all editable after posting.
    //   3. The rates "final once used" check omitted municipal_rate, source_note and
    //      confirmed_by, so a used year's provenance could be rewritten.
    name: '078_books_payroll_integrity',
    statements: [
      // Séreignarsparnaður totals, kept apart from the mandatory-fund totals so 2320 and
      // 2330 can be credited separately. Default 0; historical rows keep their old
      // folded figures (they are append-only and not re-posted).
      `ALTER TABLE payroll_runs
         ADD COLUMN IF NOT EXISTS extra_pension_employee_total BIGINT NOT NULL DEFAULT 0
           CHECK (extra_pension_employee_total >= 0)`,
      `ALTER TABLE payroll_runs
         ADD COLUMN IF NOT EXISTS extra_pension_employer_total BIGINT NOT NULL DEFAULT 0
           CHECK (extra_pension_employer_total >= 0)`,

      // ── Run: freeze every figure, not just some ──────────────────────────────
      `CREATE OR REPLACE FUNCTION books_protect_payroll_run()
       RETURNS TRIGGER AS $$
       BEGIN
         IF TG_OP = 'DELETE' THEN
           IF OLD.status <> 'draft' THEN
             RAISE EXCEPTION 'Payroll run % has been posted and cannot be deleted; reverse it instead (Reglugerd 505/2013 gr. 9)', OLD.period
               USING ERRCODE = 'restrict_violation';
           END IF;
           RETURN OLD;
         END IF;
         IF OLD.status IN ('posted','settled')
            AND NEW.status NOT IN ('posted','settled','reversed') THEN
           RAISE EXCEPTION 'A posted payroll run can only be settled or reversed, not returned to %', NEW.status
             USING ERRCODE = 'restrict_violation';
         END IF;
         IF OLD.status = 'reversed' AND NEW.status <> 'reversed' THEN
           RAISE EXCEPTION 'A reversed payroll run is final'
             USING ERRCODE = 'restrict_violation';
         END IF;
         -- Once out of draft, only status (posted->settled->reversed), note (reverseRun
         -- appends to it) and updated_at may change. Every figure, the attribution and
         -- the preflight are frozen.
         IF OLD.status <> 'draft' AND (
              NEW.period <> OLD.period OR NEW.pay_date <> OLD.pay_date
              OR NEW.tax_year <> OLD.tax_year
              OR NEW.gross_total <> OLD.gross_total
              OR NEW.withholding_total <> OLD.withholding_total
              OR NEW.pension_employee_total <> OLD.pension_employee_total
              OR NEW.pension_employer_total <> OLD.pension_employer_total
              OR NEW.extra_pension_employee_total <> OLD.extra_pension_employee_total
              OR NEW.extra_pension_employer_total <> OLD.extra_pension_employer_total
              OR NEW.social_security_total <> OLD.social_security_total
              OR NEW.union_total <> OLD.union_total
              OR NEW.net_total <> OLD.net_total
              OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
              OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
              OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
              OR NEW.created_by IS DISTINCT FROM OLD.created_by
              OR NEW.preflight::text <> OLD.preflight::text) THEN
           RAISE EXCEPTION 'The figures on posted payroll run % are final (Reglugerd 505/2013 gr. 9)', OLD.period
             USING ERRCODE = 'restrict_violation';
         END IF;
         RETURN NEW;
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_payroll_run_protected ON payroll_runs`,
      `CREATE TRIGGER trg_payroll_run_protected
         BEFORE UPDATE OR DELETE ON payroll_runs
         FOR EACH ROW EXECUTE FUNCTION books_protect_payroll_run()`,

      // ── Payslip: check BOTH parents, refuse reparenting, tighten the carve-out ─
      `CREATE OR REPLACE FUNCTION books_protect_payslip()
       RETURNS TRIGGER AS $$
       DECLARE v_old_status TEXT; v_new_status TEXT;
       BEGIN
         IF TG_OP = 'DELETE' THEN
           SELECT status INTO v_old_status FROM payroll_runs WHERE id = OLD.run_id;
           -- A parent that no longer exists means its own DELETE was permitted, so it
           -- was a draft; let the cascade through.
           IF v_old_status IS NULL OR v_old_status = 'draft' THEN
             RETURN OLD;
           END IF;
           RAISE EXCEPTION 'Payslips on a posted payroll run are final (Reglugerd 505/2013 gr. 9)'
             USING ERRCODE = 'restrict_violation';
         END IF;

         SELECT status INTO v_old_status FROM payroll_runs WHERE id = OLD.run_id;
         SELECT status INTO v_new_status FROM payroll_runs WHERE id = NEW.run_id;

         -- Reparenting is refused outright: a payslip cannot move between runs. Moving
         -- it OFF a posted run (onto a draft, then deleting the draft) was the way the
         -- posted-run guard got sidestepped.
         IF NEW.run_id <> OLD.run_id THEN
           RAISE EXCEPTION 'A payslip cannot be moved to another payroll run (Reglugerd 505/2013 gr. 9)'
             USING ERRCODE = 'restrict_violation';
         END IF;

         -- Both parents are the same run now. If it is a draft, the payslip is editable.
         IF v_old_status IS NULL OR v_old_status = 'draft' THEN
           RETURN NEW;
         END IF;

         -- Posted run: the ONLY permitted change is attaching the PDF for the first
         -- time. Every figure and the snapshotted identity must be byte-identical.
         IF NEW.employee_id = OLD.employee_id
            AND NEW.employee_name = OLD.employee_name
            AND NEW.employee_kennitala = OLD.employee_kennitala
            AND NEW.gross = OLD.gross AND NEW.taxable_base = OLD.taxable_base
            AND NEW.computed_tax = OLD.computed_tax
            AND NEW.allowance_used = OLD.allowance_used
            AND NEW.withholding = OLD.withholding AND NEW.net_pay = OLD.net_pay
            AND NEW.pension_employee = OLD.pension_employee
            AND NEW.pension_employer = OLD.pension_employer
            AND NEW.extra_pension_employee = OLD.extra_pension_employee
            AND NEW.extra_pension_employer = OLD.extra_pension_employer
            AND NEW.social_security = OLD.social_security
            AND NEW.union_dues = OLD.union_dues
            AND NEW.breakdown::text = OLD.breakdown::text
            AND OLD.document_id IS NULL AND NEW.document_id IS NOT NULL THEN
           RETURN NEW;
         END IF;
         RAISE EXCEPTION 'Payslips on a posted payroll run are final (Reglugerd 505/2013 gr. 9)'
           USING ERRCODE = 'restrict_violation';
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_payslip_protected ON payslips`,
      `CREATE TRIGGER trg_payslip_protected
         BEFORE UPDATE OR DELETE ON payslips
         FOR EACH ROW EXECUTE FUNCTION books_protect_payslip()`,

      // ── Rates: freeze the provenance too, once a year is used ─────────────────
      `CREATE OR REPLACE FUNCTION books_protect_payroll_rates()
       RETURNS TRIGGER AS $$
       DECLARE v_runs INT;
       BEGIN
         SELECT COUNT(*) INTO v_runs FROM payroll_runs
          WHERE tax_year = OLD.tax_year AND status <> 'draft';
         IF v_runs > 0 THEN
           IF TG_OP = 'DELETE' THEN
             RAISE EXCEPTION 'Tax year % has been used by % posted payroll run(s) and cannot be deleted', OLD.tax_year, v_runs
               USING ERRCODE = 'restrict_violation';
           END IF;
           IF NEW.confirmed_at IS NULL
              OR NEW.bands::text <> OLD.bands::text
              OR NEW.personal_allowance <> OLD.personal_allowance
              OR NEW.municipal_rate <> OLD.municipal_rate
              OR NEW.social_security <> OLD.social_security
              OR NEW.pension_employee <> OLD.pension_employee
              OR NEW.pension_employer <> OLD.pension_employer
              OR NEW.source_note <> OLD.source_note
              OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by THEN
             RAISE EXCEPTION 'Tax year % has been used by % posted payroll run(s); its figures are final', OLD.tax_year, v_runs
               USING ERRCODE = 'restrict_violation';
           END IF;
         END IF;
         RETURN COALESCE(NEW, OLD);
       END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_payroll_rates_protected ON payroll_rates`,
      `CREATE TRIGGER trg_payroll_rates_protected
         BEFORE UPDATE OR DELETE ON payroll_rates
         FOR EACH ROW EXECUTE FUNCTION books_protect_payroll_rates()`,
    ],
  },
  {
    // ── 079: counter-sale idempotency ────────────────────────────────────────
    //
    // A double-tap of "complete the sale" at the till, or a retry after a lost
    // response, rang up a SECOND full sale: the POS payment key was derived from the
    // receipt's own fresh UUID, so it could never collide with anything. This lets the
    // client send a per-attempt token; a retry carrying the same token collides on this
    // index, the second transaction rolls back whole (its counter number with it, so the
    // series stays gapless), and the caller is handed the receipt the first attempt made.
    //
    // Partial, on the 'client:' prefix, so it constrains only caller-supplied POS tokens
    // and never the auto 'pos-<id>' keys or the invoice payment keys.
    name: '079_books_pos_idempotency',
    statements: [
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_payments_client_key
         ON payments (idempotency_key) WHERE idempotency_key LIKE 'client:%'`,
    ],
  },
  {
    // Admin two-factor sign-in (TOTP, RFC 6238). Ported from icelandicstore
    // (#138 there; base migration number differs — chains diverged at 072).
    //
    //   totp_secret        — base32, NULL until enrolment starts. Present but with
    //                        totp_enabled = FALSE means enrolment was begun and
    //                        never confirmed; such a secret must never authorise.
    //   totp_enabled       — the single source of truth for "this account is protected".
    //   totp_last_step     — the last accepted TOTP counter, so a code cannot be
    //                        replayed inside its own 30-second window.
    //
    // user_recovery_codes: single-use fallbacks, stored as scrypt HASHES (the same
    // primitive as passwords) — a leaked DB backup must not hand over the second
    // factor. Deleted with the user.
    //
    // mfa_challenges: the short-lived state between "password accepted" and "code
    // accepted". It exists as a TABLE rather than a signed token because a row is
    // revocable, attempt-countable and audit-visible, which a stateless token is
    // not — and inventing a second token format for auth is the wrong place to
    // improvise.
    name: '080_admin_totp',
    statements: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret       TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled      BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_confirmed_at TIMESTAMPTZ`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step    BIGINT`,

      `CREATE TABLE IF NOT EXISTS user_recovery_codes (
         id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         code_hash  TEXT NOT NULL,
         used_at    TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
      `CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON user_recovery_codes(user_id) WHERE used_at IS NULL`,

      `CREATE TABLE IF NOT EXISTS mfa_challenges (
         id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         expires_at TIMESTAMPTZ NOT NULL,
         attempts   INTEGER NOT NULL DEFAULT 0,
         ip_address TEXT,
         user_agent TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
      `CREATE INDEX IF NOT EXISTS idx_mfa_challenges_expires ON mfa_challenges(expires_at)`,
    ],
  },
  {
    // Per-account UI theme. The switcher already persisted the choice in
    // localStorage (per browser); this column makes it follow the LOGIN, so a
    // user who signs in on a second device or a fresh browser gets their theme
    // back. Values match THEMES in public/js/services/themePrefs.js and the
    // token sets in public/css/themes.css — adding a theme needs a new
    // migration to widen the CHECK. (Ported from icelandicstore #176; number
    // differs — the chains diverged at 072.)
    //
    // NULLABLE on purpose, and NULL is not the same as 'classic': NULL means
    // "this account has never picked a theme", so the browser's own
    // localStorage choice is left alone at login. Defaulting to 'classic'
    // would make every existing user's saved local theme get reset on their
    // first login after this migration. A CHECK constraint ignores NULLs, so
    // the column still can't hold an unknown theme name.
    // WARNING for whoever widens this list: the DO block below guards by
    // constraint NAME, so appending a copy of this pattern with more themes
    // silently no-ops (the name already exists) and the DB keeps rejecting the
    // new values while the UI offers them. A widening migration must instead be
    // DROP CONSTRAINT IF EXISTS users_theme_check; ADD CONSTRAINT … (both
    // idempotent, so still safe to re-run).
    name: '081_user_theme',
    statements: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT`,
      `DO $$ BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint WHERE conname = 'users_theme_check'
         ) THEN
           ALTER TABLE users ADD CONSTRAINT users_theme_check
             CHECK (theme IN ('classic', 'glacier', 'moss', 'lava', 'aurora', 'black-sand'));
         END IF;
       END $$`,
    ],
  },
  {
    // ── 082: self-update ledger ──────────────────────────────────────────────
    //
    // One row per release this instance has ever heard about, on the channel it
    // heard about it from. The unique (channel, version) index is what makes
    // the hourly check idempotent: re-reading the same manifest updates the row
    // in place instead of growing the table forever.
    //
    // status is a CHECK, not an enum type: adding a state to a Postgres enum is
    // a migration with a lock, adding one to a CHECK is a migration without the
    // ceremony — and this state machine will grow.
    //
    // previous_digest is the digest that was running when apply was triggered,
    // captured BEFORE the swap. It is the only thing that makes an assisted
    // rollback possible, and it cannot be recovered after the fact.
    //
    // detail (jsonb) carries the non-indexed remainder — the scheduled time an
    // auto instance picked, the compatibility flag, the failure reason — so the
    // shape can grow without a migration per field.
    //
    // Authoritative copy. NOTE: ported from orangesmiley, where this same
    // migration is named 081_system_updates — here it is 082, because the
    // runner records by NAME and the two chains diverged. There is no
    // server/migrations/*.sql reference copy for it in this repo.
    name: '082_system_updates',
    statements: [
      `CREATE TABLE IF NOT EXISTS system_updates (
        id              SERIAL      PRIMARY KEY,
        discovered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        version         TEXT        NOT NULL,
        image_digest    TEXT        NOT NULL,
        channel         TEXT        NOT NULL,
        changelog_md    TEXT,
        status          TEXT        NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available','scheduled','applying','applied','failed','dismissed')),
        applied_at      TIMESTAMPTZ,
        previous_digest TEXT,
        detail          JSONB       NOT NULL DEFAULT '{}'::jsonb,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_system_updates_channel_version
         ON system_updates (channel, version)`,
      // The two questions the app asks constantly: "is anything actionable?"
      // and "what is the newest thing I know about?".
      `CREATE INDEX IF NOT EXISTS idx_system_updates_status
         ON system_updates (status, discovered_at DESC)`,
    ],
  },
  {
    // Admin → Monitoring (harvest 2026-08-22, from icelandicstore #195): a
    // server-side failure log the admin can actually see. Client errors
    // arrive via the public beacon (/api/v1/events/collect), server errors
    // from the error middleware; eventLogCleanup prunes past
    // EVENT_LOG_RETENTION_DAYS (default 90). NOTE the number: ice calls this
    // table's migration 093_event_logs (and even carries a duplicate 093 in
    // its chain) — the runner records by NAME, chains diverged at 072, so
    // this repo numbers it 083.
    name: '083_event_logs',
    statements: [
      `CREATE TABLE IF NOT EXISTS event_logs (
         id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
         source      TEXT NOT NULL CHECK (source IN ('client','server')),
         level       TEXT NOT NULL DEFAULT 'error' CHECK (level IN ('error','warn','info')),
         message     TEXT NOT NULL,
         path        TEXT,
         status      INTEGER,
         user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
         username    TEXT,
         request_id  TEXT,
         user_agent  TEXT,
         context     JSONB NOT NULL DEFAULT '{}',
         created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
      `CREATE INDEX IF NOT EXISTS idx_event_logs_created_at ON event_logs (created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_event_logs_user ON event_logs (user_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_event_logs_source_level
         ON event_logs (source, level, created_at DESC)`,
    ],
  },
  {
    // MCP connector tokens (harvest 2026-08-22, from icelandicstore #188 —
    // implements ENHANCEMENTS #13). sha256-hashed opaque bearer tokens with a
    // NOT-NULL expiry, revocation and last-used tracking; kind/oauth_client_id/
    // parent_id ship early so a future OAuth flow extends this one table.
    // NOTE the number: ice calls this 098_mcp_tokens — renumbered per chain.
    name: '084_mcp_tokens',
    statements: [
      `CREATE TABLE IF NOT EXISTS mcp_tokens (
         id              SERIAL PRIMARY KEY,
         user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         name            VARCHAR(100) NOT NULL,
         token_hash      VARCHAR(64) NOT NULL UNIQUE,
         token_prefix    VARCHAR(16) NOT NULL,
         kind            VARCHAR(10) NOT NULL DEFAULT 'manual'
                         CHECK (kind IN ('manual', 'access', 'refresh')),
         scopes          TEXT[] NOT NULL DEFAULT '{read}',
         oauth_client_id TEXT,
         parent_id       INTEGER REFERENCES mcp_tokens(id) ON DELETE CASCADE,
         expires_at      TIMESTAMPTZ NOT NULL,
         last_used_at    TIMESTAMPTZ,
         revoked_at      TIMESTAMPTZ,
         created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
      `CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens(user_id)`,
    ],
  },
];

module.exports = { migrations };
