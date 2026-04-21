// Seed script: Smiley apparel line (t-shirts, sweatpants) with variants + SVG imagery.
//
// Default mode (SAFE — use this against production):
//   Upserts the defined products + variants by slug. Does NOT touch any
//   other product rows. Safe to run alongside admin-managed SKUs.
//
//   node server/scripts/seed-shop.js
//
// --reset mode (DESTRUCTIVE — local/dev only):
//   Additionally deactivates every product NOT in the defined lineup (and
//   their variants). Use this when you're pivoting product categories on
//   dev (e.g. roof boxes → apparel) and want a clean slate. NEVER run this
//   against a production DB with admin-added products.
//
//   node server/scripts/seed-shop.js --reset
//
// Re-runnable. Idempotent per (slug, attributes) via ON CONFLICT upserts.
// See RUNBOOK.md for the prod-seeding workflow.
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs   = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const ProductVariant = require('../models/ProductVariant');
const { productUploadDir, UPLOAD_ROOT } = require('../config/paths');

const SIZES  = ['XS', 'S', 'M', 'L', 'XL'];
const COLORS = ['black', 'white'];

// Per-variant starting stock. Intentionally uneven so the low-stock badge
// demos naturally (e.g. XS has 3 of each colour → "Only 3 left" on the card).
const STOCK_BY_SIZE = { XS: 3, S: 8, M: 14, L: 14, XL: 6 };

// Products — each uses size + colour variants and a VAT-inclusive base price.
// Variant override prices are null here (inherit from the product).
const PRODUCTS = [
  {
    slug: 'smiley-tshirt',
    name: 'Smiley T-Shirt',
    category: 'apparel',
    kind: 'tshirt',              // drives the SVG shape
    variant_axes: ['size', 'color'],
    description: `Heavyweight cotton tee with the Smiley mark on the chest. Pre-shrunk, cut true-to-size, built for long use.

Material
• 100% organic ring-spun cotton, 220 gsm
• Pre-shrunk, reinforced double-stitched shoulders
• Printed Smiley mark — water-based inks, soft to the touch

Fit
• Unisex cut
• Sizes XS–XL

Care
Machine wash cold, tumble dry low. Iron inside-out.

Prices include 24% VAT.`,
    price_isk: 5900,
    price_eur: 4000,   // €40.00 = 4000 cents
    weight_grams: 200,
  },
  {
    slug: 'smiley-sweatpants',
    name: 'Smiley Sweatpants',
    category: 'apparel',
    kind: 'sweatpants',
    variant_axes: ['size', 'color'],
    description: `Heavyweight cotton-blend sweatpants with a discreet Smiley embroidery on the left leg. Elasticated waist, side pockets, tapered cuff.

Material
• 80% cotton / 20% polyester fleece, 340 gsm
• Brushed-back interior for warmth
• Embroidered Smiley mark on the left leg (below the knee)

Fit
• Unisex relaxed cut
• Sizes XS–XL

Care
Machine wash cold, tumble dry low. Wash inside-out to protect the embroidery.

Prices include 24% VAT.`,
    price_isk: 9900,
    price_eur: 6800,   // €68.00
    weight_grams: 620,
  },
];

// ── SVG generators ──────────────────────────────────────────────────────────

