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

// Shallow-merge machine translations into an existing target-locale tree.
//
// Direction-neutral: `source`/`previousSource` are in the source locale,
// `translatedTarget`/`existingTarget` in the target locale. Generic site
// content runs EN (source) → IS (target); the party page runs IS → EN.
//
// A string leaf in the existing target tree gets overwritten by its freshly
// translated counterpart in any of these cases:
//
//   1. The target leaf is null / undefined / empty — nothing to preserve.
//   2. The target leaf is byte-identical to the corresponding ORIGINAL source
//      leaf (`source`) — fingerprint of "stale-source-as-target" content (a
//      row seeded by copying source into target, or an inline-editor flow that
//      wrote source text into the target field). Replace with the real
//      translation.
//   3. The corresponding leaf in the PREVIOUS source row (`previousSource`)
//      was a string AND it differs from the new `source[k]` — i.e. the admin
//      just edited that source leaf. The stated intent is "source is the
//      source of truth, target auto-tracks", so source changes should always
//      flow through to target, even when the target leaf currently holds a
//      stale translation of the previous source value (e.g. IS was "Upphafið"
//      → EN got "The Beginning"; IS now "Ár af reynslu" → EN still shows
//      "The Beginning" without this rule).
//
// Anything else — target differs from source AND source didn't change — is
// treated as a genuine manual target edit and left alone.
//
// Keys in the translator's BLOCK_KEYS list never appear in `translatedTarget`
// because `translateTree` filters them out.
//
// Falls back to the translated tree when no target row exists yet.
function mergeTranslatedTree(translatedTarget, existingTarget, source, previousSource) {
  if (existingTarget === null || existingTarget === undefined) return translatedTarget;
  if (Array.isArray(translatedTarget)) {
    if (!Array.isArray(existingTarget)) return translatedTarget;
    const srcArr = Array.isArray(source) ? source : null;
    const prevArr = Array.isArray(previousSource) ? previousSource : null;
    const out = existingTarget.slice();
    for (let i = 0; i < translatedTarget.length; i++) {
      const tr = translatedTarget[i];
      const ex = out[i];
      const src = srcArr ? srcArr[i] : undefined;
      const prev = prevArr ? prevArr[i] : undefined;
      if (typeof tr === 'string') {
        const isEmpty         = typeof ex !== 'string' || ex.trim() === '';
        const isStaleSrcCopy  = typeof ex === 'string' && typeof src === 'string' && ex === src;
        const sourceChanged   = typeof prev === 'string' && typeof src === 'string' && prev !== src;
        if (isEmpty || isStaleSrcCopy || sourceChanged) out[i] = tr;
      } else if (tr && typeof tr === 'object') {
        out[i] = mergeTranslatedTree(
          tr,
          ex && typeof ex === 'object' ? ex : null,
          src && typeof src === 'object' ? src : null,
          prev && typeof prev === 'object' ? prev : null,
        );
      } else if (ex === undefined) {
        out[i] = tr;
      }
    }
    return out;
  }
  if (translatedTarget && typeof translatedTarget === 'object') {
    if (!existingTarget || typeof existingTarget !== 'object') return translatedTarget;
    const srcObj  = source         && typeof source         === 'object' && !Array.isArray(source)         ? source         : null;
    const prevObj = previousSource && typeof previousSource === 'object' && !Array.isArray(previousSource) ? previousSource : null;
    const out = { ...existingTarget };
    for (const key of Object.keys(translatedTarget)) {
      const tr = translatedTarget[key];
      const ex = out[key];
      const src  = srcObj  ? srcObj[key]  : undefined;
      const prev = prevObj ? prevObj[key] : undefined;
      if (typeof tr === 'string') {
        const isEmpty         = typeof ex !== 'string' || ex.trim() === '';
        const isStaleSrcCopy  = typeof ex === 'string' && typeof src === 'string' && ex === src;
        const sourceChanged   = typeof prev === 'string' && typeof src === 'string' && prev !== src;
        if (isEmpty || isStaleSrcCopy || sourceChanged) out[key] = tr;
      } else if (tr && typeof tr === 'object') {
        out[key] = mergeTranslatedTree(
          tr,
          ex && typeof ex === 'object' ? ex : null,
          src && typeof src === 'object' ? src : null,
          prev && typeof prev === 'object' ? prev : null,
        );
      } else if (ex === undefined) {
        out[key] = tr;
      }
    }
    return out;
  }
  return translatedTarget;
}

// ── Auto-translate side effect ───────────────────────────────────────────────
// Translates `sourceEn` (the just-saved EN body) and merges into the IS row.
// Run in the background — never awaited from the request handler — so the
// browser does not sit on "Saving…" while the LLM works through dozens of
// nested string leaves on big jsonb keys like halli_bio.
//
// `previousSource` is the SOURCE-locale row's value BEFORE the just-completed
// upsert (or null if that row didn't exist yet). Passing it lets the merge
// detect "source leaf changed since last save" and overwrite the stale
// target translation that no longer matches the new source.
//
// Direction is configurable via `opts.from` / `opts.to` and defaults to the
// historical EN → IS flow used by generic site content. The party page passes
// { from: 'is', to: 'en' } so Icelandic is the source of truth and English
// auto-tracks it. Only the source→target direction runs a side effect; a save
// on the target locale never touches the source row.
async function runAutoTranslateSideEffect(key, source, previousSource, userId, opts = {}) {
  const from = opts.from || 'en';
  const to   = opts.to   || 'is';
  const translated = await translateTree(source, { sourceLocale: from, targetLocale: to });
  if (!translated) return;
  const { rows } = await db.query(
    `SELECT value FROM site_content WHERE key = $1 AND locale = $2`,
    [key, to]
  );
  const existingTarget = rows[0] ? rows[0].value : null;
  const merged = mergeTranslatedTree(translated, existingTarget, source, previousSource);
  await db.query(
    `INSERT INTO site_content (key, locale, value, updated_by, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, NOW())
     ON CONFLICT (key, locale) DO UPDATE
       SET value      = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
    [key, to, JSON.stringify(merged), userId]
  );
}

module.exports = {
  SITE_CONTENT_TRANSLATE_SKIP,
  mergeTranslatedTree,
  runAutoTranslateSideEffect,
};
