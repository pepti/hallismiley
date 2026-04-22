// A03 Injection + A04 Insecure Design: strict input validation for all routes.
// Error messages are i18n keys — translated to req.locale just before the
// response goes out via the `_fail()` helper at the bottom of each validator.

const { t } = require('../i18n');

/** Translate an array of {key, params} entries using req.locale and return a 400. */
function _fail(req, res, errors) {
  const messages = errors.map(e => t(req.locale, e.key, e.params));
  return res.status(400).json({ error: messages.join('; '), code: 400 });
}

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
    if (!title?.trim())       errors.push({ key: 'validation.title.required' });
    if (!description?.trim()) errors.push({ key: 'validation.description.required' });
    if (!category)            errors.push({ key: 'validation.category.required' });
    if (year === undefined)   errors.push({ key: 'validation.year.required' });
  }

  // Field-level checks (apply when field is present)
  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length === 0)
      errors.push({ key: 'validation.title.nonEmptyString' });
    else if (title.length > MAX_TITLE_LEN)
      errors.push({ key: 'validation.title.maxLength', params: { n: MAX_TITLE_LEN } });
  }
  if (description !== undefined) {
    if (typeof description !== 'string' || description.trim().length === 0)
      errors.push({ key: 'validation.description.nonEmptyString' });
    else if (description.length > MAX_DESC_LEN)
      errors.push({ key: 'validation.description.maxLength', params: { n: MAX_DESC_LEN } });
  }
  if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
    errors.push({ key: 'validation.category.enum', params: { values: VALID_CATEGORIES.join(', ') } });
  }
  if (year !== undefined) {
    const y = Number(year);
    if (!Number.isInteger(y) || y < MIN_YEAR || y > MAX_YEAR)
      errors.push({ key: 'validation.year.intRange', params: { min: MIN_YEAR, max: MAX_YEAR } });
  }
  if (tools_used !== undefined) {
    if (!Array.isArray(tools_used))
      errors.push({ key: 'validation.toolsUsed.array' });
    else if (tools_used.length > MAX_TOOLS)
      errors.push({ key: 'validation.toolsUsed.maxItems', params: { n: MAX_TOOLS } });
    else if (tools_used.some(t => typeof t !== 'string' || t.length > MAX_TOOL_LEN))
      errors.push({ key: 'validation.toolsUsed.itemString', params: { n: MAX_TOOL_LEN } });
  }
  // A03: reject unexpected boolean coercions for featured
  if (featured !== undefined && typeof featured !== 'boolean') {
    errors.push({ key: 'validation.featured.boolean' });
  }
  // A03: allow https:// external URLs and /assets/ relative paths (for cover images
  // set via the media management API).  Blocks javascript:, data:, and plain http:.
  if (image_url !== undefined && image_url !== null && image_url !== '') {
    if (typeof image_url !== 'string') {
      errors.push({ key: 'validation.imageUrl.string' });
    } else if (!/^https:\/\/.+/i.test(image_url) && !/^\/assets\//i.test(image_url)) {
      errors.push({ key: 'validation.imageUrl.invalid' });
    }
  }

  if (errors.length) return _fail(req, res, errors);
  next();
}

const MAX_LIMIT  = 100;
const MAX_OFFSET = 1_000_000;

// Validates GET query parameters to prevent injection via query string
function validateQuery(req, res, next) {
  const { category, featured, year, limit, offset } = req.query;
  const errors = [];

  if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
    errors.push({ key: 'validation.category.enum', params: { values: VALID_CATEGORIES.join(', ') } });
  }
  if (featured !== undefined && !['true', 'false'].includes(featured)) {
    errors.push({ key: 'validation.featured.bool' });
  }
  if (year !== undefined) {
    const y = Number(year);
    if (isNaN(y) || y < MIN_YEAR || y > MAX_YEAR)
      errors.push({ key: 'validation.year.range', params: { min: MIN_YEAR, max: MAX_YEAR } });
  }
  if (limit !== undefined) {
    const l = Number(limit);
    if (!Number.isInteger(l) || l < 1 || l > MAX_LIMIT)
      errors.push({ key: 'validation.limit.intRange', params: { max: MAX_LIMIT } });
  }
  if (offset !== undefined) {
    const o = Number(offset);
    if (!Number.isInteger(o) || o < 0 || o > MAX_OFFSET)
      errors.push({ key: 'validation.offset.nonNegative' });
  }

  if (errors.length) return _fail(req, res, errors);
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

