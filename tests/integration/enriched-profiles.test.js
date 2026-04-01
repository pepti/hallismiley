const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  createTestAdminUser,
  createTestRegularUser,
  getTestSessionCookie,
  cleanTables,
  validProject,
} = require('../helpers');

let sessionCookie;
let adminId;
let userId;
let userSessionCookie;

beforeEach(async () => {
  await cleanTables();
  adminId          = await createTestAdminUser();
  sessionCookie    = await getTestSessionCookie(adminId);
  userId           = await createTestRegularUser();
  userSessionCookie = await getTestSessionCookie(userId);
});

afterAll(async () => {
  await db.pool.end();
});

// ── Helper: create a project and return its id ────────────────────────────────
async function createProject() {
  const res = await request(app)
    .post('/api/v1/projects')
    .set('Cookie', sessionCookie)
    .send(validProject());
  return res.body.id;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BIO
// ═══════════════════════════════════════════════════════════════════════════════

describe('Bio field', () => {
  test('can update bio', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ bio: 'Hello world!' });

    expect(res.status).toBe(200);
    expect(res.body.bio).toBe('Hello world!');
  });

  test('bio returned in GET /api/v1/users/me', async () => {
    await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ bio: 'My carpenter bio' });

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.bio).toBe('My carpenter bio');
  });

  test('rejects bio longer than 500 chars', async () => {
    const longBio = 'x'.repeat(501);
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ bio: longBio });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bio/i);
  });

  test('bio at exactly 500 chars is accepted', async () => {
    const maxBio = 'a'.repeat(500);
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ bio: maxBio });

    expect(res.status).toBe(200);
    expect(res.body.bio.length).toBe(500);
  });

  test('bio shown on public profile', async () => {
    await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ bio: 'Public bio text' });

    const res = await request(app)
      .get(`/api/v1/users/${process.env.ADMIN_USERNAME}/profile`);

    expect(res.status).toBe(200);
    expect(res.body.bio).toBe('Public bio text');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════════════════════════

