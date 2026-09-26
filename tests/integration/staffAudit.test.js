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

  // harvest2 lane 1b (2026-09-26): the gaps found reviewing icelandicstore
  // #416/#421 — the Users-page role dropdown, role create/delete and the hard
  // delete wrote nothing, and the 2FA reset / new-password rows were refused by
  // the closed vocabulary (recordSafe swallowed it).
  test('the Users-page role dropdown writes role.granted + role.revoked (via users_page)', async () => {
    const res = await request(app).patch(`/api/v1/admin/users/${userId}/role`).set('Cookie', adminCookie).send({ role: 'auditrole' });
    expect(res.status).toBe(200);
    const granted = await rows('role.granted');
    expect(granted).toHaveLength(1);
    expect(granted[0]).toMatchObject({ entity_type: 'user', entity_id: userId, actor_id: adminId, summary: { role: 'auditrole', via: 'users_page' } });
    const revoked = await rows('role.revoked');
    expect(revoked).toHaveLength(1);
    expect(revoked[0]).toMatchObject({ entity_id: userId, summary: { role: 'user', via: 'users_page' } });

    // Setting the role it already holds grants and revokes nothing.
    expect((await request(app).patch(`/api/v1/admin/users/${userId}/role`).set('Cookie', adminCookie).send({ role: 'auditrole' })).status).toBe(200);
    expect(await rows('role.granted')).toHaveLength(1);
    expect(await rows('role.revoked')).toHaveLength(1);

    // A refused change (your own role) leaves no row.
    expect((await request(app).patch(`/api/v1/admin/users/${adminId}/role`).set('Cookie', adminCookie).send({ role: 'user' })).status).toBe(400);
    expect(await rows('role.revoked')).toHaveLength(1);
  });

  test('role create and delete', async () => {
    const create = await request(app).post('/api/v1/admin/roles').set('Cookie', adminCookie)
      .send({ name: 'audit-new', description: 'x', view_access: ['handbok'] });
    expect(create.status).toBe(201);
    const created = await rows('role.created');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ entity_type: 'role', entity_id: 'audit-new', actor_id: adminId, summary: { views: ['handbok'] } });

    const del = await request(app).delete('/api/v1/admin/roles/audit-new').set('Cookie', adminCookie);
    expect(del.status).toBe(204);
    const deleted = await rows('role.deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ entity_type: 'role', entity_id: 'audit-new', actor_id: adminId, summary: { views: ['handbok'] } });

    // A refused create (reserved name) writes nothing.
    expect((await request(app).post('/api/v1/admin/roles').set('Cookie', adminCookie).send({ name: 'admin' })).status).toBe(409);
    expect(await rows('role.created')).toHaveLength(1);
  });

  test('a hard user delete writes user.deleted, and the row outlives the user', async () => {
    const del = await request(app).delete(`/api/v1/admin/users/${userId}`).set('Cookie', adminCookie);
    expect(del.status).toBe(204);
    const deleted = await rows('user.deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ entity_type: 'user', entity_id: userId, actor_id: adminId });
    expect(deleted[0].summary.username).toBeTruthy();
    expect(deleted[0].summary).not.toHaveProperty('email');
  });

  test('2FA reset and a name-only new password now reach the trail', async () => {
    const reset = await request(app).post(`/api/v1/admin/users/${userId}/totp/reset`).set('Cookie', adminCookie).send({});
    expect(reset.status).toBe(200);
    expect(await rows('user.totp_reset')).toHaveLength(1);
    // The vocabulary is what used to refuse them.
    expect(staffAudit.ACTIONS).toEqual(expect.arrayContaining(['user.totp_reset', 'user.password_replaced']));
  });

  test('an unknown action is refused; a failed best-effort write does not throw', async () => {
    await expect(staffAudit.record(db, { action: 'nope', entityType: 'x' })).rejects.toThrow(/Unknown staff audit action/);
    await expect(staffAudit.recordSafe({ action: 'nope', entityType: 'x' })).resolves.toBeUndefined();
  });
});
