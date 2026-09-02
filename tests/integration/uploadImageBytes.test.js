// End-to-end: the avatar route is the simplest upload surface, so it pins
// that verifyImageBytes is actually mounted behind multer on a real route —
// bytes that contradict the declared image type never reach the controller
// and never stay on disk (ice #215, applied at upload time here).
const fs      = require('fs');
const path    = require('path');
const request = require('supertest');
const app     = require('../../server/app');
const { userAvatarDir } = require('../../server/config/paths');
const { createTestAdminUser, getTestSessionCookie, cleanTables } = require('../helpers');

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

let sessionCookie;
let adminId;

beforeEach(async () => {
  await cleanTables();
  adminId       = await createTestAdminUser();
  sessionCookie = await getTestSessionCookie(adminId);
});

afterEach(() => {
  const dir = userAvatarDir();
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(`user-${adminId}-`)) fs.unlinkSync(path.join(dir, f));
  }
});

function avatarFiles() {
  const dir = userAvatarDir();
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.startsWith(`user-${adminId}-`)) : [];
}

describe('POST /api/v1/users/me/avatar — magic-byte check', () => {
  test('PNG bytes declared as image/jpeg → 400 and nothing left on disk', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/avatar')
      .set('Cookie', sessionCookie)
      .attach('file', PNG_SIGNATURE, { filename: 'me.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.stringMatching(/not a valid JPEG image/), code: 400 });
    expect(avatarFiles()).toEqual([]);
  });

  test('text bytes declared as image/png → 400', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/avatar')
      .set('Cookie', sessionCookie)
      .attach('file', Buffer.from('definitely not a png'), { filename: 'me.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a valid PNG image/);
    expect(avatarFiles()).toEqual([]);
  });

  test('matching bytes still upload (the check is transparent for honest files)', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/avatar')
      .set('Cookie', sessionCookie)
      .attach('file', PNG_SIGNATURE, { filename: 'me.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(avatarFiles()).toHaveLength(1);
  });
});
