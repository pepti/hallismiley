// Integration tests for the per-admin sidebar layout API, focused on the new
// personalization flags (collapsed / hiddenSections / hiddenItems) added with the
// collapsible + hideable nav. CSRF is bypassed in test mode (see tests/env.js).
const request = require('supertest');
const app     = require('../../server/app');
const {
  createTestAdminUser,
  createTestRegularUser,
  getTestSessionCookie,
  cleanTables,
} = require('../helpers');

let adminCookie, userId;

beforeEach(async () => {
  await cleanTables();
  const adminId = await createTestAdminUser();
  userId        = await createTestRegularUser();
  adminCookie   = await getTestSessionCookie(adminId);
});

describe('PATCH /api/v1/admin/nav-config — personalization flags', () => {
  test('accepts and round-trips collapsed / hiddenSections / hiddenItems', async () => {
    const layout = {
      v: 1,
      sections: [{ key: 'overview', title: null, items: ['dashboard'] }],
      labels: {},
      collapsed: ['shop'],
      hiddenSections: ['site'],
      hiddenItems: ['orders'],
    };

    const patch = await request(app)
      .patch('/api/v1/admin/nav-config')
      .set('Cookie', adminCookie)
      .send({ config: layout });
    expect(patch.status).toBe(200);
    expect(patch.body.config).toMatchObject({
      collapsed: ['shop'],
      hiddenSections: ['site'],
      hiddenItems: ['orders'],
    });

    // Persisted — a fresh GET returns the same flags.
    const get = await request(app).get('/api/v1/admin/nav-config').set('Cookie', adminCookie);
    expect(get.status).toBe(200);
    expect(get.body.config.hiddenItems).toEqual(['orders']);
  });

  test('a layout with the flags omitted is still valid (flags are optional)', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/nav-config')
      .set('Cookie', adminCookie)
      .send({ config: { v: 1, sections: [{ key: 'overview', title: null, items: ['dashboard'] }] } });
    expect(res.status).toBe(200);
  });

  test('rejects a non-array collapsed flag — 400', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/nav-config')
      .set('Cookie', adminCookie)
      .send({ config: { v: 1, sections: [], collapsed: 'shop' } });
    expect(res.status).toBe(400);
  });

  test('rejects an over-long hidden id — 400', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/nav-config')
      .set('Cookie', adminCookie)
      .send({ config: { v: 1, sections: [], hiddenItems: ['x'.repeat(65)] } });
    expect(res.status).toBe(400);
  });

  test('non-admin is rejected — 403', async () => {
    const userCookie = await getTestSessionCookie(userId);
    const res = await request(app)
      .patch('/api/v1/admin/nav-config')
      .set('Cookie', userCookie)
      .send({ config: { v: 1, sections: [], collapsed: ['shop'] } });
    expect(res.status).toBe(403);
  });
});