// User-uploaded avatars are written by the upload endpoint with a controlled
// filename pattern: user-<userId>-<timestamp>-<rand>.<ext>. This regex is the
// allowlist for uploaded avatars referenced from the avatar field.
const UPLOADED_AVATAR_RE = /^user-\d+-\d+-[a-z0-9]+\.(jpg|jpeg|png|webp)$/i;
function isAllowedAvatar(name) {
  return ALLOWED_AVATARS.includes(name) || UPLOADED_AVATAR_RE.test(name);
}

function validatePassword(password, errors) {
  if (!password || typeof password !== 'string') {
    errors.push({ key: 'validation.password.required' });
    return;
  }
  if (password.length < 8)         errors.push({ key: 'validation.password.minLength' });
  if (!/[a-zA-Z]/.test(password))  errors.push({ key: 'validation.password.letter' });
  if (!/[0-9]/.test(password))     errors.push({ key: 'validation.password.number' });
}

// POST /auth/signup
function validateSignup(req, res, next) {
  const { username, email, password, phone, display_name, avatar } = req.body;
  const errors = [];

  if (!username || typeof username !== 'string') {
    errors.push({ key: 'validation.username.required' });
  } else if (!USERNAME_RE.test(username)) {
    errors.push({ key: 'validation.username.invalid' });
  }

  if (!email || typeof email !== 'string') {
    errors.push({ key: 'validation.email.required' });
  } else if (!EMAIL_RE.test(email.trim())) {
    errors.push({ key: 'validation.email.invalid' });
  }

  validatePassword(password, errors);

  if (phone !== undefined && phone !== null && phone !== '') {
    if (!PHONE_RE.test(phone)) errors.push({ key: 'validation.phone.invalid' });
  }

  if (display_name !== undefined && display_name !== null) {
    if (typeof display_name !== 'string' || display_name.trim().length > 100)
      errors.push({ key: 'validation.displayName.maxLength', params: { n: 100 } });
  }

  if (avatar !== undefined) {
    if (!ALLOWED_AVATARS.includes(avatar))
      errors.push({ key: 'validation.avatar.invalid' });
  }

  if (errors.length) return _fail(req, res, errors);
  next();
}

// PATCH /api/v1/users/me
function validateProfileUpdate(req, res, next) {
  const { display_name, phone, avatar } = req.body;
  const errors = [];

  if (display_name !== undefined && display_name !== null) {
    if (typeof display_name !== 'string' || display_name.trim().length > 100)
      errors.push({ key: 'validation.displayName.maxLength', params: { n: 100 } });
  }

  if (phone !== undefined && phone !== null && phone !== '') {
    if (!PHONE_RE.test(phone)) errors.push({ key: 'validation.phone.invalid' });
  }

  if (avatar !== undefined) {
    if (!isAllowedAvatar(avatar))
      errors.push({ key: 'validation.avatar.invalidOrUploaded' });
  }

  if (errors.length) return _fail(req, res, errors);
  next();
}

// POST /auth/reset-password
function validateResetPassword(req, res, next) {
  const { token, password } = req.body;
  const errors = [];

  if (!token || typeof token !== 'string') {
    errors.push({ key: 'validation.token.required' });
  }

  validatePassword(password, errors);

  if (errors.length) return _fail(req, res, errors);
  next();
}