// T-shirt silhouette, front view, with Smiley logo on chest.
// `color` is 'black' or 'white' — picks a palette for the fabric.
function tshirtSvg(color) {
  const fabric    = color === 'white' ? '#ececec' : '#14161a';
  const fabricHi  = color === 'white' ? '#ffffff' : '#2a2d33';
  const fabricLo  = color === 'white' ? '#c4c4c4' : '#07080a';
  const stitch    = color === 'white' ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)';
  const bgTop     = '#0A1428';
  const bgBottom  = '#152241';

  // Logo colour: Smiley mark is gold regardless of shirt colour so it pops.
  const logoFill   = '#C8AA6E';
  const logoStroke = '#785A28';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bgTop}"/>
      <stop offset="1" stop-color="${bgBottom}"/>
    </linearGradient>
    <linearGradient id="fabric" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"    stop-color="${fabricHi}"/>
      <stop offset="0.55" stop-color="${fabric}"/>
      <stop offset="1"    stop-color="${fabricLo}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.7" cy="0.3" r="0.65">
      <stop offset="0" stop-color="rgba(200,170,110,0.2)"/>
      <stop offset="1" stop-color="rgba(200,170,110,0)"/>
    </radialGradient>
  </defs>
  <rect width="800" height="800" fill="url(#bg)"/>
  <rect width="800" height="800" fill="url(#glow)"/>

  <!-- Hanger dropshadow -->
  <ellipse cx="400" cy="720" rx="240" ry="14" fill="#000" opacity="0.5"/>

  <!-- T-shirt silhouette (front): shoulders, sleeves, body, hem, neckline
       drawn as one closed path -->
  <path d="
    M 280 220
    L 220 240
    L 170 310
    L 230 360
    L 270 340
    L 270 680
    L 530 680
    L 530 340
    L 570 360
    L 630 310
    L 580 240
    L 520 220
    Q 500 265, 450 272
    Q 400 278, 350 272
    Q 300 265, 280 220
    Z"
    fill="url(#fabric)"
    stroke="${stitch}"
    stroke-width="1.5"/>

  <!-- Collar detail -->
  <path d="M 345 230 Q 400 250, 455 230"
        stroke="${stitch}" stroke-width="2" fill="none"/>

  <!-- Hem stitch -->
  <line x1="270" y1="665" x2="530" y2="665" stroke="${stitch}" stroke-width="1.2"/>
  <!-- Sleeve stitches -->
  <line x1="235" y1="345" x2="270" y2="335" stroke="${stitch}" stroke-width="1.2"/>
  <line x1="565" y1="345" x2="530" y2="335" stroke="${stitch}" stroke-width="1.2"/>

  <!-- Smiley logo on chest (~y=400) -->
  <g transform="translate(400,400)">
    <circle cx="0" cy="0" r="60" fill="${logoFill}" stroke="${logoStroke}" stroke-width="2"/>
    <!-- Eyes -->
    <circle cx="-20" cy="-12" r="7" fill="${logoStroke}"/>
    <circle cx="20"  cy="-12" r="7" fill="${logoStroke}"/>
    <!-- Smile -->
    <path d="M -26 12 Q 0 40, 26 12"
          stroke="${logoStroke}" stroke-width="6" fill="none" stroke-linecap="round"/>
  </g>

  <!-- Bottom wordmark -->
  <text x="400" y="760" text-anchor="middle"
        font-family="Georgia, serif" font-size="22"
        fill="#C8AA6E" letter-spacing="8" opacity="0.75">SMILEY</text>
