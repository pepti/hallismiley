#!/usr/bin/env node
'use strict';

/**
 * One-shot: re-translate the party page's ICELANDIC content into ENGLISH.
 *
 * The /party page is Icelandic-primary (see partyController.updateInfo): the IS
 * rows are the source of truth and EN auto-follows on save. But the on-save
 * merge deliberately preserves an existing EN leaf unless it is empty, is a
 * byte-identical copy of the IS source, or the IS leaf changed since the last
 * save. So when EN has simply gone STALE (e.g. it predates the Icelandic-first
 * flow), re-saving IS in the admin UI will NOT refresh it — this script does.
 *
 * It reads every translatable `party_*` IS row from site_content, translates
 * the whole jsonb tree IS → EN via server/services/translator, and OVERWRITES
 * the matching EN row. Structural keys (href/type/…) and code-shaped leaves are
 * preserved by translateTree exactly as in the live save path.
 *
 * SAFETY: dry-run by default — prints the current EN vs the proposed EN for
 * every key and writes NOTHING. Pass --write to persist.
 *
 * Required env:
 *   DATABASE_URL          (the target DB — e.g. production)
 *   ANTHROPIC_API_KEY     (any valid key)
 *   TRANSLATE_ENABLED=true
 *   TRANSLATE_MODEL=claude-haiku-4-5   (optional; matches prod default)
 *
 * Usage:
 *   node scripts/retranslate-party-en.js            # dry-run preview
 *   node scripts/retranslate-party-en.js --write    # apply
 */

const { Client } = require('pg');
const path = require('path');
const translator = require(path.join(__dirname, '..', 'server', 'services', 'translator'));

// Keep the translator's own pino logs quiet so the preview stays readable.
process.env.LOG_LEVEL = 'silent';

const WRITE = process.argv.includes('--write');

// Keys that the live party flow never auto-translates, so we don't either:
//   party_hero       — branded/numeric values (SITE_CONTENT_TRANSLATE_SKIP).
//   party_activities — locale-neutral (stored once at DEFAULT_LOCALE).
const SKIP_KEYS = new Set(['party_hero', 'party_activities']);

// User-facing account for updated_by. Null keeps the row's authorship blank
// rather than attributing a machine backfill to a real admin id.
const UPDATED_BY = null;

function preview(v, n = 200) {
  if (v == null) return '∅';
  const flat = (typeof v === 'string' ? v : JSON.stringify(v)).replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat;
}

async function main() {
  if (!translator.isEnabled()) {
    console.error('✗ translator disabled: set TRANSLATE_ENABLED=true and ANTHROPIC_API_KEY');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL is not set — point it at the target database.');
    process.exit(1);
  }

  console.log(`\n=== Re-translate party IS → EN  (${WRITE ? 'WRITE' : 'DRY-RUN — no changes'}) ===\n`);

  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  });
  await c.connect();

  const totals = { rows: 0, translated: 0, written: 0, skipped: 0, failed: 0 };

  try {
    // Every party IS row that holds a structured jsonb value. Plain-string
    // leaves (venue_name etc.) are left alone — translateTree only walks
    // objects/arrays, matching the live save path exactly.
    const { rows } = await c.query(
      `SELECT key, value FROM site_content
        WHERE locale = 'is' AND key LIKE 'party_%'
        ORDER BY key`
    );

    for (const row of rows) {
      totals.rows += 1;
      if (SKIP_KEYS.has(row.key)) {
        totals.skipped += 1;
        console.log(`[skip] ${row.key} (never auto-translated)`);
        continue;
      }
      if (!row.value || typeof row.value !== 'object') {
        totals.skipped += 1;
        console.log(`[skip] ${row.key} (plain value — not tree-translated)`);
        continue;
      }

      const translated = await translator.translateTree(row.value, {
        sourceLocale: 'is',
        targetLocale: 'en',
      });
      if (!translated) {
        totals.failed += 1;
        console.log(`  ✗ ${row.key}: translateTree returned null`);
        continue;
      }
      totals.translated += 1;

      const existing = await c.query(
        `SELECT value FROM site_content WHERE key = $1 AND locale = 'en'`,
        [row.key]
      );
      const currentEn = existing.rows[0] ? existing.rows[0].value : null;

      console.log(`\n• ${row.key}`);
      console.log(`    IS source : ${preview(row.value)}`);
      console.log(`    EN before : ${preview(currentEn)}`);
      console.log(`    EN after  : ${preview(translated)}`);

      if (WRITE) {
        await c.query(
          `INSERT INTO site_content (key, locale, value, updated_by, updated_at)
           VALUES ($1, 'en', $2::jsonb, $3, NOW())
           ON CONFLICT (key, locale) DO UPDATE
             SET value      = EXCLUDED.value,
                 updated_by = EXCLUDED.updated_by,
                 updated_at = NOW()`,
          [row.key, JSON.stringify(translated), UPDATED_BY]
        );
        totals.written += 1;
        console.log('    → written');
      }
    }
  } finally {
    await c.end();
  }

  console.log(
    `\n=== summary === rows:${totals.rows} translated:${totals.translated} ` +
    `written:${totals.written} skipped:${totals.skipped} failed:${totals.failed}`
  );
  if (!WRITE && totals.translated > 0) {
    console.log('\nDry-run only. Re-run with --write to apply the EN rows above.');
  }
  process.exit(totals.failed > 0 ? 2 : 0);
}

main().catch(err => {
  console.error('fatal:', err);
  process.exit(1);
});