// PATCH /api/v1/users/me/password
function validatePasswordChange(req, res, next) {
  const { current_password, new_password } = req.body;
  const errors = [];

  if (!current_password || typeof current_password !== 'string') {
    errors.push({ key: 'validation.currentPassword.required' });
  }

  validatePassword(new_password, errors);

  if (errors.length) return _fail(req, res, errors);
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
      errors.push({ key: 'validation.caption.string' });
    else if (caption.length > MAX_CAPTION_LEN)
      errors.push({ key: 'validation.caption.maxLength', params: { n: MAX_CAPTION_LEN } });
  }

  if (sort_order !== undefined) {
    const s = Number(sort_order);
    if (!Number.isInteger(s) || s < 0)
      errors.push({ key: 'validation.sortOrder.nonNegative' });
  }

  if (section_id !== undefined && section_id !== null) {
    const s = Number(section_id);
    if (!Number.isInteger(s) || s <= 0)
      errors.push({ key: 'validation.sectionId.positiveOrNull' });
  }

  if (errors.length) return _fail(req, res, errors);
  next();
}

// PATCH /api/v1/projects/:id/media/reorder
function validateReorder(req, res, next) {
  const { order } = req.body;
  const errors = [];

  if (!Array.isArray(order) || order.length === 0) {
    errors.push({ key: 'validation.order.nonEmptyArray' });
  } else if (order.length > MAX_REORDER_LEN) {
    errors.push({ key: 'validation.order.maxItems', params: { n: MAX_REORDER_LEN } });
  } else {
    for (let i = 0; i < order.length; i++) {
      const item = order[i];
      if (typeof item !== 'object' || item === null) {
        errors.push({ key: 'validation.order.itemObject', params: { i } });
        continue;
      }
      const id  = Number(item.id);
      const so  = Number(item.sort_order);
      if (!Number.isInteger(id) || id <= 0)
        errors.push({ key: 'validation.order.itemIdPositive', params: { i } });
      if (!Number.isInteger(so) || so < 0)
        errors.push({ key: 'validation.order.itemSortOrderNonNegative', params: { i } });
      if (item.section_id !== undefined && item.section_id !== null) {
        const sid = Number(item.section_id);
        if (!Number.isInteger(sid) || sid <= 0)
          errors.push({ key: 'validation.order.itemSectionIdPositiveOrNull', params: { i } });
      }
    }
  }

  if (errors.length) return _fail(req, res, errors);
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
      errors.push({ key: 'validation.name.required' });
    }
  } else {
    // PATCH — must include at least one editable field
    if (name === undefined && description === undefined) {
      errors.push({ key: 'validation.nameOrDescription.required' });
    }
  }

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      errors.push({ key: 'validation.name.nonEmptyString' });
    } else if (name.length > MAX_SECTION_NAME_LEN) {
      errors.push({ key: 'validation.name.maxLength', params: { n: MAX_SECTION_NAME_LEN } });
    }
  }

  if (description !== undefined && description !== null) {
    if (typeof description !== 'string') {
      errors.push({ key: 'validation.description.string' });
    } else if (description.length > MAX_SECTION_DESC_LEN) {
      errors.push({ key: 'validation.description.maxLength', params: { n: MAX_SECTION_DESC_LEN } });
    }
  }

  if (errors.length) return _fail(req, res, errors);
  next();
}

// ── Video validation ─────────────────────────────────────────────────────────

const MAX_VIDEO_TITLE_LEN = 200;

// PATCH /api/v1/projects/:id/videos/:videoId — currently only title can change
function validateVideoUpdate(req, res, next) {
  const { title } = req.body;
  const errors = [];

  if (title !== undefined && title !== null) {
    if (typeof title !== 'string')
      errors.push({ key: 'validation.videoTitle.string' });
    else if (title.length > MAX_VIDEO_TITLE_LEN)
      errors.push({ key: 'validation.videoTitle.maxLength', params: { n: MAX_VIDEO_TITLE_LEN } });
  }

  if (errors.length) return _fail(req, res, errors);
  next();
}

