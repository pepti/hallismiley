// Generic product CSV importer — upserts products by slug from a simple CSV.
// NOT Shopify-specific: a plain header row mapped onto this site's product
// columns. Re-runnable (existing slugs are updated, new ones created).
//
// Usage:
//   node server/scripts/import-products-csv.js <file.csv> [--dry-run]
//   npm run import:csv -- data/products.csv
//
// CSV header row (column order doesn't matter; extra columns ignored):
//   slug,name,name_is,description,description_is,price_isk,price_eur,stock,sku,barcode,category,active
// Required per row: slug, name, price_isk, price_eur (positive integers — ISK
// whole krónur, EUR cents). `active` accepts true/1/yes (default true).
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs   = require('fs');
const { parse } = require('csv-parse/sync');
const { pool } = require('../config/database');
const Product = require('../models/Product');

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,80}[a-z0-9])?$/;
const truthy  = (v) => v === undefined || v === '' ? true : /^(true|1|yes)$/i.test(String(v));

async function main() {
  const file   = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!file) {
    console.error('Usage: node server/scripts/import-products-csv.js <file.csv> [--dry-run]');
    process.exit(1);
  }

  const raw  = fs.readFileSync(file, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

  let created = 0, updated = 0, skipped = 0;
  const errors = [];

  for (const [i, row] of rows.entries()) {
    const line     = i + 2; // 1-based + header row
    const slug     = (row.slug || '').trim();
    const name     = (row.name || '').trim();
    const priceIsk = Number(row.price_isk);
    const priceEur = Number(row.price_eur);

    if (!SLUG_RE.test(slug))                          { errors.push(`Line ${line}: invalid slug "${slug}"`); skipped++; continue; }
    if (!name)                                        { errors.push(`Line ${line}: missing name`);            skipped++; continue; }
    if (!Number.isInteger(priceIsk) || priceIsk <= 0) { errors.push(`Line ${line}: invalid price_isk`);       skipped++; continue; }
    if (!Number.isInteger(priceEur) || priceEur <= 0) { errors.push(`Line ${line}: invalid price_eur`);       skipped++; continue; }

    const data = {
      slug, name,
      name_is:        row.name_is || null,
      description:    row.description || '',
      description_is: row.description_is || null,
      price_isk:      priceIsk,
      price_eur:      priceEur,
      stock:          row.stock ? Number(row.stock) : 0,
      sku:            row.sku || null,
      barcode:        row.barcode || null,
      category:       row.category || null,
      active:         truthy(row.active),
    };

    if (dryRun) { console.log(`[dry-run] would upsert ${slug}`); continue; }

    const existing = await Product.findBySlug(slug, { activeOnly: false });
    if (existing) { await Product.update(existing.id, data); updated++; console.log(`updated  ${slug}`); }
    else          { await Product.create(data);              created++; console.log(`created  ${slug}`); }
  }

  console.log(`\nDone. created=${created} updated=${updated} skipped=${skipped}`);
  if (errors.length) console.log('Errors:\n  ' + errors.join('\n  '));

  await pool.end();
  process.exit(errors.length && !created && !updated ? 1 : 0);
}

main().catch((err) => { console.error('Import failed:', err); process.exit(1); });
