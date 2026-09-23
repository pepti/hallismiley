// The one migration list the runner applies: engine array + this product's
// array, in that order (stack invariant #4, D-021).
//
//   engine   server/config/schema.js — authored in the upstream repo
//            (orangesmiley) only; a downstream receives it by merge and never
//            appends to it. Names are NNN_snake.
//   product  server/config/product-migrations/<id>.js — owned by this repo.
//            `legacy` keeps the entries applied under pre-split names (frozen);
//            `migrations` holds new <id>_NNN_snake entries; `aliases` and
//            `superseded` tell the runner which engine names this product's
//            databases already satisfy under another name, or must never run.
//
// Product entries come after engine entries so a product migration may build
// on engine tables; the reverse dependency is forbidden. On a database where
// old product migrations were applied before new engine ones the order of the
// already-applied entries is irrelevant — the runner skips by name.
//
// The product id comes from engine.json at the repo root; the product file
// must declare the same id, so a mis-copied file fails at require time rather
// than applying another product's migrations.
const path = require('path');
const { migrations: engine } = require('./schema');

const engineJson = require(path.join(__dirname, '..', '..', 'engine.json'));
const productId = engineJson.product;
if (typeof productId !== 'string' || !/^[a-z][a-z0-9]{1,7}$/.test(productId)) {
  throw new Error(`engine.json "product" must be a short lowercase id, got ${JSON.stringify(productId)}`);
}

const product = require(`./product-migrations/${productId}.js`);
if (product.product !== productId) {
  throw new Error(`product-migrations/${productId}.js declares product "${product.product}", engine.json says "${productId}"`);
}

const legacy = product.legacy || [];
const own = product.migrations || [];
const aliases = product.aliases || {};
const superseded = product.superseded || {};

const migrations = [...engine, ...legacy, ...own];

module.exports = { engine, product, legacy, migrations, aliases, superseded, productId };