</svg>`;
}

// Sweatpants silhouette, front view, with small Smiley on left leg.
function sweatpantsSvg(color) {
  const fabric    = color === 'white' ? '#ececec' : '#14161a';
  const fabricHi  = color === 'white' ? '#ffffff' : '#2a2d33';
  const fabricLo  = color === 'white' ? '#c4c4c4' : '#07080a';
  const stitch    = color === 'white' ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)';
  const bgTop     = '#0A1428';
  const bgBottom  = '#152241';

  const logoFill   = '#C8AA6E';
  const logoStroke = '#785A28';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bgTop}"/>
      <stop offset="1" stop-color="${bgBottom}"/>
    </linearGradient>
    <linearGradient id="fabric" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"    stop-color="${fabricHi}"/>
      <stop offset="0.55" stop-color="${fabric}"/>
      <stop offset="1"    stop-color="${fabricLo}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.72" cy="0.28" r="0.65">
      <stop offset="0" stop-color="rgba(200,170,110,0.2)"/>
      <stop offset="1" stop-color="rgba(200,170,110,0)"/>
    </radialGradient>
  </defs>
  <rect width="800" height="800" fill="url(#bg)"/>
  <rect width="800" height="800" fill="url(#glow)"/>

  <!-- Ground shadow under cuffs -->
  <ellipse cx="310" cy="745" rx="55" ry="8" fill="#000" opacity="0.5"/>
  <ellipse cx="490" cy="745" rx="55" ry="8" fill="#000" opacity="0.5"/>

  <!-- Pants silhouette:
       Waistband (240-560,140-180), crotch tapering to two legs, cuffs at bottom. -->
  <path d="
    M 240 140
    L 560 140
    L 560 185
    L 575 300
    L 555 500
    L 540 740
    L 440 740
    L 420 520
    L 400 360
    L 380 520
    L 360 740
    L 260 740
    L 245 500
    L 225 300
    L 240 185
    Z"
    fill="url(#fabric)" stroke="${stitch}" stroke-width="1.5"/>

  <!-- Waistband detail -->
  <rect x="240" y="140" width="320" height="40" fill="${fabricLo}" opacity="0.55"/>
  <line x1="240" y1="180" x2="560" y2="180" stroke="${stitch}" stroke-width="1.5"/>
  <!-- Drawstring -->
  <path d="M 380 165 Q 400 185, 420 165"
        stroke="${logoFill}" stroke-width="2" fill="none"/>
  <circle cx="378" cy="165" r="3" fill="${logoFill}"/>
  <circle cx="422" cy="165" r="3" fill="${logoFill}"/>

  <!-- Crotch seam -->
  <line x1="400" y1="185" x2="400" y2="360" stroke="${stitch}" stroke-width="1.5"/>
  <!-- Side seams -->
  <line x1="245" y1="310" x2="262" y2="730" stroke="${stitch}" stroke-width="1"/>
  <line x1="555" y1="310" x2="538" y2="730" stroke="${stitch}" stroke-width="1"/>
  <!-- Cuff stitching -->
  <line x1="260" y1="720" x2="360" y2="720" stroke="${stitch}" stroke-width="1.2"/>
  <line x1="440" y1="720" x2="540" y2="720" stroke="${stitch}" stroke-width="1.2"/>

  <!-- Small Smiley on LEFT LEG (wearer's left = viewer's right).
       Positioned just below the knee. -->
  <g transform="translate(500, 560)">
    <circle cx="0" cy="0" r="22" fill="${logoFill}" stroke="${logoStroke}" stroke-width="1.5"/>
    <circle cx="-7" cy="-5" r="2.5" fill="${logoStroke}"/>
    <circle cx="7"  cy="-5" r="2.5" fill="${logoStroke}"/>
    <path d="M -9 4 Q 0 14, 9 4"
          stroke="${logoStroke}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  </g>

  <!-- Bottom wordmark -->
  <text x="400" y="780" text-anchor="middle"
        font-family="Georgia, serif" font-size="20"
        fill="#C8AA6E" letter-spacing="8" opacity="0.7">SMILEY</text>
</svg>`;
}

function renderSvgFor(kind, color) {
  if (kind === 'tshirt')     return tshirtSvg(color);
  if (kind === 'sweatpants') return sweatpantsSvg(color);
  throw new Error(`Unknown product kind: ${kind}`);
}

// ── DB operations ──────────────────────────────────────────────────────────

async function upsertProduct(client, p) {
  const { rows } = await client.query(
    `INSERT INTO products (
       slug, name, description, price_isk, price_eur, stock, weight_grams,
       shape, capacity_litres, category, variant_axes, active
     )
     VALUES ($1,$2,$3,$4,$5,0,$6,NULL,NULL,$7,$8::jsonb,TRUE)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       price_isk = EXCLUDED.price_isk,
       price_eur = EXCLUDED.price_eur,
       weight_grams = EXCLUDED.weight_grams,
       shape = NULL,
       capacity_litres = NULL,
       category = EXCLUDED.category,
       variant_axes = EXCLUDED.variant_axes,
       active = TRUE
     RETURNING id`,
    [
      p.slug, p.name, p.description, p.price_isk, p.price_eur,
      p.weight_grams || null,
      p.category,
      JSON.stringify(p.variant_axes),
    ]
  );
  return rows[0].id;
}

const SEED_ASSETS_DIR = path.join(__dirname, 'seed-assets');
const PHOTO_EXTS = ['png', 'jpg', 'jpeg', 'webp'];

