'use strict';

/**
 * Per-save helper that auto-populates empty `_is` fields from their EN
 * counterparts via the translator service. Called at the top of admin
 * controllers (news, project, product, etc.) BEFORE validation.
 *
 * Contract:
 *   - Only fills IS fields that are null/undefined/blank-string on the
 *     inbound body AND on the existing DB row (if any). If the admin
 *     typed an IS value themselves, it is preserved.
 *   - Honours a per-request opt-out: `body.__autoTranslate === false`
 *     skips everything. The flag is stripped from `body` before return
 *     so it never reaches the validator or SQL.
 *   - Swallows translator failures silently — the EN save proceeds and
 *     the IS column stays null (falls back to EN on read via COALESCE).
 *
 * Signature:
 *   autoTranslateFields(body, fieldPairs, { existingRow }) -> Promise<void>
 *     fieldPairs: Array<[enKey, isKey, format]>
 *       - enKey:   field name on `body` holding the English string
 *       - isKey:   sibling IS field name (e.g. 'title_is')
 *       - format:  'plain' | 'markdown' (passed through to translator)
 *     existingRow: optional record as currently stored in the DB, used
 *                  to avoid overwriting IS content on PATCH when the
 *                  admin simply omits `*_is` from the payload.
 */

const { translate, isEnabled } = require('./translator');

function isBlank(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function consumeFlag(body) {
  if (body && Object.prototype.hasOwnProperty.call(body, '__autoTranslate')) {
    const v = body.__autoTranslate;
    delete body.__autoTranslate;
    return v !== false && v !== 'false' && v !== 0 && v !== '0';
  }
  return true; // default ON when unspecified
}

async function autoTranslateFields(body, fieldPairs, { existingRow } = {}) {
  const wantsTranslate = consumeFlag(body);
  if (!wantsTranslate) return;
  if (!isEnabled()) return;
  if (!body || typeof body !== 'object') return;
  if (!Array.isArray(fieldPairs) || fieldPairs.length === 0) return;

  for (const pair of fieldPairs) {
    const [enKey, isKey, format = 'plain'] = pair;

    const enValue = body[enKey];
    if (isBlank(enValue) || typeof enValue !== 'string') continue;

    // If the caller sent an IS value, respect it (including intentional
    // blank string — admin can clear an IS field on purpose).
    const bodyHasIsKey = Object.prototype.hasOwnProperty.call(body, isKey);
    if (bodyHasIsKey && !isBlank(body[isKey])) continue;

    // If body omits isKey AND the existing DB row already has IS content,
    // leave that content alone — admin isn't touching it this save.
    if (!bodyHasIsKey && existingRow && !isBlank(existingRow[isKey])) continue;

    // Also skip if the EN field itself is unchanged from the existing row
    // AND an IS value is already stored. This covers PATCH calls that
    // re-submit the same EN text without wanting re-translation.
    if (existingRow && !isBlank(existingRow[isKey]) && existingRow[enKey] === enValue) continue;

    try {
      const translated = await translate({ text: enValue, format });
      if (typeof translated === 'string' && translated.length > 0) {
        body[isKey] = translated;
      }
    } catch {
      // translate() never throws, but guard anyway — a failure here must
      // not block the controller.
    }
  }
}

module.exports = { autoTranslateFields };
