/**
 * public/js/utils/slug.js is the ESM twin of server/utils/slug.js — the
 * collections form proposes a slug client-side, the server generates news and
 * sales-guide slugs. This pins that the two stay identical in behaviour.
 * babel-jest compiles the ESM module to CJS for require() (see rateLimitGuard.client.test.js).
 */
const { foldSlug: clientFoldSlug } = require('../../public/js/utils/slug.js');
const { foldSlug: serverFoldSlug } = require('../../server/utils/slug');

describe('public/js/utils/slug.js mirrors server/utils/slug.js', () => {
  test.each([
    'Lopapeysa Þórs',
    'Þórsmörk',
    'Sölusagan',
    '  Hello,   World! — Post  ',
    'ÆÐISLEGT ÚRVAL – 50% AFSLÁTTUR',
    '!!!',
    Array.from({ length: 30 }, (_, i) => `ab${i}`).join(' '),
  ])('same output for %j', (input) => {
    expect(clientFoldSlug(input)).toBe(serverFoldSlug(input));
  });

  test('"Þórsmörk" → "thorsmork"', () => {
    expect(clientFoldSlug('Þórsmörk')).toBe('thorsmork');
  });
});
