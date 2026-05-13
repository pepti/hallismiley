'use strict';
// Shared auto-translate helpers for `site_content` rows.
//
// `site_content` stores per-locale rows keyed by (key, locale). When an admin
// saves the EN row of a translatable key the IS row should follow — translated
// via the LLM-backed translator service, merged on top of any existing IS row
// so genuine manual translations are preserved.
//
// Two controllers need this behavior:
//   • contentController.putContent  — generic PUT /api/v1/content/:key
//   • partyController.updateInfo    — POST  /api/v1/party/info (bulk patch)
//
// Both used to (or in party's case, should) inline the same logic. Extracted
// here so the behavior — skip list, merge rules, background semantics — is
// defined exactly once and shared.

const db     = require('../config/database');
const { translateTree } = require('./translator');

// Keys on site_content that should NEVER auto-fill their IS sibling row
// (e.g. rows that are intentionally locale-neutral, like footer link lists
// or tech pills). Start small; extend if admins report noise.
//   party_hero — branded values ("HALLI'S", "40", "th") and a numeric
//   superscript don't translate cleanly; admins flip locale and edit IS by hand.
const SITE_CONTENT_TRANSLATE_SKIP = new Set(['party_hero']);

// Shallow-merge EN translations into an existing IS tree.
//
// A string leaf in the IS tree gets overwritten by its translated EN
// counterpart in any of these cases:
//
//   1. The IS leaf is null / undefined / empty — nothing to preserve.
//   2. The IS leaf is byte-identical to the corresponding ORIGINAL EN leaf
//      (sourceEn) — fingerprint of "stale-EN-as-IS" content (a row that
//      was seeded by copying EN to IS, or an inline-editor flow that
//      wrote EN text into the IS field). Replace with the proper
//      Icelandic translation.
//   3. The corresponding leaf in the PREVIOUS EN row (previousEn) was a
//      string AND it differs from the new sourceEn[k] — i.e. the admin
//      just edited that EN leaf. The user's stated intent is "EN is the
//      source of truth, IS auto-tracks", so changes to EN should always
//      flow through to IS, even when the IS leaf currently holds a stale
//      translation of the previous EN value (e.g. EN was "The Beginning"
//      → IS got "Upphafið"; EN now "Years of experience" → IS still
//      shows "Upphafið" without this rule).
//
// Anything else — IS differs from sourceEn AND EN didn't change — is
// treated as a genuine manual IS edit and left alone.
//
// Keys in the translator's BLOCK_KEYS list never appear in `translatedEn`
// because `translateTree` filters them out.
//
// Falls back to the translated EN tree when no IS row exists yet.
function mergeTranslatedTree(translatedEn, existingIs, sourceEn, previousEn) {
  if (existingIs === null || existingIs === undefined) return translatedEn;
  if (Array.isArray(translatedEn)) {
    if (!Array.isArray(existingIs)) return translatedEn;
    const srcArr = Array.isArray(sourceEn) ? sourceEn : null;
    const prevArr = Array.isArray(previousEn) ? previousEn : null;
    const out = existingIs.slice();
    for (let i = 0; i < translatedEn.length; i++) {
      const en = translatedEn[i];
      const is = out[i];
      const src = srcArr ? srcArr[i] : undefined;
      const prev = prevArr ? prevArr[i] : undefined;
      if (typeof en === 'string') {
        const isEmpty       = typeof is !== 'string' || is.trim() === '';
        const isStaleEnCopy = typeof is === 'string' && typeof src === 'string' && is === src;
        const enChanged     = typeof prev === 'string' && typeof src === 'string' && prev !== src;
        if (isEmpty || isStaleEnCopy || enChanged) out[i] = en;
      } else if (en && typeof en === 'object') {
        out[i] = mergeTranslatedTree(
          en,
          is && typeof is === 'object' ? is : null,
          src && typeof src === 'object' ? src : null,
          prev && typeof prev === 'object' ? prev : null,
        );
      } else if (is === undefined) {
        out[i] = en;
      }
    }
    return out;
  }
  if (translatedEn && typeof translatedEn === 'object') {
    if (!existingIs || typeof existingIs !== 'object') return translatedEn;
    const srcObj  = sourceEn   && typeof sourceEn   === 'object' && !Array.isArray(sourceEn)   ? sourceEn   : null;
    const prevObj = previousEn && typeof previousEn === 'object' && !Array.isArray(previousEn) ? previousEn : null;
    const out = { ...existingIs };
    for (const key of Object.keys(translatedEn)) {
      const en = translatedEn[key];
      const is = out[key];
      const src  = srcObj  ? srcObj[key]  : undefined;
      const prev = prevObj ? prevObj[key] : undefined;
      if (typeof en === 'string') {
        const isEmpty       = typeof is !== 'string' || is.trim() === '';
        const isStaleEnCopy = typeof is === 'string' && typeof src === 'string' && is === src;
        const enChanged     = typeof prev === 'string' && typeof src === 'string' && prev !== src;
        if (isEmpty || isStaleEnCopy || enChanged) out[key] = en;
      } else if (en && typeof en === 'object') {
        out[key] = mergeTranslatedTree(
          en,
          is && typeof is === 'object' ? is : null,
          src && typeof src === 'object' ? src : null,
          prev && typeof prev === 'object' ? prev : null,
        );
      } else if (is === undefined) {
        out[key] = en;
      }
    }
    return out;
  }
  return translatedEn;
}

// ── Auto-translate side effect ───────────────────────────────────────────────
// Translates `sourceEn` (the just-saved EN body) and merges into the IS row.
// Run in the background — never awaited from the request handler — so the
// browser does not sit on "Saving…" while the LLM works through dozens of
// nested string leaves on big jsonb keys like halli_bio.
//
// `previousEn` is the EN row's value BEFORE the just-completed upsert
// (or null if the EN row didn't exist yet). Passing it lets the merge
// detect "EN leaf changed since last save" and overwrite the stale
// IS translation that no longer matches the new EN.
async function runAutoTranslateSideEffect(key, sourceEn, previousEn, userId) {
  const translated = await translateTree(sourceEn);
  if (!translated) return;
  const { rows } = await db.query(
    `SELECT value FROM site_content WHERE key = $1 AND locale = $2`,
    [key, 'is']
  );
  const existingIs = rows[0] ? rows[0].value : null;
  const merged = mergeTranslatedTree(translated, existingIs, sourceEn, previousEn);
  await db.query(
    `INSERT INTO site_content (key, locale, value, updated_by, updated_at)
     VALUES ($1, 'is', $2::jsonb, $3, NOW())
     ON CONFLICT (key, locale) DO UPDATE
       SET value      = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
    [key, JSON.stringify(merged), userId]
  );
}

module.exports = {
  SITE_CONTENT_TRANSLATE_SKIP,
  mergeTranslatedTree,
  runAutoTranslateSideEffect,
};
