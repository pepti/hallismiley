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
];

module.exports = { migrations };
