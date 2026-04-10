// A03 Injection + A04 Insecure Design: strict input validation for all routes

// ── Project validation ────────────────────────────────────────────────────────

const VALID_CATEGORIES = ['carpentry', 'tech'];
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;
const MAX_TITLE_LEN = 200;
const MAX_DESC_LEN  = 10000;
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
  // A03: allow https:// external URLs and /assets/ relative paths (for cover images
  // set via the media management API).  Blocks javascript:, data:, and plain http:.
  if (image_url !== undefined && image_url !== null && image_url !== '') {
    if (typeof image_url !== 'string') {
      errors.push('image_url must be a string');
    } else if (!/^https:\/\/.+/i.test(image_url) && !/^\/assets\//i.test(image_url)) {
      errors.push('image_url must be a valid https:// URL or a relative /assets/ path');
    }
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

// avatar-01.svg … avatar-40.svg
const ALLOWED_AVATARS = Array.from({ length: 40 }, (_, i) =>
  `avatar-${String(i + 1).padStart(2, '0')}.svg`
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
      errors.push(`avatar must be one of the allowed avatars (avatar-01.svg to avatar-40.svg)`);
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
      errors.push(`avatar must be one of the allowed avatars (avatar-01.svg to avatar-40.svg)`);
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

// ── Media validation ──────────────────────────────────────────────────────────

const MAX_CAPTION_LEN = 500;
const MAX_REORDER_LEN = 1000;

// PATCH /api/v1/projects/:id/media/:mediaId
function validateMediaUpdate(req, res, next) {
  const { caption, sort_order, section_id } = req.body;
  const errors = [];

  if (caption !== undefined && caption !== null) {
    if (typeof caption !== 'string')
      errors.push('caption must be a string');
    else if (caption.length > MAX_CAPTION_LEN)
      errors.push(`caption must be at most ${MAX_CAPTION_LEN} characters`);
  }

  if (sort_order !== undefined) {
    const s = Number(sort_order);
    if (!Number.isInteger(s) || s < 0)
      errors.push('sort_order must be a non-negative integer');
  }

  if (section_id !== undefined && section_id !== null) {
    const s = Number(section_id);
    if (!Number.isInteger(s) || s <= 0)
      errors.push('section_id must be a positive integer or null');
  }

  if (errors.length) return res.status(400).json({ error: errors.join('; '), code: 400 });
  next();
}

// PATCH /api/v1/projects/:id/media/reorder
function validateReorder(req, res, next) {
  const { order } = req.body;
  const errors = [];

  if (!Array.isArray(order) || order.length === 0) {
    errors.push('order must be a non-empty array');
  } else if (order.length > MAX_REORDER_LEN) {
    errors.push(`order must contain at most ${MAX_REORDER_LEN} items`);
  } else {
    for (let i = 0; i < order.length; i++) {
      const item = order[i];
      if (typeof item !== 'object' || item === null) {
        errors.push(`order[${i}] must be an object`);
        continue;
      }
      const id  = Number(item.id);
      const so  = Number(item.sort_order);
      if (!Number.isInteger(id) || id <= 0)
        errors.push(`order[${i}].id must be a positive integer`);
      if (!Number.isInteger(so) || so < 0)
        errors.push(`order[${i}].sort_order must be a non-negative integer`);
      if (item.section_id !== undefined && item.section_id !== null) {
        const sid = Number(item.section_id);
        if (!Number.isInteger(sid) || sid <= 0)
          errors.push(`order[${i}].section_id must be a positive integer or null`);
      }
    }
  }

  if (errors.length) return res.status(400).json({ error: errors.join('; '), code: 400 });
  next();
}

// ── Section validation ───────────────────────────────────────────────────────

const MAX_SECTION_NAME_LEN = 80;
const MAX_SECTION_DESC_LEN = 2000;

// POST /api/v1/projects/:id/sections  and  PATCH /api/v1/projects/:id/sections/:sectionId
// POST: name is required. PATCH: at least one of name/description must be supplied.
function validateSection(req, res, next) {
  const { name, description } = req.body;
  const errors = [];
  const isPOST = req.method === 'POST';

  if (isPOST) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      errors.push('name is required');
    }
  } else {
    // PATCH — must include at least one editable field
    if (name === undefined && description === undefined) {
      errors.push('at least one of name or description is required');
    }
  }

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      errors.push('name must be a non-empty string');
    } else if (name.length > MAX_SECTION_NAME_LEN) {
      errors.push(`name must be at most ${MAX_SECTION_NAME_LEN} characters`);
    }
  }

  if (description !== undefined && description !== null) {
    if (typeof description !== 'string') {
      errors.push('description must be a string');
    } else if (description.length > MAX_SECTION_DESC_LEN) {
      errors.push(`description must be at most ${MAX_SECTION_DESC_LEN} characters`);
    }
  }

  if (errors.length) return res.status(400).json({ error: errors.join('; '), code: 400 });
  next();
}

