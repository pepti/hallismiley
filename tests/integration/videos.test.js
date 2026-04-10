const request = require('supertest');
const path    = require('path');
const fs      = require('fs');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  getTestSessionCookie,
  createTestModeratorUser,
  createTestRegularUser,
  cleanTables,
  validProject,
} = require('../helpers');
const { parseYouTubeId } = require('../../server/utils/youtube');

// Minimal valid MP4 bytes — not a real playable video but enough for multer
// to accept the upload because the mimetype is set explicitly via supertest.
const MP4_STUB = Buffer.from('0000001866747970', 'hex'); // truncated ftyp header

let adminCookie;
let modCookie;
let userCookie;
let projectId;

const uploadDirs = new Set();
function cleanupUploadDir(id) {
  const dir = path.join(__dirname, '../../public/assets/projects', String(id));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

beforeEach(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie();

  const modId  = await createTestModeratorUser();
  const userId = await createTestRegularUser();
  modCookie  = await getTestSessionCookie(modId);
  userCookie = await getTestSessionCookie(userId);

  const res = await request(app).post('/api/v1/projects').set('Cookie', adminCookie).send(validProject());
  projectId = res.body.id;
  uploadDirs.add(projectId);
});

afterEach(() => {
  uploadDirs.forEach(id => cleanupUploadDir(id));
  uploadDirs.clear();
});

afterAll(async () => {
  await db.pool.end();
});

async function seedYoutube(id, sortOrder = 0, title = null) {
  const { rows } = await db.query(
    `INSERT INTO project_videos (project_id, kind, youtube_id, title, sort_order)
     VALUES ($1, 'youtube', $2, $3, $4)
     RETURNING *`,
    [projectId, id, title, sortOrder]
  );
  return rows[0];
}

// ── YouTube URL parser unit tests ────────────────────────────────────────────

