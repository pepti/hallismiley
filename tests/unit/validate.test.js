'use strict';

/**
 * Unit tests for server-side input validators.
 * No database required — all validators are pure Express middleware
 * that receive (req, res, next) and can be exercised with mock objects.
 */
const {
  validateProject,
  validateQuery,
  validateSignup,
  validateProfileUpdate,
  validatePasswordChange,
  ALLOWED_AVATARS,
} = require('../../server/middleware/validate');

// HTTP status codes
const HTTP_400 = 400;

// ── Mock factory helpers ──────────────────────────────────────────────────────

function mockRes() {
  const res = {
    _status: null,
    _body:   null,
    status: jest.fn().mockImplementation(function (s) { this._status = s; return this; }),
    json:   jest.fn().mockImplementation(function (b) { this._body   = b; return this; }),
  };
  return res;
}

function mockNext() { return jest.fn(); }

function runValidator(validator, body = {}, method = 'POST') {
  const req  = { body, method };
  const res  = mockRes();
  const next = mockNext();
  validator(req, res, next);
  return { req, res, next };
}

function runQuery(query) {
  const req  = { query, method: 'GET' };
  const res  = mockRes();
  const next = mockNext();
  validateQuery(req, res, next);
  return { res, next };
}

// ── validateProject — POST (all required fields) ──────────────────────────────

