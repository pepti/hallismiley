'use strict';

// server/utils/staticCacheControl.js — what express.static sends for public/.
// Production code must revalidate so a reload after a deploy cannot run the
// previous release's modules against the new release's strings.
const { staticCacheControl } = require('../../server/utils/staticCacheControl');

describe('staticCacheControl', () => {
  test('production: code, styles and JSON revalidate on every load', () => {
    for (const f of ['/app/public/js/main.js', '/app/public/js/views/AdminOrderDetailView.js',
      '/app/public/css/main.css', '/app/public/js/i18n/is.json', '/app/public/manifest.json', 'x.mjs']) {
      expect(staticCacheControl(f, 'production')).toBe('no-cache');
    }
  });

  test('production: fonts and images keep express.static maxAge (null = untouched)', () => {
    for (const f of ['/app/public/fonts/barlow.woff2', '/app/public/favicon.png', '/app/public/og-image.jpg']) {
      expect(staticCacheControl(f, 'production')).toBeNull();
    }
  });

  test('the HTML entry point is never cached, in any environment', () => {
    expect(staticCacheControl('/app/public/index.html', 'production')).toBe('no-cache, no-store, must-revalidate');
    expect(staticCacheControl('/app/public/index.html', 'development')).toBe('no-cache, no-store, must-revalidate');
  });

  test('development and test: code is never stored', () => {
    expect(staticCacheControl('/app/public/js/main.js', 'development')).toBe('no-cache, no-store, must-revalidate');
    expect(staticCacheControl('/app/public/css/main.css', 'test')).toBe('no-cache, no-store, must-revalidate');
    expect(staticCacheControl('/app/public/fonts/x.woff2', 'development')).toBeNull();
  });

  test('extension match is case-insensitive and anchored', () => {
    expect(staticCacheControl('/app/public/js/Legacy.JS', 'production')).toBe('no-cache');
    expect(staticCacheControl('/app/public/js/main.js.map', 'production')).toBeNull();
  });
});