describe('parseYouTubeId', () => {
  test('extracts from bare 11-char id', () => {
    expect(parseYouTubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  test('extracts from watch URL', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  test('extracts from watch URL with extra params', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toBe('dQw4w9WgXcQ');
  });
  test('extracts from youtu.be short URL', () => {
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  test('extracts from /embed/ URL', () => {
    expect(parseYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  test('extracts from /shorts/ URL', () => {
    expect(parseYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  test('extracts from mobile URL', () => {
    expect(parseYouTubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  test('returns null for garbage input', () => {
    expect(parseYouTubeId('not a url')).toBeNull();
    expect(parseYouTubeId('')).toBeNull();
    expect(parseYouTubeId(null)).toBeNull();
    expect(parseYouTubeId('https://vimeo.com/12345')).toBeNull();
  });
});

// ── GET /api/v1/projects/:id/videos ──────────────────────────────────────────

describe('GET /api/v1/projects/:id/videos', () => {
  test('returns empty array for a project with no videos', async () => {
    const res = await request(app).get(`/api/v1/projects/${projectId}/videos`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns videos ordered by sort_order', async () => {
    await seedYoutube('aaaaaaaaaaa', 2);
    await seedYoutube('bbbbbbbbbbb', 0);
    await seedYoutube('ccccccccccc', 1);
    const res = await request(app).get(`/api/v1/projects/${projectId}/videos`);
    expect(res.status).toBe(200);
    expect(res.body.map(v => v.youtube_id)).toEqual(['bbbbbbbbbbb', 'ccccccccccc', 'aaaaaaaaaaa']);
  });

  test('is public — no auth required', async () => {
    const res = await request(app).get(`/api/v1/projects/${projectId}/videos`);
    expect(res.status).toBe(200);
  });

  test('404 for non-existent project', async () => {
    const res = await request(app).get('/api/v1/projects/999999/videos');
    expect(res.status).toBe(404);
  });
});

// ── POST /api/v1/projects/:id/videos (YouTube) ───────────────────────────────

describe('POST /api/v1/projects/:id/videos (YouTube)', () => {
  test('admin can add a YouTube video via watch URL', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/videos`)
      .set('Cookie', adminCookie)
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Hero clip' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'youtube',
      youtube_id: 'dQw4w9WgXcQ',
      title: 'Hero clip',
      file_path: null,
    });
  });

  test('moderator can add a YouTube video', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/videos`)
      .set('Cookie', modCookie)
      .send({ url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(res.status).toBe(201);
  });

  test('regular user gets 403', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/videos`)
      .set('Cookie', userCookie)
      .send({ url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/videos`)
      .send({ url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(res.status).toBe(401);
  });

  test('invalid YouTube URL is rejected', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/videos`)
      .set('Cookie', adminCookie)
      .send({ url: 'https://vimeo.com/12345' });
    expect(res.status).toBe(400);
  });

  test('missing url is rejected', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/videos`)
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  test('404 for non-existent project', async () => {
    const res = await request(app)
      .post('/api/v1/projects/999999/videos')
      .set('Cookie', adminCookie)
      .send({ url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(res.status).toBe(404);
  });

  test('sort_order is assigned incrementally', async () => {
    const r1 = await request(app).post(`/api/v1/projects/${projectId}/videos`).set('Cookie', adminCookie).send({ url: 'https://youtu.be/aaaaaaaaaaa' });
    const r2 = await request(app).post(`/api/v1/projects/${projectId}/videos`).set('Cookie', adminCookie).send({ url: 'https://youtu.be/bbbbbbbbbbb' });
    expect(r1.body.sort_order).toBe(0);
    expect(r2.body.sort_order).toBe(1);
  });
});

// ── POST /api/v1/projects/:id/videos (file upload) ───────────────────────────

describe('POST /api/v1/projects/:id/videos (file)', () => {
  test('admin can upload a video file', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/videos`)
      .set('Cookie', adminCookie)
      .attach('file', MP4_STUB, { filename: 'clip.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('file');
    expect(res.body.file_path).toMatch(new RegExp(`/assets/projects/${projectId}/.*\\.mp4$`));
    expect(res.body.youtube_id).toBeNull();
  });

  test('rejects non-video file types', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/videos`)
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });
});

// ── PATCH /api/v1/projects/:id/videos/:videoId ───────────────────────────────

describe('PATCH /api/v1/projects/:id/videos/:videoId', () => {
  test('admin can update title', async () => {
    const v = await seedYoutube('aaaaaaaaaaa', 0, 'Old');
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/videos/${v.id}`)
      .set('Cookie', adminCookie)
      .send({ title: 'New title' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('New title');
  });

  test('title length cap enforced', async () => {
    const v = await seedYoutube('aaaaaaaaaaa');
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/videos/${v.id}`)
      .set('Cookie', adminCookie)
      .send({ title: 'x'.repeat(201) });
    expect(res.status).toBe(400);
  });

  test('404 for non-existent video', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/videos/99999`)
      .set('Cookie', adminCookie)
      .send({ title: 'X' });
    expect(res.status).toBe(404);
  });

  test('regular user gets 403', async () => {
    const v = await seedYoutube('aaaaaaaaaaa');
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/videos/${v.id}`)
      .set('Cookie', userCookie)
      .send({ title: 'X' });
    expect(res.status).toBe(403);
  });
});

// ── PATCH /api/v1/projects/:id/videos/reorder ────────────────────────────────

describe('PATCH /api/v1/projects/:id/videos/reorder', () => {
  test('admin can reorder videos', async () => {
    const a = await seedYoutube('aaaaaaaaaaa', 0);
    const b = await seedYoutube('bbbbbbbbbbb', 1);
    const c = await seedYoutube('ccccccccccc', 2);
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/videos/reorder`)
      .set('Cookie', adminCookie)
      .send({ order: [
        { id: c.id, sort_order: 0 },
        { id: a.id, sort_order: 1 },
        { id: b.id, sort_order: 2 },
      ] });
    expect(res.status).toBe(200);
    expect(res.body.map(v => v.youtube_id)).toEqual(['ccccccccccc', 'aaaaaaaaaaa', 'bbbbbbbbbbb']);
  });

  test('rejects videos from another project', async () => {
    const otherRes = await request(app).post('/api/v1/projects').set('Cookie', adminCookie).send(validProject());
    const { rows } = await db.query(
      `INSERT INTO project_videos (project_id, kind, youtube_id, sort_order) VALUES ($1, 'youtube', 'aaaaaaaaaaa', 0) RETURNING id`,
      [otherRes.body.id]
    );
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/videos/reorder`)
      .set('Cookie', adminCookie)
      .send({ order: [{ id: rows[0].id, sort_order: 0 }] });
    expect(res.status).toBe(400);
  });
});

// ── PATCH /api/v1/projects/:id/videos/position ───────────────────────────────

describe('PATCH /api/v1/projects/:id/videos/position', () => {
  test('admin can set position to below_gallery', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/videos/position`)
      .set('Cookie', adminCookie)
      .send({ position: 'below_gallery' });
    expect(res.status).toBe(200);
    expect(res.body.video_section_position).toBe('below_gallery');
  });

  test('admin can set position back to above_gallery', async () => {
    await request(app).patch(`/api/v1/projects/${projectId}/videos/position`).set('Cookie', adminCookie).send({ position: 'below_gallery' });
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/videos/position`)
      .set('Cookie', adminCookie)
      .send({ position: 'above_gallery' });
    expect(res.status).toBe(200);
    expect(res.body.video_section_position).toBe('above_gallery');
  });

  test('default position is above_gallery', async () => {
    const res = await request(app).get(`/api/v1/projects/${projectId}`);
    expect(res.body.video_section_position).toBe('above_gallery');
  });

  test('invalid position is rejected', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/videos/position`)
      .set('Cookie', adminCookie)
      .send({ position: 'sideways' });
    expect(res.status).toBe(400);
  });

  test('regular user gets 403', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/videos/position`)
      .set('Cookie', userCookie)
      .send({ position: 'below_gallery' });
    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/v1/projects/:id/videos/:videoId ──────────────────────────────

describe('DELETE /api/v1/projects/:id/videos/:videoId', () => {
  test('admin can delete a single video', async () => {
    const v = await seedYoutube('aaaaaaaaaaa');
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/videos/${v.id}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);
    const { rows } = await db.query('SELECT id FROM project_videos WHERE id = $1', [v.id]);
    expect(rows).toHaveLength(0);
  });

  test('moderator gets 403 on single delete (admin only)', async () => {
    const v = await seedYoutube('aaaaaaaaaaa');
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/videos/${v.id}`)
      .set('Cookie', modCookie);
    expect(res.status).toBe(403);
  });

  test('404 for non-existent video', async () => {
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/videos/99999`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/v1/projects/:id/videos (whole section) ───────────────────────

describe('DELETE /api/v1/projects/:id/videos', () => {
  test('admin can clear the whole video section', async () => {
    await seedYoutube('aaaaaaaaaaa', 0);
    await seedYoutube('bbbbbbbbbbb', 1);
    await seedYoutube('ccccccccccc', 2);
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/videos`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);
    const { rows } = await db.query('SELECT id FROM project_videos WHERE project_id = $1', [projectId]);
    expect(rows).toHaveLength(0);
  });

  test('moderator gets 403 on clear-all (admin only)', async () => {
    await seedYoutube('aaaaaaaaaaa');
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/videos`)
      .set('Cookie', modCookie);
    expect(res.status).toBe(403);
  });

  test('clearing a non-existent project 404s', async () => {
    const res = await request(app)
      .delete('/api/v1/projects/999999/videos')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  test('clearing an already-empty section is a no-op 204', async () => {
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/videos`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);
  });
});
