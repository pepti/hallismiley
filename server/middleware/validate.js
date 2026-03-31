// A03 Injection + A04 Insecure Design: strict input validation for all routes

// ── Project validation ────────────────────────────────────────────────────────

const VALID_CATEGORIES = ['carpentry', 'tech'];
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;
const MAX_TITLE_LEN = 200;
const MAX_DESC_LEN  = 2000;
const MAX_TOOL_LEN  = 100;
const MAX_TOOLS     = 50;

// Validates body fields on POST / PUT / PATCH
function validateProject(req, res, next) {
  const { title, description, category, year, tools_used, image_url, featured } = req.body;
  const errors = [];
  const isPOST = req.method === 'POST';

  // Required fields only on creation
  if (isPOST) {
    if (!title?.trim())       errors.push('title is required');
    if (!description?.trim()) errors.push('description is required');
    if (!category)            errors.push('category is required');
    if (year === undefined)   errors.push('year is required');
  }

  // Field-level checks (apply when field is present)
  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length === 0)
      errors.push('title must be a non-empty string');
    else if (title.length > MAX_TITLE_LEN)
      errors.push(`title must be at most ${MAX_TITLE_LEN} characters`);
  }
  if (description !== undefined) {
    if (typeof description !== 'string' || description.trim().length === 0)
      errors.push('description must be a non-empty string');
    else if (description.length > MAX_DESC_LEN)
      errors.push(`description must be at most ${MAX_DESC_LEN} characters`);
  }
  if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
    errors.push(`category must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }
  if (year !== undefined) {
    const y = Number(year);
    if (!Number.isInteger(y) || y < MIN_YEAR || y > MAX_YEAR)
      errors.push(`year must be an integer between ${MIN_YEAR} and ${MAX_YEAR}`);
  }
  if (tools_used !== undefined) {
    if (!Array.isArray(tools_used))
      errors.push('tools_used must be an array');
    else if (tools_used.length > MAX_TOOLS)
      errors.push(`tools_used must contain at most ${MAX_TOOLS} items`);
    else if (tools_used.some(t => typeof t !== 'string' || t.length > MAX_TOOL_LEN))
      errors.push(`each tool must be a string of at most ${MAX_TOOL_LEN} characters`);
  }
  // A03: reject unexpected boolean coercions for featured
  if (featured !== undefined && typeof featured !== 'boolean') {
    errors.push('featured must be a boolean');
  }
  // A03: only allow https:// image URLs — blocks javascript:, data:, and http:
  if (image_url !== undefined && image_url !== null && image_url !== '') {
    if (typeof image_url !== 'string' || !/^https:\/\/.+/i.test(image_url))
      errors.push('image_url must be a valid https:// URL');
  }

  if (errors.length) {
    return res.status(400).json({ error: errors.join('; '), code: 400 });
  }
  next();
}

const MAX_LIMIT  = 100;
const MAX_OFFSET = 1_000_000;

// Validates GET query parameters to prevent injection via query string
function validateQuery(req, res, next) {
  const { category, featured, year, limit, offset } = req.query;
  const errors = [];

  if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
    errors.push(`category must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }
  if (featured !== undefined && !['true', 'false'].includes(featured)) {
    errors.push('featured must be true or false');
  }
  if (year !== undefined) {
    const y = Number(year);
    if (isNaN(y) || y < MIN_YEAR || y > MAX_YEAR)
      errors.push(`year must be between ${MIN_YEAR} and ${MAX_YEAR}`);
  }
  if (limit !== undefined) {
    const l = Number(limit);
    if (!Number.isInteger(l) || l < 1 || l > MAX_LIMIT)
      errors.push(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  if (offset !== undefined) {
    const o = Number(offset);
    if (!Number.isInteger(o) || o < 0 || o > MAX_OFFSET)
      errors.push(`offset must be a non-negative integer`);
  }

  if (errors.length) {
    return res.status(400).json({ error: errors.join('; '), code: 400 });
  }
  next();
}

// ── User / auth validation ────────────────────────────────────────────────────

const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
// phone: E.164-ish — digits, spaces, dashes, parentheses, leading +
const PHONE_RE    = /^\+?[\d\s\-().]{7,20}$/;

// avatar-01.png … avatar-40.png
const ALLOWED_AVATARS = Array.from({ length: 40 }, (_, i) =>
  `avatar-${String(i + 1).padStart(2, '0')}.png`
);

function validatePassword(password, errors) {
  if (!password || typeof password !== 'string') {
    errors.push('password is required');
    return;
  }
  if (password.length < 8)         errors.push('password must be at least 8 characters');
  if (!/[a-zA-Z]/.test(password))  errors.push('password must contain at least one letter');
  if (!/[0-9]/.test(password))     errors.push('password must contain at least one number');
}

// POST /auth/signup
function validateSignup(req, res, next) {
  const { username, email, password, phone, display_name, avatar } = req.body;
  const errors = [];

  if (!username || typeof username !== 'string') {
    errors.push('username is required');
  } else if (!USERNAME_RE.test(username)) {
    errors.push('username must be 3-30 characters, letters/numbers/underscore only');
  }

  if (!email || typeof email !== 'string') {
    errors.push('email is required');
  } else if (!EMAIL_RE.test(email.trim())) {
    errors.push('email must be a valid email address');
  }

  validatePassword(password, errors);

  if (phone !== undefined && phone !== null && phone !== '') {
    if (!PHONE_RE.test(phone)) errors.push('phone must be a valid phone number');
  }

  if (display_name !== undefined && display_name !== null) {
    if (typeof display_name !== 'string' || display_name.trim().length > 100)
      errors.push('display_name must be a string of at most 100 characters');
  }

  if (avatar !== undefined) {
    if (!ALLOWED_AVATARS.includes(avatar))
      errors.push(`avatar must be one of the allowed avatars (avatar-01.png to avatar-40.png)`);
  }

  if (errors.length) {
    return res.status(400).json({ error: errors.join('; '), code: 400 });
  }
  next();
}

// PATCH /api/v1/users/me
function validateProfileUpdate(req, res, next) {
  const { display_name, phone, avatar } = req.body;
  const errors = [];

  if (display_name !== undefined && display_name !== null) {
    if (typeof display_name !== 'string' || display_name.trim().length > 100)
      errors.push('display_name must be a string of at most 100 characters');
  }

  if (phone !== undefined && phone !== null && phone !== '') {
    if (!PHONE_RE.test(phone)) errors.push('phone must be a valid phone number');
  }

  if (avatar !== undefined) {
    if (!ALLOWED_AVATARS.includes(avatar))
      errors.push(`avatar must be one of the allowed avatars (avatar-01.png to avatar-40.png)`);
  }

  if (errors.length) {
    return res.status(400).json({ error: errors.join('; '), code: 400 });
  }
  next();
}

// POST /auth/reset-password
function validateResetPassword(req, res, next) {
  const { token, password } = req.body;
  const errors = [];

  if (!token || typeof token !== 'string') {
    errors.push('token is required');
  }

  validatePassword(password, errors);

  if (errors.length) {
    return res.status(400).json({ error: errors.join('; '), code: 400 });
  }
  next();
}

// PATCH /api/v1/users/me/password
function validatePasswordChange(req, res, next) {
  const { current_password, new_password } = req.body;
  const errors = [];

  if (!current_password || typeof current_password !== 'string') {
    errors.push('current_password is required');
  }

  validatePassword(new_password, errors);

  if (errors.length) {
    return res.status(400).json({ error: errors.join('; '), code: 400 });
  }
  next();
}

module.exports = {
  validateProject,
  validateQuery,
  validateSignup,
  validateResetPassword,
  validateProfileUpdate,
  validatePasswordChange,
  ALLOWED_AVATARS,
};