async function writeImages(productId, p) {
  const dir = productUploadDir(productId);
  fs.mkdirSync(dir, { recursive: true });

  // Step 1: populate the upload dir from the repo's seed-assets/ if the
  // target file doesn't already exist. Source naming convention:
  //   server/scripts/seed-assets/<product-slug>-<color>.<ext>
  // We NEVER overwrite an existing file — admin uploads / prior seeds win.
  for (const color of COLORS) {
    for (const ext of PHOTO_EXTS) {
      const src = path.join(SEED_ASSETS_DIR, `${p.slug}-${color}.${ext}`);
      const dst = path.join(dir, `${color}.${ext}`);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }
    }
  }

  // Step 2: precedence per colour:
  //   existing real photo (png/jpg/jpeg/webp) > generated SVG placeholder.
  // Admins who upload real imagery via the admin UI (or drop files into the
  // upload dir) aren't clobbered on the next seed run.
  const files = [];
  for (const color of COLORS) {
    let name = null;
    for (const ext of PHOTO_EXTS) {
      if (fs.existsSync(path.join(dir, `${color}.${ext}`))) {
        name = `${color}.${ext}`;
        break;
      }
    }
    if (!name) {
      name = `${color}.svg`;
      fs.writeFileSync(path.join(dir, name), renderSvgFor(p.kind, color), 'utf8');
    }
    files.push({
      url: `/assets/products/${productId}/${name}`,
      alt_text: `${p.name} (${color})`,
      position: color === 'black' ? 0 : 1,
    });
  }
  return files;
}

async function replaceImageRows(client, productId, images) {
  await client.query(`DELETE FROM product_images WHERE product_id = $1`, [productId]);
  for (const img of images) {
    await client.query(
      `INSERT INTO product_images (product_id, url, position, alt_text)
       VALUES ($1, $2, $3, $4)`,
      [productId, img.url, img.position, img.alt_text]
    );
  }
}

async function seedVariants(productId, p) {
  const created = [];
  for (const color of COLORS) {
    for (const size of SIZES) {
      const sku = `${p.slug}-${color}-${size.toLowerCase()}`;
      const variant = await ProductVariant.upsertByAttrs({
        product_id: productId,
        sku,
        attributes: { color, size },
        price_isk: null,          // inherit from product
        price_eur: null,
        stock: STOCK_BY_SIZE[size] ?? 8,
        active: true,
      });
      created.push(variant);
    }
  }
  return created;
}

async function main() {
  // Parse flags. Default = idempotent-safe (prod-safe). --reset opts into
  // the destructive deactivate-everything-else behavior used on local dev.
  const args = process.argv.slice(2);
  const resetMode = args.includes('--reset');

  console.log(`[seed-shop] UPLOAD_ROOT = ${UPLOAD_ROOT}`);
  if (resetMode) {
    console.log('[seed-shop] ⚠️  --reset mode: will DEACTIVATE every product NOT in the defined lineup.');
    console.log('[seed-shop]               If this is prod, abort now (Ctrl+C).');
  } else {
    console.log('[seed-shop] safe mode: upserting defined products/variants only; other rows untouched.');
    console.log('[seed-shop]            (use --reset on dev to also deactivate products outside the lineup)');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (resetMode) {
      // Deactivate everything that is NOT in the defined lineup so previous
      // seeds (e.g. roof boxes) vanish from the shop. Destructive — only ever
      // run this on a dev DB or during an authorised product-line pivot.
      const keepSlugs = PRODUCTS.map(p => p.slug);
      const placeholders = keepSlugs.map((_, i) => `$${i + 1}`).join(',');
      await client.query(
        `UPDATE products SET active = FALSE WHERE slug NOT IN (${placeholders})`,
        keepSlugs
      );
      // Also deactivate all variants that belong to now-inactive products
      // (variants of apparel products get re-upserted with active=true below).
      await client.query(
        `UPDATE product_variants SET active = FALSE
          WHERE product_id IN (SELECT id FROM products WHERE active = FALSE)`
      );
    }

    for (const p of PRODUCTS) {
      const id = await upsertProduct(client, p);
      const images = await writeImages(id, p);
      await replaceImageRows(client, id, images);
      console.log(`[seed-shop] upserted product ${p.slug.padEnd(20)} id=${id}`);
    }

    await client.query('COMMIT');

    // Variants use the non-transactional model API (they upsert individually
    // — easier to read, and each variant insert is idempotent).
    for (const p of PRODUCTS) {
      const { rows } = await pool.query(`SELECT id FROM products WHERE slug = $1`, [p.slug]);
      const id = rows[0].id;
      const variants = await seedVariants(id, p);
      console.log(`[seed-shop] ${p.slug}: ${variants.length} variants (${SIZES.length}×${COLORS.length})`);
    }

    console.log(`[seed-shop] done — ${PRODUCTS.length} products, ${PRODUCTS.length * SIZES.length * COLORS.length} variants active.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[seed-shop] FAILED:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { PRODUCTS, SIZES, COLORS, tshirtSvg, sweatpantsSvg };