// PATCH /api/v1/projects/:id/videos/reorder
function validateVideoReorder(req, res, next) {
  const { order } = req.body;
  const errors = [];

  if (!Array.isArray(order) || order.length === 0) {
    errors.push({ key: 'validation.order.nonEmptyArray' });
  } else if (order.length > MAX_REORDER_LEN) {
    errors.push({ key: 'validation.order.maxItems', params: { n: MAX_REORDER_LEN } });
  } else {
    for (let i = 0; i < order.length; i++) {
      const item = order[i];
      if (typeof item !== 'object' || item === null) {
        errors.push({ key: 'validation.order.itemObject', params: { i } }); continue;
      }
      const id = Number(item.id);
      const so = Number(item.sort_order);
      if (!Number.isInteger(id) || id <= 0)
        errors.push({ key: 'validation.order.itemIdPositive', params: { i } });
      if (!Number.isInteger(so) || so < 0)
        errors.push({ key: 'validation.order.itemSortOrderNonNegative', params: { i } });
    }
  }

  if (errors.length) return _fail(req, res, errors);
  next();
}

// PATCH /api/v1/projects/:id/sections/reorder
function validateSectionReorder(req, res, next) {
  const { order } = req.body;
  const errors = [];

  if (!Array.isArray(order) || order.length === 0) {
    errors.push({ key: 'validation.order.nonEmptyArray' });
  } else {
    for (let i = 0; i < order.length; i++) {
      const item = order[i];
      if (typeof item !== 'object' || item === null) {
        errors.push({ key: 'validation.order.itemObject', params: { i } });
        continue;
      }
      const id = Number(item.id);
      const so = Number(item.sort_order);
      if (!Number.isInteger(id) || id <= 0)
        errors.push({ key: 'validation.order.itemIdPositive', params: { i } });
      if (!Number.isInteger(so) || so < 0)
        errors.push({ key: 'validation.order.itemSortOrderNonNegative', params: { i } });
    }
  }

  if (errors.length) return _fail(req, res, errors);
  next();
}

// ── News validation ───────────────────────────────────────────────────────────

