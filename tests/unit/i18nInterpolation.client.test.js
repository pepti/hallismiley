'use strict';

/**
 * The client t() (public/js/i18n/i18n.js) inserts a {param} value literally:
 * `$&`, `` $` ``, `$'` and `$$` are String.replace replacement patterns, and a
 * name or a saved string carrying them must not be expanded (2026-09-23, the
 * same defect ssrMeta.js and server/i18n had). With no messages loaded, t()
 * falls back to the key itself, which is enough to exercise interpolation.
 */

const { t } = require('../../public/js/i18n/i18n.js');

test('a param value is inserted literally', () => {
  const v = "A $& B $` C $' D $$ E";
  expect(t('Hello {name}!', { name: v })).toBe(`Hello ${v}!`);
  expect(t('{a} and {a}', { a: '$$' })).toBe('$$ and $$');
});
