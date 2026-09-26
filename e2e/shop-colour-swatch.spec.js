// Storefront product page — the colour swatch → photo swap.
//
// Ported from icelandicstore #273 (ice@941cf51d; harvest 2 lane 6c,
// 2026-09-26). Engine deltas: the fixture is created here in beforeAll (the
// engine keeps no global e2e product fixture), the photos are committed
// Iceland renditions, and the page is opened with page.goto + networkidle.
//
// WHY THIS FILE EXISTS. On icelandicstore the swatch/photo pairing shipped
// BROKEN to PROD with a fully green Jest suite: the match was done in the
// browser and failed on the supplier spellings the real catalogue carries
// ("French Navy (FRNA)" against a photo tagged `navy`). The match now lives in
// server/utils/colorMatch.js and reaches the SPA as `product.color_images`;
// unit + integration tests cover that half. This spec covers the browser code
// that consumes the map — a typo there passes every other test and ships.
//
// Fixture: three colours spelled the PROD way, of which two have a tagged
// photo (one exact, one containment) and one has none, plus an untagged
// lifestyle shot at position 0 so "left the gallery alone" and "fell back to
// images[0]" are distinguishable. Expectations are read from the API.
const { test, expect } = require('@playwright/test');
const { gateSpec } = require('./lib/featureGate');
gateSpec(test, __filename);
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./lib/dbUrl');
// The one definition of how a colour value folds to a key, shared with the
// server and mirrored by the SPA — a local copy here would be a third.
const { axisKey, colorKey } = require('../server/utils/variantAxis');

const COLOUR_SLUG = 'e2e-colour-tee';   // variant_axes ['Color'], per-colour photos
const SIZE_SLUG   = 'e2e-size-tee';     // variant_axes ['size'], no colour axis
const IMG = {
  plain: '/assets/iceland/black-beach-480.3dafbaa2.jpg',
  black: '/assets/iceland/basalt-canyon-480.b02ba959.jpg',
  navy:  '/assets/iceland/glacier-tongue-480.7fc98aee.jpg',
};