const MAX_NEWS_TITLE_LEN   = 200;
const MAX_NEWS_SUMMARY_LEN = 300;
const SLUG_RE              = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// POST /api/v1/news  and  PATCH /api/v1/news/:id
function validateNews(req, res, next) {
  const {
    title, slug, summary, body, cover_image,
    title_is, summary_is, body_is, cover_image_is,
    category, published,
  } = req.body;
  const errors  = [];
  const isPOST  = req.method === 'POST';

  // Required on creation
  if (isPOST) {
    if (!title?.trim())   errors.push({ key: 'validation.title.required' });
    if (!summary?.trim()) errors.push({ key: 'validation.summary.required' });
    if (!body?.trim())    errors.push({ key: 'validation.body.required' });
  }

  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length === 0)
      errors.push({ key: 'validation.title.nonEmptyString' });
    else if (title.length > MAX_NEWS_TITLE_LEN)
      errors.push({ key: 'validation.title.maxLength', params: { n: MAX_NEWS_TITLE_LEN } });
  }

  if (slug !== undefined && slug !== null && slug !== '') {
    if (typeof slug !== 'string' || !SLUG_RE.test(slug))
      errors.push({ key: 'validation.slug.invalid' });
    else if (slug.length > 100)
      errors.push({ key: 'validation.slug.maxLength', params: { n: 100 } });
  }

  if (summary !== undefined) {
    if (typeof summary !== 'string' || summary.trim().length === 0)
      errors.push({ key: 'validation.summary.nonEmptyString' });
    else if (summary.length > MAX_NEWS_SUMMARY_LEN)
      errors.push({ key: 'validation.summary.maxLength', params: { n: MAX_NEWS_SUMMARY_LEN } });
  }

  if (body !== undefined) {
    if (typeof body !== 'string' || body.trim().length === 0)
      errors.push({ key: 'validation.body.nonEmptyString' });
  }

  if (cover_image !== undefined && cover_image !== null && cover_image !== '') {
    if (typeof cover_image !== 'string') {
      errors.push({ key: 'validation.coverImage.string' });
    } else if (!/^https:\/\/.+/i.test(cover_image) && !/^\/assets\//i.test(cover_image)) {
      errors.push({ key: 'validation.coverImage.invalid' });
    }
  }

  if (category !== undefined) {
    if (typeof category !== 'string' || category.trim().length === 0)
      errors.push({ key: 'validation.category.nonEmptyString' });
    else if (category.length > 50)
      errors.push({ key: 'validation.category.maxLength', params: { n: 50 } });
  }

  if (published !== undefined && typeof published !== 'boolean') {
    errors.push({ key: 'validation.published.boolean' });
  }

  // Icelandic siblings — nullable but when supplied must match the same
  // format/length constraints as their English counterparts.
  if (title_is !== undefined && title_is !== null) {
    if (typeof title_is !== 'string') errors.push({ key: 'validation.title.nonEmptyString' });
    else if (title_is.length > MAX_NEWS_TITLE_LEN)
      errors.push({ key: 'validation.title.maxLength', params: { n: MAX_NEWS_TITLE_LEN } });
  }
  if (summary_is !== undefined && summary_is !== null) {
    if (typeof summary_is !== 'string') errors.push({ key: 'validation.summary.nonEmptyString' });
    else if (summary_is.length > MAX_NEWS_SUMMARY_LEN)
      errors.push({ key: 'validation.summary.maxLength', params: { n: MAX_NEWS_SUMMARY_LEN } });
  }
  if (body_is !== undefined && body_is !== null) {
    if (typeof body_is !== 'string') errors.push({ key: 'validation.body.nonEmptyString' });
  }
  if (cover_image_is !== undefined && cover_image_is !== null && cover_image_is !== '') {
    if (typeof cover_image_is !== 'string') {
      errors.push({ key: 'validation.coverImage.string' });
    } else if (!/^https:\/\/.+/i.test(cover_image_is) && !/^\/assets\//i.test(cover_image_is)) {
      errors.push({ key: 'validation.coverImage.invalid' });
    }
  }

  if (errors.length) return _fail(req, res, errors);
  next();
}

// ── News media validation ────────────────────────────────────────────────────

// PATCH /api/v1/news/:id/media/:mediaId
function validateNewsMediaUpdate(req, res, next) {
  const { caption } = req.body;
  const errors = [];

  if (caption !== undefined && caption !== null) {
    if (typeof caption !== 'string')
      errors.push({ key: 'validation.caption.string' });
    else if (caption.length > MAX_CAPTION_LEN)
      errors.push({ key: 'validation.caption.maxLength', params: { n: MAX_CAPTION_LEN } });
  }

  if (errors.length) return _fail(req, res, errors);
  next();
}

// PUT /api/v1/news/:id/media/reorder
function validateNewsMediaReorder(req, res, next) {
  const { order } = req.body;
  const errors = [];

  if (!Array.isArray(order) || order.length === 0) {
    errors.push({ key: 'validation.order.nonEmptyArray' });
  } else if (order.length > MAX_REORDER_LEN) {
    errors.push({ key: 'validation.order.maxItems', params: { n: MAX_REORDER_LEN } });
  } else {
    for (let i = 0; i < order.length; i++) {
      const item = order[i];
      if (typeof item !== 'object' || item === null) {
        errors.push({ key: 'validation.order.itemObject', params: { i } });
        continue;
      }
      const id = Number(item.id);
      const so = Number(item.sort_order);
      if (!Number.isInteger(id) || id <= 0)
        errors.push({ key: 'validation.order.itemIdPositive', params: { i } });
      if (!Number.isInteger(so) || so < 0)
        errors.push({ key: 'validation.order.itemSortOrderNonNegative', params: { i } });
    }
  }

  if (errors.length) return _fail(req, res, errors);
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
  validateVideoUpdate,
  validateVideoReorder,
  validateNews,
  validateNewsMediaUpdate,
  validateNewsMediaReorder,
  ALLOWED_AVATARS,
};
