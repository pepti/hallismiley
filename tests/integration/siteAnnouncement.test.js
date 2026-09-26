'use strict';

/**
 * The site announcement (harvest2-lane7a-2026-09-26; ported from
 * icelandicstore #200). The admin API (who may, validation, CSRF) and the
 * PUBLIC endpoint's one promise: the copy leaves the server only while the
 * announcement is live — switched off, not started, ended, or with no
 * heading, the answer is exactly `{ active: false }`.
 */
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Setting = require('../../server/models/Setting');
const Role    = require('../../server/models/Role');
const {
  getTestSessionCookie, cleanTables, createTestAdminUser, createTestRegularUser,
} = require('../helpers');

const ADMIN = '/api/v1/admin/announcement';
const PUBLIC = '/api/v1/announcement';
let adminCookie, adminId, userCookie, roleCookie;

// Reykjavík = UTC, so an ISO minute is the admin's wall clock.
const minute = (offsetMs) => new Date(Date.now() + offsetMs).toISOString().slice(0, 16);
const HOUR = 3600 * 1000;

async function roleUser(name, views) {
  await db.query(
    `INSERT INTO roles (name, description, view_access, is_system)
     VALUES ($1, 'l7a test role', $2::jsonb, FALSE)
     ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`,
    [name, JSON.stringify(views)]
  );
  Role.invalidateCache();
  const id = `l7a-${name}`;
  await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ($1, $2, $3, (SELECT password_hash FROM users WHERE id = $4), $5, TRUE)`,
    [id, `${name}@l7a.test`, name, adminId, name]
  );
  return getTestSessionCookie(id);
}

const clear = () => db.query(`DELETE FROM app_settings WHERE key LIKE 'announcement.%'`);
const patch = (body, cookie = adminCookie) => request(app).patch(ADMIN).set('Cookie', cookie).send(body);
const COPY = {
  title: { is: 'Nýr vefur', en: 'New site' },
  message: { is: 'Aðgangurinn þinn bíður.', en: 'Your account is waiting.' },
};

beforeAll(async () => {
  await cleanTables();
  await clear();
  adminId = await createTestAdminUser();
  adminCookie = await getTestSessionCookie(adminId);
  userCookie = await getTestSessionCookie(await createTestRegularUser());
  roleCookie = await roleUser('l7aannounce', ['announcement']);
});
afterEach(clear);

describe('the admin API', () => {
  test('anonymous 401, a plain account 403; a role holding `announcement` may', async () => {
    expect((await request(app).get(ADMIN)).status).toBe(401);
    expect((await request(app).get(ADMIN).set('Cookie', userCookie)).status).toBe(403);
    expect((await patch({ enabled: true, ...COPY }, userCookie)).status).toBe(403);
    const res = await patch({ ...COPY }, roleCookie);
    expect(res.status).toBe(200);
    expect(res.body.settings.title).toEqual(COPY.title);
  });

  test('off, empty, no window by default', async () => {
    const res = await request(app).get(ADMIN).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      settings: {
        enabled: false, starts_at: '', ends_at: '',
        title: { en: '', is: '' }, message: { en: '', is: '' },
        link_path: '', link_label: { en: '', is: '' },
      },
      status: { active: false, timezone: 'Atlantic/Reykjavik' },
    });
  });

  test.each([
    [{ enabled: 'yes' }, /enabled/],
    [{ starts_at: '2026-02-31T10:00' }, /starts_at/],
    [{ ends_at: 'next week' }, /ends_at/],
    [{ starts_at: 5 }, /starts_at/],
    [{ starts_at: '2026-10-14T17:00', ends_at: '2026-10-14T17:00' }, /before ends_at/],
    [{ starts_at: '2026-10-15T09:00', ends_at: '2026-10-14T17:00' }, /before ends_at/],
    [{ enabled: true }, /title is required/],
    [{ title: 'hello' }, /title/],
    [{ title: { fr: 'Bonjour' } }, /title\.fr/],
    [{ message: { is: 'x'.repeat(601) } }, /too long/],
    [{ link_path: 'https://evil.example' }, /link_path/],
    [{ link_path: '//evil.example' }, /link_path/],
    [{ link_path: '/\\evil' }, /link_path/],
    [{ link_path: 'javascript:alert(1)' }, /link_path/],
  ])('%j → 400 in the error envelope', async (body, msg) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.stringMatching(msg), code: 400 });
  });

  test('one bound is checked against the stored other one', async () => {
    expect((await patch({ ends_at: '2026-10-14T17:00' })).status).toBe(200);
    const res = await patch({ starts_at: '2026-10-20T09:00' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/before ends_at/);
  });

  test('a save is all or nothing', async () => {
    const res = await patch({ ...COPY, enabled: true, ends_at: 'never' });
    expect(res.status).toBe(400);
    expect(await Setting.getAnnouncementSettings()).toEqual(expect.objectContaining({ enabled: false, title: { en: '', is: '' } }));
  });

  test('plain text: tags are stripped from the title and the message', async () => {
    const res = await patch({ title: { en: '<b>Hi</b>' }, message: { en: '<img src=x onerror=alert(1)>Read <i>this</i>' } });
    expect(res.status).toBe(200);
    expect(res.body.settings.title.en).toBe('Hi');
    expect(res.body.settings.message.en).toBe('Read this');
  });

  test('the write carries CSRF (checked outside test mode)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    let res;
    try { res = await patch({ ...COPY }); } finally { process.env.NODE_ENV = prev; }
    expect(res.status).toBe(403);
    expect((await Setting.getAnnouncementSettings()).title.is).toBe('');
  });

  test('the "live now" chip is the public rule', async () => {
    const res = await patch({ enabled: true, ...COPY, starts_at: minute(-HOUR), ends_at: minute(HOUR) });
    expect(res.body.status.active).toBe(true);
    const later = await patch({ starts_at: minute(2 * HOUR), ends_at: minute(3 * HOUR) });
    expect(later.body.status.active).toBe(false);
  });
});

describe('GET /api/v1/announcement — the copy only while live', () => {
  const pub = () => request(app).get(PUBLIC);

  test('nothing configured: { active: false }, never cached', async () => {
    const res = await pub();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ active: false });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('switched off, not yet started, or ended: exactly { active: false } — the wording never leaves', async () => {
    await patch({ ...COPY, enabled: false });
    expect((await pub()).body).toEqual({ active: false });
    await patch({ enabled: true, starts_at: minute(HOUR), ends_at: minute(2 * HOUR) });
    const future = await pub();
    expect(future.body).toEqual({ active: false });
    expect(JSON.stringify(future.body)).not.toContain('Nýr vefur');
    await patch({ starts_at: minute(-2 * HOUR), ends_at: minute(-HOUR) });
    expect((await pub()).body).toEqual({ active: false });
  });

  test('live: the copy in both languages, the link, an id — no dates', async () => {
    await patch({ enabled: true, ...COPY, starts_at: minute(-HOUR), ends_at: minute(HOUR),
      link_path: '/forgot-password', link_label: { is: 'Veldu lykilorð' } });
    const res = await pub();
    expect(res.body).toEqual({
      active: true, id: expect.any(String),
      title: COPY.title, message: COPY.message,
      link: { path: '/forgot-password', label: { is: 'Veldu lykilorð', en: '' } },
    });
    expect(res.body).not.toHaveProperty('starts_at');
    expect(res.body).not.toHaveProperty('ends_at');
  });

  test('anonymous and signed-in callers get the same answer (the SPA decides who sees it)', async () => {
    await patch({ enabled: true, ...COPY });
    const anon = await pub();
    const signedIn = await request(app).get(PUBLIC).set('Cookie', userCookie);
    expect(signedIn.body).toEqual(anon.body);
    expect(anon.body.active).toBe(true);
  });

  test('a stored row that no longer parses fails closed', async () => {
    await patch({ enabled: true, ...COPY });
    await Setting.set(Setting.KEYS.announceEndsAt, 'garbage');
    expect((await pub()).body).toEqual({ active: false });
  });
});