test.describe('Product page — colour swatch drives the photo', () => {
  test.beforeAll(async () => {
    const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
    try {
      await pool.query('DELETE FROM products WHERE slug = ANY($1)', [[COLOUR_SLUG, SIZE_SLUG]]);
      const { rows: [tee] } = await pool.query(
        `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, category, variant_axes, active)
         VALUES ($1, 'E2E Colour Tee', '', 3990, 2700, 0, 'product', '["Color"]'::jsonb, TRUE) RETURNING id`, [COLOUR_SLUG]);
      for (const [pos, url, color] of [[0, IMG.plain, null], [1, IMG.black, 'black'], [2, IMG.navy, 'navy']]) {
        await pool.query('INSERT INTO product_images (product_id, url, position, color) VALUES ($1, $2, $3, $4)', [tee.id, url, pos, color]);
      }
      for (const [sku, color] of [['E2E-COL-BLK', 'Black'], ['E2E-COL-FNV', 'French Navy (FRNA)'], ['E2E-COL-SAG', 'Sage Green (SAG)']]) {
        await pool.query(
          `INSERT INTO product_variants (product_id, sku, attributes, stock, active) VALUES ($1, $2, $3::jsonb, 50, TRUE)`,
          [tee.id, sku, JSON.stringify({ Color: color })]);
      }
      const { rows: [sz] } = await pool.query(
        `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, category, variant_axes, active)
         VALUES ($1, 'E2E Size Tee', '', 2990, 2000, 0, 'product', '["size"]'::jsonb, TRUE) RETURNING id`, [SIZE_SLUG]);
      for (const size of ['M', 'S']) {
        await pool.query(
          `INSERT INTO product_variants (product_id, sku, attributes, stock, active) VALUES ($1, $2, $3::jsonb, 50, TRUE)`,
          [sz.id, `E2E-SZ-${size}`, JSON.stringify({ size })]);
      }
    } finally { await pool.end(); }
  });

  test.afterAll(async () => {
    const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
    try { await pool.query('DELETE FROM products WHERE slug = ANY($1)', [[COLOUR_SLUG, SIZE_SLUG]]); }
    finally { await pool.end(); }
  });

  const cover  = (page) => page.locator('#shop-cover img');
  const thumbs = (page) => page.locator('#shop-thumbs [data-idx]');
  const swatch = (page, axis, value) => page.locator(`[data-testid="variant-${axis}-${value}"]`);

  async function fetchProduct(page, slug) {
    const res = await page.request.get(`/api/v1/shop/products/${encodeURIComponent(slug)}`);
    expect(res.ok(), `GET /api/v1/shop/products/${slug} -> ${res.status()}`).toBeTruthy();
    return (await res.json()).product;
  }
  const colourAxisOf = (product) => (product.variant_axes || []).find(a => axisKey(a) === 'color') || null;

  // Every distinct colour, resolved through `color_images` to the photo the
  // SERVER matched: { value, key, url, idx } (url/idx null when none).
  function coloursOf(product, axis) {
    const images = product.images || [];
    const seen = new Set();
    const out = [];
    for (const v of product.variants || []) {
      if (v.active === false) continue;
      const value = v.attributes?.[axis];
      const key = colorKey(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const imageId = (product.color_images || {})[key];
      const idx = imageId == null ? -1 : images.findIndex(img => img.id === imageId);
      out.push({ value, key, url: idx === -1 ? null : images[idx].url, idx: idx === -1 ? null : idx });
    }
    return out;
  }

  async function open(page, slug) {
    await page.goto(`/is/shop/${slug}`);
    await page.waitForLoadState('networkidle');
  }

  test('swatch click swaps the cover photo and moves the active thumbnail', async ({ page }) => {
    const product = await fetchProduct(page, COLOUR_SLUG);
    const axis = colourAxisOf(product);
    expect(axis).toBeTruthy();
    const colours = coloursOf(product, axis);
    const mapped = colours.filter(c => c.url);
    expect(mapped.length, 'the server must map at least two colours').toBeGreaterThanOrEqual(2);
    expect(mapped.some(c => c.idx !== 0), 'a mapped photo must sit somewhere other than images[0]').toBeTruthy();

    await open(page, COLOUR_SLUG);
    await expect(page.locator('.shop-product__swatches .shop-product__swatch')).toHaveCount(colours.length);

    // The page opens on the photo of the colour it pre-selects.
    const pressed = page.locator('.shop-product__swatch[aria-pressed="true"]');
    await expect(pressed).toHaveCount(1);
    const openValue = await pressed.getAttribute('data-value');
    const opened = colours.find(c => c.value === openValue);
    expect(opened && opened.url, 'the pre-selected colour should have a photo').toBeTruthy();
    await expect(cover(page)).toHaveAttribute('src', opened.url);

    // A DIFFERENT mapped colour — on the fixture the containment match,
    // "French Navy (FRNA)" against a photo tagged `navy`.
    const target = mapped.find(c => c.value !== openValue);
    await swatch(page, axis, target.value).click();
    await expect(cover(page)).toHaveAttribute('src', target.url);
    await expect(thumbs(page).nth(target.idx)).toHaveClass(/\bactive\b/);
    await expect(page.locator('#shop-thumbs .active')).toHaveCount(1);

    // Click BACK: every click repaints the swatch row and re-binds its
    // handler, so the second click travels through a different call site.
    await swatch(page, axis, openValue).click();
    await expect(cover(page)).toHaveAttribute('src', opened.url);
    await expect(thumbs(page).nth(opened.idx)).toHaveClass(/\bactive\b/);
  });

  test('a colour with no tagged photo leaves the gallery exactly where it was', async ({ page }) => {
    const pageErrors = [];
    const badAssets = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('response', r => {
      if (r.status() >= 400 && new URL(r.url()).pathname.startsWith('/assets/iceland/')) badAssets.push(r.url());
    });

    const product = await fetchProduct(page, COLOUR_SLUG);
    const axis = colourAxisOf(product);
    const colours = coloursOf(product, axis);
    const mapped = colours.filter(c => c.url);
    const unmapped = colours.filter(c => !c.url);
    expect(unmapped.length, 'the fixture must carry a colour with no photo').toBeGreaterThanOrEqual(1);

    await open(page, COLOUR_SLUG);
    const openValue = await page.locator('.shop-product__swatch[aria-pressed="true"]').getAttribute('data-value');
    const anchor = mapped.find(c => c.value !== openValue && c.idx !== 0);
    expect(anchor, 'need a mapped colour that is neither pre-selected nor images[0]').toBeTruthy();
    await swatch(page, axis, anchor.value).click();
    await expect(cover(page)).toHaveAttribute('src', anchor.url);

    await swatch(page, axis, unmapped[0].value).click();
    // Declining to match a photo is not declining to select the variant.
    await expect(swatch(page, axis, unmapped[0].value)).toHaveAttribute('aria-pressed', 'true');
    // A swap commits ~140 ms after the decode: wait past that, then assert.
    await page.waitForTimeout(600);
    await expect(cover(page)).toHaveAttribute('src', anchor.url);
    await expect(thumbs(page).nth(anchor.idx)).toHaveClass(/\bactive\b/);
    expect(pageErrors).toEqual([]);
    expect(badAssets, 'every fixture photo must load; a 404 would fake this test').toEqual([]);
  });

  test('the colour is named beside the heading, without its supplier code', async ({ page }) => {
    await open(page, COLOUR_SLUG);
    await page.locator('[data-testid="variant-Color-French Navy (FRNA)"]').click();
    await expect(page.locator('.shop-product__variant-value')).not.toContainText('FRNA');
  });

  test('a product with no colour axis renders chips in size order and no swatches', async ({ page }) => {
    const product = await fetchProduct(page, SIZE_SLUG);
    expect(colourAxisOf(product)).toBeNull();
    await open(page, SIZE_SLUG);
    const chips = page.locator('.shop-product__variant-chip');
    await expect(chips.first()).toBeVisible();
    // S before M (utils/variantArrange.js), whatever order the rows came in.
    await expect(chips).toHaveText(['S', 'M']);
    await expect(page.locator('.shop-product__swatch')).toHaveCount(0);
    await expect(page.locator('.shop-product__swatches')).toHaveCount(0);
  });
});
