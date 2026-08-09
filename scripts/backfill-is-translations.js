#!/usr/bin/env node
'use strict';

/**
 * One-shot: translate all NULL/blank `_is` columns from their EN counterparts
 * across news_articles / products / projects / project_sections /
 * project_media / project_videos.
 *
 * Reuses server/services/translator.js — same prompt, same model, same
 * preservation rules as the live save path. Idempotent: only fills rows
 * where IS is NULL or empty AND EN is non-empty. Never overwrites manual IS.
 *
 * Required env:
 *   DATABASE_URL          (prod connection string)
 *   ANTHROPIC_API_KEY     (any valid key)
 *   TRANSLATE_ENABLED=true
 *   TRANSLATE_MODEL=claude-haiku-4-5  (optional; matches prod default)
 */

const { Client } = require('pg');
const path = require('path');
const translator = require(path.join(__dirname, '..', 'server', 'services', 'translator'));

// Suppress pino logs from the translator service so progress output stays
// readable. The translator's internal error handling (return null on fail)
// is unaffected.
process.env.LOG_LEVEL = 'silent';

const TASKS = [
  // [table, primary_key, en_col, is_col, format]
  ['news_articles',    'id', 'title',       'title_is',       'plain'],
  ['news_articles',    'id', 'summary',     'summary_is',     'plain'],
  ['news_articles',    'id', 'body',        'body_is',        'markdown'],
  ['products',         'id', 'name',        'name_is',        'plain'],
  ['products',         'id', 'description', 'description_is', 'markdown'],
  ['projects',         'id', 'title',       'title_is',       'plain'],
  ['projects',         'id', 'description', 'description_is', 'markdown'],
  ['project_sections', 'id', 'name',        'name_is',        'plain'],
  ['project_sections', 'id', 'description', 'description_is', 'markdown'],
  ['project_media',    'id', 'caption',     'caption_is',     'plain'],
  ['project_videos',   'id', 'title',       'title_is',       'plain'],
];

function preview(s, n = 80) {
  if (s == null) return '∅';
  const flat = String(s).replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat;
}

async function main() {
  if (!translator.isEnabled()) {
    console.error('translator disabled: set TRANSLATE_ENABLED=true and ANTHROPIC_API_KEY');
    process.exit(1);
  }

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  let totals = { rows: 0, ok: 0, failed: 0, skipped: 0 };

  for (const [table, pk, enCol, isCol, format] of TASKS) {
    const sql = `SELECT ${pk} AS id, ${enCol} AS en
                 FROM ${table}
                 WHERE ${enCol} IS NOT NULL
                   AND TRIM(${enCol}::text) <> ''
                   AND (${isCol} IS NULL OR TRIM(${isCol}::text) = '')
                 ORDER BY ${pk}`;
    const { rows } = await c.query(sql);
    if (rows.length === 0) {
      console.log(`[skip] ${table}.${enCol} → ${isCol}: no rows`);
      continue;
    }
    console.log(`\n=== ${table}.${enCol} → ${isCol} (${format}) — ${rows.length} rows ===`);

    for (const row of rows) {
      totals.rows += 1;
      const tag = `${table}#${row.id} ${enCol}`;
      try {
        const translated = await translator.translate({
          text: row.en,
          format,
          targetLocale: 'is',
        });
        if (!translated) {
          totals.failed += 1;
          console.log(`  ✗ ${tag}: translator returned null`);
          continue;
        }
        await c.query(
          `UPDATE ${table} SET ${isCol} = $1 WHERE ${pk} = $2`,
          [translated, row.id],
        );
        totals.ok += 1;
        console.log(`  ✓ ${tag}: "${preview(row.en, 50)}"`);
        console.log(`    → "${preview(translated, 70)}"`);
      } catch (err) {
        totals.failed += 1;
        console.log(`  ✗ ${tag}: ${err.message}`);
      }
    }
  }

  await c.end();
  console.log(`\n=== summary === rows:${totals.rows} ok:${totals.ok} failed:${totals.failed}`);
  process.exit(totals.failed > 0 ? 2 : 0);
}

main().catch(err => {
  console.error('fatal:', err);
  process.exit(1);
});
