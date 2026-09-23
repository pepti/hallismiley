// Guards the hidden-admin-view set: every id in identity.surface.hiddenAdminViews
// — the engine defaults in server/config/clientConfig.js, the client fallback
// in public/js/utils/identity.js, and THIS instance's resolved config
// (config/client.json + CLIENT_CONFIG_* env) — must be a real admin view id,
// or a typo would silently hide nothing while the config claims it hides a
// screen. public/js/components/adminSurface.js builds HIDDEN_ADMIN_VIEWS from
// the resolved list at runtime, so checking the list checks the component.
const { ADMIN_VIEW_IDS } = require('../../server/auth/adminViews');
const { clientConfig, defaults } = require('../../server/config/clientConfig');
const { IDENTITY_DEFAULTS } = require('../../public/js/utils/identity.js');

const SOURCES = [
  ['the engine defaults (clientConfig SCHEMA)', defaults().identity.surface.hiddenAdminViews],
  ['the client fallback (IDENTITY_DEFAULTS)',    IDENTITY_DEFAULTS.surface.hiddenAdminViews],
  ["this instance's resolved config",           clientConfig.identity.surface.hiddenAdminViews],
];

describe.each(SOURCES)('hiddenAdminViews from %s', (_label, ids) => {
  test('every id is a real ADMIN_VIEW_IDS entry', () => {
    expect(ids.filter((id) => !ADMIN_VIEW_IDS.includes(id))).toEqual([]);
  });

  test('the policy never swallows the whole console', () => {
    expect(ids).not.toContain('dashboard');
    expect(ids).not.toContain('roles');
  });
});

test('the engine defaults hide something (the guard is not asserting over an empty list)', () => {
  expect(defaults().identity.surface.hiddenAdminViews.length).toBeGreaterThan(0);
});