// PATCH /api/v1/projects/:id/sections/reorder
function validateSectionReorder(req, res, next) {
  const { order } = req.body;
  const errors = [];

  if (!Array.isArray(order) || order.length === 0) {
    errors.push('order must be a non-empty array');
  } else {
    for (let i = 0; i < order.length; i++) {
      const item = order[i];
      if (typeof item !== 'object' || item === null) {
        errors.push(`order[${i}] must be an object`);
        continue;
      }
      const id = Number(item.id);
      const so = Number(item.sort_order);
      if (!Number.isInteger(id) || id <= 0)
        errors.push(`order[${i}].id must be a positive integer`);
      if (!Number.isInteger(so) || so < 0)
        errors.push(`order[${i}].sort_order must be a non-negative integer`);
    }
  }

  if (errors.length) return res.status(400).json({ error: errors.join('; '), code: 400 });
  next();
}

// ── News validation ───────────────────────────────────────────────────────────

const MAX_NEWS_TITLE_LEN   = 200;
const MAX_NEWS_SUMMARY_LEN = 300;
const SLUG_RE              = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// POST /api/v1/news  and  PATCH /api/v1/news/:id
function validateNews(req, res, next) {
  const { title, slug, summary, body, cover_image, category, published } = req.body;
  const errors  = [];
  const isPOST  = req.method === 'POST';

  // Required on creation
  if (isPOST) {
    if (!title?.trim())   errors.push('title is required');
    if (!summary?.trim()) errors.push('summary is required');
    if (!body?.trim())    errors.push('body is required');
  }

  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length === 0)
      errors.push('title must be a non-empty string');
    else if (title.length > MAX_NEWS_TITLE_LEN)
      errors.push(`title must be at most ${MAX_NEWS_TITLE_LEN} characters`);
  }

  if (slug !== undefined && slug !== null && slug !== '') {
    if (typeof slug !== 'string' || !SLUG_RE.test(slug))
      errors.push('slug must contain only lowercase letters, numbers and hyphens');
    else if (slug.length > 100)
      errors.push('slug must be at most 100 characters');
  }

  if (summary !== undefined) {
    if (typeof summary !== 'string' || summary.trim().length === 0)
      errors.push('summary must be a non-empty string');
    else if (summary.length > MAX_NEWS_SUMMARY_LEN)
      errors.push(`summary must be at most ${MAX_NEWS_SUMMARY_LEN} characters`);
  }

  if (body !== undefined) {
    if (typeof body !== 'string' || body.trim().length === 0)
      errors.push('body must be a non-empty string');
  }

  if (cover_image !== undefined && cover_image !== null && cover_image !== '') {
    if (typeof cover_image !== 'string') {
      errors.push('cover_image must be a string');
    } else if (!/^https:\/\/.+/i.test(cover_image) && !/^\/assets\//i.test(cover_image)) {
      errors.push('cover_image must be a valid https:// URL or a relative /assets/ path');
    }
  }

  if (category !== undefined) {
    if (typeof category !== 'string' || category.trim().length === 0)
      errors.push('category must be a non-empty string');
    else if (category.length > 50)
      errors.push('category must be at most 50 characters');
  }

  if (published !== undefined && typeof published !== 'boolean') {
    errors.push('published must be a boolean');
  }

  if (errors.length) return res.status(400).json({ error: errors.join('; '), code: 400 });
  next();
}

module.exports = {
  validateProject,
  validateQuery,
  validateSignup,
  validateResetPassword,
  validateProfileUpdate,
  validatePasswordChange,
  validateMediaUpdate,
  validateReorder,
  validateSection,
  validateSectionReorder,
  validateNews,
  ALLOWED_AVATARS,
};
