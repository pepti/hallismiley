/**
 * The two-array migration list (stack invariant #4, D-021).
 *
 * server/config/migrationSet.js hands the runner `[...engine, ...legacy,
 * ...product]`. The engine array (schema.js) is authored upstream and arrives
 * by merge; the product file (product-migrations/<id>.js) is this repo's own.
 * Names are the runner's identity, so the two must never collide, and the
 * naming convention is what keeps them apart across every repo in the estate:
 * engine names are NNN_snake, product names are <id>_NNN_snake, legacy names
 * are the pre-split unprefixed names and are frozen.
 *
 * One assertion per rule over a set difference, so a failure names every
 * offender at once. The product id is pinned to engine.json so a product file
 * copied from another repo cannot pass.
 */
const path = require('path');
const set = require('../../server/config/migrationSet');
const engineJson = require('../../engine.json');

const PRODUCT_IDS = ['os', 'hs', 'rk', 'll', 'ice'];
const ENGINE_NAME = /^\d{3}_[a-z0-9_]+$/;
const LEGACY_NAME = /^\d{3}_[a-z0-9_]+$/;
const productName = (id) => new RegExp(`^${id}_\\d{3}_[a-z0-9_]+$`);

const names = (arr) => arr.map(m => m.name);
const dupes = (arr) => arr.filter((n, i) => arr.indexOf(n) !== i);

describe('migrationSet — engine + product arrays', () => {
  test('product id comes from engine.json and the product file agrees', () => {
    expect(set.productId).toBe(engineJson.product);
    expect(set.product.product).toBe(engineJson.product);
    expect(PRODUCT_IDS).toContain(set.productId);
  });

  test('the runner list is exactly engine, then legacy, then product', () => {
    expect(names(set.migrations)).toEqual([
      ...names(set.engine), ...names(set.legacy), ...names(set.product.migrations || []),
    ]);
  });

  test('names are unique across all three arrays', () => {
    expect(dupes(names(set.migrations))).toEqual([]);
  });

  test('engine names are NNN_snake and never carry a product prefix', () => {
    const bad = names(set.engine).filter(n => !ENGINE_NAME.test(n));
    expect(bad).toEqual([]);
    const prefixed = names(set.engine).filter(n => PRODUCT_IDS.some(id => n.startsWith(`${id}_`)));
    expect(prefixed).toEqual([]);
  });

  test('engine numbers are strictly increasing (append-only)', () => {
    const nums = names(set.engine).map(n => Number(n.slice(0, 3)));
    const out = nums.filter((n, i) => i > 0 && n <= nums[i - 1]).map(n => String(n).padStart(3, '0'));
    expect(out).toEqual([]);
  });

  test('legacy names are unprefixed NNN_snake (frozen pre-split names)', () => {
    const bad = names(set.legacy).filter(n => !LEGACY_NAME.test(n));
    expect(bad).toEqual([]);
  });

  test('new product names are <id>_NNN_snake, numbered from 001 without gaps', () => {
    const own = names(set.product.migrations || []);
    const re = productName(set.productId);
    expect(own.filter(n => !re.test(n))).toEqual([]);
    const nums = own.map(n => Number(n.slice(set.productId.length + 1, set.productId.length + 4)));
    expect(nums).toEqual(nums.map((_, i) => i + 1));
  });

  test('every entry has a name and a non-empty list of SQL strings', () => {
    const bad = set.migrations
      .filter(m => !m || typeof m.name !== 'string' || !Array.isArray(m.statements)
        || m.statements.length === 0 || m.statements.some(s => typeof s !== 'string' || !s.trim()))
      .map(m => (m && m.name) || '<unnamed>');
    expect(bad).toEqual([]);
  });

  test('alias and superseded keys are engine names; their values name nothing in any array', () => {
    const engineNames = new Set(names(set.engine));
    const all = new Set(names(set.migrations));
    const aliasKeys = Object.keys(set.aliases);
    const supKeys = Object.keys(set.superseded);

    expect(aliasKeys.filter(k => !engineNames.has(k))).toEqual([]);
    expect(supKeys.filter(k => !engineNames.has(k))).toEqual([]);
    expect(aliasKeys.filter(k => supKeys.includes(k))).toEqual([]);

    const aliasValues = aliasKeys.flatMap(k => set.aliases[k]);
    expect(aliasValues.filter(v => typeof v !== 'string' || all.has(v))).toEqual([]);
    expect(supKeys.filter(k => typeof set.superseded[k] !== 'string' || !set.superseded[k].trim())).toEqual([]);
  });

  test('the product file lives at product-migrations/<id>.js', () => {
    const resolved = require.resolve(`../../server/config/product-migrations/${set.productId}.js`);
    expect(path.basename(resolved)).toBe(`${set.productId}.js`);
  });
});

// Repo-specific pins. The engine repo's own product file carries exactly the
// three company-content migrations that were moved out of the engine array on
// 2026-09-22; legacy is frozen, so this list never grows.
if (engineJson.product === 'os') {
  describe('orangesmiley product file (os)', () => {
    test('legacy holds the three company-content migrations and nothing else', () => {
      expect(names(set.legacy)).toEqual([
        '091_home_content_company',
        '092_contact_content_company',
        '104_sales_guides_services_page',
      ]);
    });

    test('the engine array no longer carries them', () => {
      const engineNames = names(set.engine);
      expect(engineNames.filter(n => /^(091|092|104)_/.test(n))).toEqual([]);
    });

    test('the engine has no aliases or superseded entries', () => {
      expect(set.aliases).toEqual({});
      expect(set.superseded).toEqual({});
    });
  });
}