describe('Theme preference', () => {
  test('can update theme to light', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ theme: 'light' });

    expect(res.status).toBe(200);
    expect(res.body.theme).toBe('light');
  });

  test('can update theme back to dark', async () => {
    await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ theme: 'light' });

    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ theme: 'dark' });

    expect(res.status).toBe(200);
    expect(res.body.theme).toBe('dark');
  });

  test('rejects invalid theme value', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ theme: 'solarized' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/theme/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION PREFERENCES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Notification preferences', () => {
  test('can disable notify_comments', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ notify_comments: false });

    expect(res.status).toBe(200);
    expect(res.body.notify_comments).toBe(false);
  });

  test('can re-enable notify_comments', async () => {
    await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ notify_comments: false });

    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ notify_comments: true });

    expect(res.status).toBe(200);
    expect(res.body.notify_comments).toBe(true);
  });

  test('can disable notify_updates', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ notify_updates: false });

    expect(res.status).toBe(200);
    expect(res.body.notify_updates).toBe(false);
  });

  test('non-boolean notify_comments returns 400', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ notify_comments: 'yes' });

    expect(res.status).toBe(400);
  });

  test('non-boolean notify_updates returns 400', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ notify_updates: 1 });

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FAVORITES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Favorites', () => {
  test('can add a favorite (POST)', async () => {
    const projectId = await createProject();

    const res = await request(app)
      .post(`/api/v1/users/me/favorites/${projectId}`)
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(201);
    expect(res.body.project_id).toBe(projectId);
  });

  test('duplicate add returns 200 (not error)', async () => {
    const projectId = await createProject();

    await request(app)
      .post(`/api/v1/users/me/favorites/${projectId}`)
      .set('Cookie', sessionCookie);

    const res = await request(app)
      .post(`/api/v1/users/me/favorites/${projectId}`)
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
  });

  test('can list favorites (GET)', async () => {
    const projectId = await createProject();

    await request(app)
      .post(`/api/v1/users/me/favorites/${projectId}`)
      .set('Cookie', sessionCookie);

    const res = await request(app)
      .get('/api/v1/users/me/favorites')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(p => p.id === projectId)).toBe(true);
  });

  test('can remove a favorite (DELETE)', async () => {
    const projectId = await createProject();

    await request(app)
      .post(`/api/v1/users/me/favorites/${projectId}`)
      .set('Cookie', sessionCookie);

    const del = await request(app)
      .delete(`/api/v1/users/me/favorites/${projectId}`)
      .set('Cookie', sessionCookie);

    expect(del.status).toBe(204);

    const list = await request(app)
      .get('/api/v1/users/me/favorites')
      .set('Cookie', sessionCookie);

    expect(list.body.some(p => p.id === projectId)).toBe(false);
  });

  test('favoriting nonexistent project returns 404', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/favorites/999999')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(404);
  });

  test('unauthenticated add favorite returns 401', async () => {
    const res = await request(app).post('/api/v1/users/me/favorites/1');
    expect(res.status).toBe(401);
  });

  test('unauthenticated list favorites returns 401', async () => {
    const res = await request(app).get('/api/v1/users/me/favorites');
    expect(res.status).toBe(401);
  });

  test('regular user can favorite (not just admin)', async () => {
    const projectId = await createProject();

    const res = await request(app)
      .post(`/api/v1/users/me/favorites/${projectId}`)
      .set('Cookie', userSessionCookie);

    expect(res.status).toBe(201);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC PROFILE
// ═══════════════════════════════════════════════════════════════════════════════

describe('Public profile', () => {
  test('GET /api/v1/users/:username/profile returns public fields', async () => {
    const res = await request(app)
      .get(`/api/v1/users/${process.env.ADMIN_USERNAME}/profile`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('username', process.env.ADMIN_USERNAME);
    expect(res.body).toHaveProperty('avatar');
    expect(res.body).toHaveProperty('role');
    expect(res.body).toHaveProperty('created_at');
    expect(res.body).toHaveProperty('favorite_projects');
    expect(Array.isArray(res.body.favorite_projects)).toBe(true);
  });

  test('public profile does NOT expose email or phone', async () => {
    const res = await request(app)
      .get(`/api/v1/users/${process.env.ADMIN_USERNAME}/profile`);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('email');
    expect(res.body).not.toHaveProperty('phone');
    expect(res.body).not.toHaveProperty('password_hash');
  });

  test('nonexistent username returns 404', async () => {
    const res = await request(app)
      .get('/api/v1/users/no-such-user-xyz/profile');

    expect(res.status).toBe(404);
  });

  test('public profile includes favorite_projects list', async () => {
    const projectId = await createProject();
    await request(app)
      .post(`/api/v1/users/me/favorites/${projectId}`)
      .set('Cookie', sessionCookie);

    const res = await request(app)
      .get(`/api/v1/users/${process.env.ADMIN_USERNAME}/profile`);

    expect(res.status).toBe(200);
    expect(res.body.favorite_projects.some(p => p.id === projectId)).toBe(true);
  });

  test('public profile does not require authentication', async () => {
    // No cookie — should still work
    const res = await request(app)
      .get(`/api/v1/users/${process.env.ADMIN_USERNAME}/profile`);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTED ACCOUNTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Connected accounts', () => {
  test('can update github_username', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ github_username: 'octocat' });

    expect(res.status).toBe(200);
    expect(res.body.github_username).toBe('octocat');
  });

  test('can update linkedin_username', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ linkedin_username: 'john-doe' });

    expect(res.status).toBe(200);
    expect(res.body.linkedin_username).toBe('john-doe');
  });

  test('can clear github_username', async () => {
    await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ github_username: 'octocat' });

    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ github_username: null });

    expect(res.status).toBe(200);
    expect(res.body.github_username).toBeNull();
  });

  test('invalid github_username format returns 400', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ github_username: '-invalid-start' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/github/i);
  });

  test('connected accounts visible on public profile', async () => {
    await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', sessionCookie)
      .send({ github_username: 'hallidev' });

    const res = await request(app)
      .get(`/api/v1/users/${process.env.ADMIN_USERNAME}/profile`);

    expect(res.status).toBe(200);
    expect(res.body.github_username).toBe('hallidev');
  });
});
