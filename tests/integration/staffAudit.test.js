// The staff audit hooks outside the account model (migration 098): role
// grants and revocations, customer invitations, and disabling/enabling a
// user each leave a staff_audit_log row with the acting admin. Best-effort
// writes — a failed audit insert must never fail the action itself.
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const staffAudit = require('../../server/services/staffAudit');
const {
  createTestAdminUser, createTestRegularUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

let adminCookie, adminId, userId;

beforeEach(async () => {
  await cleanTables();
  adminId = await createTestAdminUser();
  userId  = await createTestRegularUser();
  adminCookie = await getTestSessionCookie(adminId);
  await db.query(`INSERT INTO roles (name, description, view_access, is_system)
                  VALUES ('auditrole', 'audit test', '["handbok"]'::jsonb, FALSE) ON CONFLICT (name) DO NOTHING`);
});

async function rows(action) {
  const { rows } = await db.query(
    `SELECT action, entity_type, entity_id, summary, actor_id FROM staff_audit_log WHERE action = $1 ORDER BY id`, [action]
  );
  return rows;
}

describe('staff audit hooks', () => {
  test('role grant and revoke', async () => {
    const add = await request(app).post('/api/v1/admin/roles/auditrole/members').set('Cookie', adminCookie).send({ userId });
    expect(add.status).toBe(201);
    const granted = await rows('role.granted');
    expect(granted).toHaveLength(1);
    expect(granted[0]).toMatchObject({ entity_type: 'user', entity_id: userId, actor_id: adminId, summary: { role: 'auditrole' } });

    const del = await request(app).delete(`/api/v1/admin/roles/auditrole/members/${userId}`).set('Cookie', adminCookie);
    expect(del.status).toBe(204);
    const revoked = await rows('role.revoked');
    expect(revoked).toHaveLength(1);
    expect(revoked[0].summary).toEqual({ role: 'auditrole' });
  });

  test('customer invitation', async () => {
    const res = await request(app).post('/api/v1/admin/customers').set('Cookie', adminCookie)
      .send({ email: 'invited@test.com', display_name: 'Boðin' });
    expect(res.status).toBe(201);
    const invited = await rows('user.invited');
    expect(invited).toHaveLength(1);
    expect(invited[0].entity_id).toBe(res.body.customer.id);
    expect(invited[0].actor_id).toBe(adminId);
  });

  test('disable and enable', async () => {
    expect((await request(app).patch(`/api/v1/admin/users/${userId}/disable`).set('Cookie', adminCookie).send({ disabled: true, reason: 'test' })).status).toBe(200);
    expect((await request(app).patch(`/api/v1/admin/users/${userId}/disable`).set('Cookie', adminCookie).send({ disabled: false })).status).toBe(200);
    expect(await rows('user.disabled')).toHaveLength(1);
    expect(await rows('user.enabled')).toHaveLength(1);
  });

  test('an unknown action is refused; a failed best-effort write does not throw', async () => {
    await expect(staffAudit.record(db, { action: 'nope', entityType: 'x' })).rejects.toThrow(/Unknown staff audit action/);
    await expect(staffAudit.recordSafe({ action: 'nope', entityType: 'x' })).resolves.toBeUndefined();
  });
});