describe('validateProject — POST creates a project', () => {
  const validBody = {
    title:       'My Project',
    description: 'A solid description for this project.',
    category:    'tech',
    year:        2024,
  };

  test('valid body calls next()', () => {
    const { next } = runValidator(validateProject, validBody);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('missing title returns 400', () => {
    const { res, next } = runValidator(validateProject, { ...validBody, title: '' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('missing description returns 400', () => {
    const { res, next } = runValidator(validateProject, { ...validBody, description: '' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('invalid category returns 400 with helpful error', () => {
    const { res, next } = runValidator(validateProject, { ...validBody, category: 'furniture' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(res._body.error).toMatch(/category/i);
    expect(next).not.toHaveBeenCalled();
  });

  test('category=carpentry is valid', () => {
    const { next } = runValidator(validateProject, { ...validBody, category: 'carpentry' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('year below 1900 returns 400', () => {
    const { res, next } = runValidator(validateProject, { ...validBody, year: 1899 });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('year above 2100 returns 400', () => {
    const { res, next } = runValidator(validateProject, { ...validBody, year: 2101 });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('year exactly 1900 is valid', () => {
    const { next } = runValidator(validateProject, { ...validBody, year: 1900 });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('title exceeding 200 characters returns 400', () => {
    const { res, next } = runValidator(validateProject, { ...validBody, title: 'A'.repeat(201) });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('title exactly 200 characters is valid', () => {
    const { next } = runValidator(validateProject, { ...validBody, title: 'A'.repeat(200) });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('tools_used not an array returns 400', () => {
    const { res, next } = runValidator(validateProject, { ...validBody, tools_used: 'Node.js' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('tools_used as valid array calls next()', () => {
    const { next } = runValidator(validateProject, { ...validBody, tools_used: ['Node.js', 'PostgreSQL'] });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('featured as string returns 400', () => {
    const { res, next } = runValidator(validateProject, { ...validBody, featured: 'yes' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('featured as boolean true is valid', () => {
    const { next } = runValidator(validateProject, { ...validBody, featured: true });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('http:// image_url is rejected', () => {
    const { res, next } = runValidator(validateProject, { ...validBody, image_url: 'http://example.com/img.jpg' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('javascript: image_url is rejected', () => {
    const { res, next } = runValidator(validateProject, { ...validBody, image_url: 'javascript:alert(1)' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('https:// image_url is accepted', () => {
    const { next } = runValidator(validateProject, { ...validBody, image_url: 'https://cdn.example.com/img.jpg' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('/assets/ relative path image_url is accepted', () => {
    const { next } = runValidator(validateProject, { ...validBody, image_url: '/assets/projects/1/cover.jpg' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('null image_url is allowed (clear the cover)', () => {
    const { next } = runValidator(validateProject, { ...validBody, image_url: null });
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('validateProject — PATCH (optional fields)', () => {
  test('empty body on PATCH calls next() — no required fields', () => {
    const { next } = runValidator(validateProject, {}, 'PATCH');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('partial update with valid category calls next()', () => {
    const { next } = runValidator(validateProject, { category: 'carpentry' }, 'PATCH');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('partial update with invalid category returns 400', () => {
    const { res, next } = runValidator(validateProject, { category: 'other' }, 'PATCH');
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── validateQuery ─────────────────────────────────────────────────────────────

describe('validateQuery — GET project list filters', () => {
  test('empty query string is valid', () => {
    const { next } = runQuery({});
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('category=tech is valid', () => {
    const { next } = runQuery({ category: 'tech' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('category=carpentry is valid', () => {
    const { next } = runQuery({ category: 'carpentry' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('unknown category returns 400', () => {
    const { res, next } = runQuery({ category: "tech' OR '1'='1" });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('featured=true is valid', () => {
    const { next } = runQuery({ featured: 'true' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('featured=false is valid', () => {
    const { next } = runQuery({ featured: 'false' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('featured=maybe returns 400', () => {
    const { res, next } = runQuery({ featured: 'maybe' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('year=2024 is valid', () => {
    const { next } = runQuery({ year: '2024' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('year=1899 returns 400 (below floor)', () => {
    const { res, next } = runQuery({ year: '1899' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('year=2101 returns 400 (above ceiling)', () => {
    const { res, next } = runQuery({ year: '2101' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('SQL injection in year returns 400', () => {
    const { res, next } = runQuery({ year: '2024 OR 1=1' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('limit=50 is valid', () => {
    const { next } = runQuery({ limit: '50' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('limit=0 returns 400', () => {
    const { res, next } = runQuery({ limit: '0' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── validateSignup ────────────────────────────────────────────────────────────

describe('validateSignup — new user registration', () => {
  const validBody = {
    username: 'johndoe',
    email:    'john@example.com',
    password: 'password123',
  };

  test('valid signup body calls next()', () => {
    const { next } = runValidator(validateSignup, validBody);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('missing username returns 400', () => {
    const { res, next } = runValidator(validateSignup, { ...validBody, username: '' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('username with spaces returns 400', () => {
    const { res, next } = runValidator(validateSignup, { ...validBody, username: 'john doe' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('username with special chars returns 400', () => {
    const { res, next } = runValidator(validateSignup, { ...validBody, username: 'john!' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('username shorter than 3 chars returns 400', () => {
    const { res, next } = runValidator(validateSignup, { ...validBody, username: 'ab' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('underscore in username is allowed', () => {
    const { next } = runValidator(validateSignup, { ...validBody, username: 'john_doe' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('invalid email format returns 400', () => {
    const { res, next } = runValidator(validateSignup, { ...validBody, email: 'not-an-email' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('email without domain returns 400', () => {
    const { res, next } = runValidator(validateSignup, { ...validBody, email: 'user@' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('password shorter than 8 chars returns 400', () => {
    const { res, next } = runValidator(validateSignup, { ...validBody, password: 'abc123' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('password without a letter returns 400', () => {
    const { res, next } = runValidator(validateSignup, { ...validBody, password: '12345678' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('password without a number returns 400', () => {
    const { res, next } = runValidator(validateSignup, { ...validBody, password: 'abcdefgh' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('invalid avatar filename returns 400', () => {
    const { res, next } = runValidator(validateSignup, { ...validBody, avatar: 'custom-avatar.png' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('avatar-01.svg is accepted', () => {
    const { next } = runValidator(validateSignup, { ...validBody, avatar: 'avatar-01.svg' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('avatar-40.svg is accepted', () => {
    const { next } = runValidator(validateSignup, { ...validBody, avatar: 'avatar-40.svg' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('avatar-41.svg is rejected', () => {
    const { res, next } = runValidator(validateSignup, { ...validBody, avatar: 'avatar-41.svg' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  // ── Icelandic-letter usernames ──────────────────────────────────────────────
  // OAuth-derived usernames may contain lowercase Icelandic letters
  // (á é í ó ú ý ð þ æ ö). USERNAME_RE accepts both cases up to 40 chars.

  test('lowercase Icelandic username is accepted', () => {
    const { next } = runValidator(validateSignup, { ...validBody, username: 'jónþórsson' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('mixed Icelandic + ASCII username is accepted', () => {
    const { next } = runValidator(validateSignup, { ...validBody, username: 'anna_þórsdóttir3' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('uppercase Icelandic letters are accepted', () => {
    const { next } = runValidator(validateSignup, { ...validBody, username: 'ÁÉÍÓÚÝÐÞÆÖ' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('username at the new 40-char ceiling is accepted', () => {
    const { next } = runValidator(validateSignup, { ...validBody, username: 'a'.repeat(40) });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('username of 41 chars returns 400 (above ceiling)', () => {
    const { res, next } = runValidator(validateSignup, { ...validBody, username: 'a'.repeat(41) });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('Icelandic username of 41 chars returns 400', () => {
    const { res, next } = runValidator(validateSignup, { ...validBody, username: 'þ'.repeat(41) });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('non-Icelandic accented letter (é vs ñ) is rejected', () => {
    // ñ is not in the Icelandic alphabet — must be rejected to keep the
    // allowed set tight.
    const { res, next } = runValidator(validateSignup, { ...validBody, username: 'señor' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('ALLOWED_AVATARS constant', () => {
  test('contains exactly 40 entries', () => {
    expect(ALLOWED_AVATARS).toHaveLength(40);
  });

  test('first entry is avatar-01.svg', () => {
    expect(ALLOWED_AVATARS[0]).toBe('avatar-01.svg');
  });

  test('last entry is avatar-40.svg', () => {
    expect(ALLOWED_AVATARS[39]).toBe('avatar-40.svg');
  });

  test('all entries follow the avatar-NN.svg pattern', () => {
    expect(ALLOWED_AVATARS.every(a => /^avatar-\d{2}\.svg$/.test(a))).toBe(true);
  });
});

// ── validateProfileUpdate ─────────────────────────────────────────────────────

describe('validateProfileUpdate — PATCH /users/me', () => {
  test('valid phone number calls next()', () => {
    const { next } = runValidator(validateProfileUpdate, { phone: '+1 555-123-4567' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('invalid phone number returns 400', () => {
    const { res, next } = runValidator(validateProfileUpdate, { phone: 'not-a-phone!!!' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('valid display_name calls next()', () => {
    const { next } = runValidator(validateProfileUpdate, { display_name: 'Jane Doe' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('display_name over 100 chars returns 400', () => {
    const { res, next } = runValidator(validateProfileUpdate, { display_name: 'A'.repeat(101) });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('valid avatar calls next()', () => {
    const { next } = runValidator(validateProfileUpdate, { avatar: 'avatar-05.svg' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('invalid avatar returns 400', () => {
    const { res, next } = runValidator(validateProfileUpdate, { avatar: 'my-face.jpg' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── validatePasswordChange ────────────────────────────────────────────────────

describe('validatePasswordChange — PATCH /users/me/password', () => {
  test('valid passwords call next()', () => {
    const { next } = runValidator(validatePasswordChange, {
      current_password: 'oldpassword1',
      new_password:     'newpassword2',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('missing current_password returns 400', () => {
    const { res, next } = runValidator(validatePasswordChange, { new_password: 'newpassword1' });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('weak new_password returns 400', () => {
    const { res, next } = runValidator(validatePasswordChange, {
      current_password: 'oldpassword1',
      new_password:     'weakpass',
    });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });

  test('new_password without number returns 400', () => {
    const { res, next } = runValidator(validatePasswordChange, {
      current_password: 'oldpassword1',
      new_password:     'abcdefghij',
    });
    expect(res.status).toHaveBeenCalledWith(HTTP_400);
    expect(next).not.toHaveBeenCalled();
  });
});
