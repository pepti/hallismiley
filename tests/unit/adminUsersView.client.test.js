'use strict';

// public/js/views/AdminUsersView.js (harvest2 lane 1b, 2026-09-26):
//  - the Party column (the party_access toggle) shows only when the party
//    module is switched on (server/config/moduleCatalog.js `party`, read
//    client-side through utils/modules.js moduleEnabled);
//  - a cancelled confirm() says so with a toast instead of returning silently
//    (ported from icelandicstore #199).

let mockPartyOn = false;

jest.mock('../../public/js/utils/modules.js', () => ({ moduleEnabled: (id) => (id === 'party' ? mockPartyOn : true) }));
jest.mock('../../public/js/services/auth.js', () => ({
  isAuthenticated: () => true, isAdmin: () => true, getUser: () => ({ id: 'me' }),
  adminGetUsers: jest.fn(), adminUpdateUser: jest.fn(), adminDeleteUser: jest.fn(),
  adminApproveUser: jest.fn(), adminResetTotp: jest.fn(), adminNewPassword: jest.fn(),
}));
jest.mock('../../public/js/components/OneTimeCredentials.js', () => ({ credentialsPanelHtml: () => '', wireCredentialsPanel: () => {} }));
jest.mock('../../public/js/components/Toast.js', () => ({ showToast: jest.fn() }));
jest.mock('../../public/js/i18n/i18n.js', () => ({ t: (k) => k, href: (r) => r }));
jest.mock('../../public/js/navigate.js', () => ({ navigateReplace: jest.fn() }));
jest.mock('../../public/js/components/AdminSidebar.js', () => ({ renderAdminShell: () => ({}) }));
jest.mock('../../public/js/services/adminRoles.js', () => ({ listRoles: async () => ({ roles: [] }) }));
jest.mock('../../public/js/components/adminTable.js', () => ({
  sortableTh: (label, field) => `<th data-sort="${field}">${label}</th>`, cycleSort: (s) => s, bindSortable: () => () => {},
}));
jest.mock('../../public/js/components/adminPager.js', () => ({ pagerHtml: () => '', bindPager: () => () => {} }));
jest.mock('../../public/js/utils/listState.js', () => ({
  readListState: (d) => d, syncListState: () => {}, readPageSize: (_v, d) => d, writePageSize: () => {},
}));

function renderRows() {
  const { AdminUsersView } = require('../../public/js/views/AdminUsersView.js');
  const view = new AdminUsersView();
  const wrap = { innerHTML: '', querySelectorAll: () => [] };
  view._el = { querySelector: () => wrap };
  view._renderTable([{ id: 'u1', username: 'anna', email: 'a@x.is', role: 'user', party_access: true, created_at: null }]);
  return wrap.innerHTML;
}

beforeEach(() => { jest.resetModules(); });

test('party module off: no Party header, no party toggle', () => {
  mockPartyOn = false;
  const html = renderRows();
  expect(html).not.toContain('data-sort="party"');
  expect(html).not.toContain('toggle-party');
  expect(html).toContain('data-sort="username"'); // the rest of the table is there
});

describe('a cancelled confirm says nothing was changed', () => {
  afterEach(() => { delete global.confirm; });

  test.each([
    ['_onDeleteUser', 'adminDeleteUser'],
    ['_onResetTotp', 'adminResetTotp'],
    ['_onNewPassword', 'adminNewPassword'],
  ])('%s', async (method, apiCall) => {
    global.confirm = jest.fn(() => false);
    const { AdminUsersView } = require('../../public/js/views/AdminUsersView.js');
    const { showToast } = require('../../public/js/components/Toast.js');
    const auth = require('../../public/js/services/auth.js');
    const view = new AdminUsersView();
    await view[method]({ dataset: { userId: 'u1', username: 'anna' }, disabled: false });
    expect(global.confirm).toHaveBeenCalledTimes(1);
    expect(auth[apiCall]).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('admin.actionCancelled', 'info');
  });
});

test('party module on: header and toggle are back', () => {
  mockPartyOn = true;
  const html = renderRows();
  expect(html).toContain('data-sort="party"');
  expect(html).toContain('data-action="toggle-party"');
});
