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
  const {
    title, description, category, year, tools_used, image_url, featured,
    title_is, description_is,
  } = req.body;
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

  // Icelandic siblings — nullable but length-capped when supplied.
  if (title_is !== undefined && title_is !== null && title_is !== '') {
    if (typeof title_is !== 'string')
      errors.push({ key: 'validation.title.nonEmptyString' });
    else if (title_is.length > MAX_TITLE_LEN)
      errors.push({ key: 'validation.title.maxLength', params: { n: MAX_TITLE_LEN } });
  }
  if (description_is !== undefined && description_is !== null && description_is !== '') {
    if (typeof description_is !== 'string')
      errors.push({ key: 'validation.description.string' });
    else if (description_is.length > MAX_DESC_LEN)
      errors.push({ key: 'validation.description.maxLength', params: { n: MAX_DESC_LEN } });
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
// EMAIL_RE backtracks quadratically on a long run of '.' between two '@'
// ('a@' + '.'.repeat(99000) + '@' held the event loop 3.5 s, on the anonymous
// signup route). An address is at most 254 characters (RFC 5321), so the length
// check runs first and the regex only ever sees a short string. Stricter, not
// looser. Use isEmail(), never EMAIL_RE.test() on request input.
const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);
// Icelandic letters (both cases) are allowed so OAuth-derived usernames like
// "jónþórsson" pass validation on subsequent profile updates.
const USERNAME_RE = /^[a-zA-Z0-9_áéíóúýðþæöÁÉÍÓÚÝÐÞÆÖ]{3,40}$/;
// phone: PHONE_RE (E.164-ish — digits, spaces, dashes, parentheses, leading +)
// lives in utils/contactFormat.js, shared with the client forms so both refuse
// the same values (ported from icelandicstore #399).
const { PHONE_RE, isValidPhone, isValidZip } = require('../utils/contactFormat');

// avatar-01.svg … avatar-40.svg
const ALLOWED_AVATARS = Array.from({ length: 40 }, (_, i) =>
  `avatar-${String(i + 1).padStart(2, '0')}.svg`
);

// User-uploaded avatars are written by the upload endpoint with a controlled
// filename pattern: user-<userId>-<timestamp>-<rand>.<ext> (built in
// server/routes/userRoutes.js). This regex is the allowlist for uploaded
// avatars referenced from the avatar field, and doubles as the unlink guard in
// userController._tryUnlinkAvatar — keep the id segment free of dots/slashes so
// a matching value can never name a path outside the avatars dir. users.id is
// TEXT (gen_random_uuid()::text, [A-Za-z0-9-] in practice), not numeric: the
// earlier `\d+` could never match a real upload, so every uploaded avatar was
// rejected here and superseded files were never unlinked. Shape alone is not
// enough, though — see the owner check below. (Ported from icelandicstore #145.)
const UPLOADED_AVATAR_RE = /^user-[A-Za-z0-9-]+-\d+-[a-z0-9]+\.(jpg|jpeg|png|webp)$/i;

// An uploaded avatar belongs to exactly one user — the upload endpoint bakes the
// owner's id into the filename. Ownership has to be proved, not just shape:
// UPLOAD_ROOT/avatars is one flat shared directory, so a user who could name
// someone else's file would both wear their picture and — on their next upload —
// have _tryUnlinkAvatar delete it out from under them.
function ownedUploadedAvatarRe(userId) {
  const esc = String(userId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^user-${esc}-\\d+-[a-z0-9]+\\.(jpg|jpeg|png|webp)$`, 'i');
}

// Both checks must pass. UPLOADED_AVATAR_RE keeps the value path-safe whatever
// the id turns out to contain (no dots, no separators — it is also the unlink
// guard); the owner regex proves the file is the caller's own.
function isOwnUploadedAvatar(name, userId) {
  if (!name || !userId) return false;
  return UPLOADED_AVATAR_RE.test(name) && ownedUploadedAvatarRe(userId).test(name);
}

function isAllowedAvatar(name, userId) {
  return ALLOWED_AVATARS.includes(name) || isOwnUploadedAvatar(name, userId);
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
  } else if (!isEmail(email.trim())) {
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

// POST /api/v1/party/request-access  { name, email }
// Lightweight guest sign-up: name + email only (no password / username). The
// controller auto-generates a username and creates a passwordless pending account.
function validatePartyRequest(req, res, next) {
  const { name, email } = req.body || {};
  const errors = [];

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    errors.push({ key: 'validation.name.required' });
  } else if (name.trim().length > 100) {
    errors.push({ key: 'validation.displayName.maxLength', params: { n: 100 } });
  }

  if (!email || typeof email !== 'string') {
    errors.push({ key: 'validation.email.required' });
  } else if (!isEmail(email.trim())) {
    errors.push({ key: 'validation.email.invalid' });
  }

  if (errors.length) return _fail(req, res, errors);
  next();
}

// PATCH /api/v1/users/me
function validateProfileUpdate(req, res, next) {
  const { display_name, phone, avatar } = req.body;
  // Trim whitespace so "  bob  " can't sneak past the unique-index check
  // by differing in invisible characters from "bob". Mutating req.body here
  // means downstream (controller, DB UPDATE) sees the canonical form.
  if (typeof req.body.username === 'string') {
    req.body.username = req.body.username.trim();
  }
  const { username } = req.body;
  const errors = [];

  if (username !== undefined) {
    if (!username || typeof username !== 'string') {
      errors.push({ key: 'validation.username.required' });
    } else if (!USERNAME_RE.test(username)) {
      errors.push({ key: 'validation.username.invalid' });
    }
  }

  if (display_name !== undefined && display_name !== null) {
    if (typeof display_name !== 'string' || display_name.trim().length > 100)
      errors.push({ key: 'validation.displayName.maxLength', params: { n: 100 } });
  }

  if (phone !== undefined && phone !== null && phone !== '') {
    if (!PHONE_RE.test(phone)) errors.push({ key: 'validation.phone.invalid' });
  }

  if (avatar !== undefined) {
    // req.user is always set — this route sits behind requireAuth.
    if (!isAllowedAvatar(avatar, req.user?.id))
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

// ── Sales-guide validation ───────────────────────────────────────────────────
// Guides are Icelandic-canonical: title/summary/body ARE the IS copy and the
// `_en` siblings are optional (inverse of the news `_is` convention).

const GUIDE_SECTIONS = ['grunnur', 'sala', 'thjonusta', 'vara'];

// POST /api/v1/admin/handbok  and  PATCH /api/v1/admin/handbok/:id
function validateGuide(req, res, next) {
  const {
    title, slug, summary, body, section,
    title_en, summary_en, body_en,
    sort_order, published,
  } = req.body;
  const errors = [];
  const isPOST = req.method === 'POST';

  // Required on creation (Icelandic canonical fields)
  if (isPOST) {
    if (!title?.trim()) errors.push({ key: 'validation.title.required' });
    if (!body?.trim())  errors.push({ key: 'validation.body.required' });
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

  if (summary !== undefined && summary !== null) {
    if (typeof summary !== 'string')
      errors.push({ key: 'validation.summary.nonEmptyString' });
    else if (summary.length > MAX_NEWS_SUMMARY_LEN)
      errors.push({ key: 'validation.summary.maxLength', params: { n: MAX_NEWS_SUMMARY_LEN } });
  }

  if (body !== undefined) {
    if (typeof body !== 'string' || body.trim().length === 0)
      errors.push({ key: 'validation.body.nonEmptyString' });
  }

  if (section !== undefined) {
    if (typeof section !== 'string' || !GUIDE_SECTIONS.includes(section))
      errors.push({ key: 'validation.section.invalid' });
  }

  if (sort_order !== undefined) {
    if (!Number.isInteger(sort_order) || sort_order < 0)
      errors.push({ key: 'validation.order.itemSortOrderNonNegative', params: { i: 0 } });
  }

  if (published !== undefined && typeof published !== 'boolean') {
    errors.push({ key: 'validation.published.boolean' });
  }

  // English siblings — nullable, same constraints as their IS counterparts.
  if (title_en !== undefined && title_en !== null) {
    if (typeof title_en !== 'string') errors.push({ key: 'validation.title.nonEmptyString' });
    else if (title_en.length > MAX_NEWS_TITLE_LEN)
      errors.push({ key: 'validation.title.maxLength', params: { n: MAX_NEWS_TITLE_LEN } });
  }
  if (summary_en !== undefined && summary_en !== null) {
    if (typeof summary_en !== 'string') errors.push({ key: 'validation.summary.nonEmptyString' });
    else if (summary_en.length > MAX_NEWS_SUMMARY_LEN)
      errors.push({ key: 'validation.summary.maxLength', params: { n: MAX_NEWS_SUMMARY_LEN } });
  }
  if (body_en !== undefined && body_en !== null) {
    if (typeof body_en !== 'string') errors.push({ key: 'validation.body.nonEmptyString' });
  }

  if (errors.length) return _fail(req, res, errors);
  next();
}

// PUT /api/v1/admin/handbok/reorder — [{ id, section, sort_order }, ...]
function validateGuideReorder(req, res, next) {
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
      if (item.section !== undefined && !GUIDE_SECTIONS.includes(item.section))
        errors.push({ key: 'validation.section.invalid' });
    }
  }

  if (errors.length) return _fail(req, res, errors);
  next();
}

// ── Leads inbox (workflow fields only) ───────────────────────────────────────
// PATCH /api/v1/admin/leads/:id. The body is WHITELISTED to the three workflow
// fields — name, email, message and the other submission fields are what the
// visitor wrote and are immutable; anything else sent is dropped, not rejected,
// so a client carrying a stale row shape keeps working.
const LEAD_STATUSES = ['new', 'contacted', 'won', 'lost'];
const MAX_LEAD_NOTE_LEN = 4000;

function validateLeadUpdate(req, res, next) {
  const src = req.body || {};
  const errors = [];
  const picked = {};

  if (src.status !== undefined) {
    if (typeof src.status !== 'string' || !LEAD_STATUSES.includes(src.status))
      errors.push({ key: 'validation.lead.statusInvalid' });
    else picked.status = src.status;
  }
  if (src.note !== undefined) {
    if (src.note === null || src.note === '') picked.note = null;
    else if (typeof src.note !== 'string') errors.push({ key: 'validation.lead.noteInvalid' });
    else if (src.note.length > MAX_LEAD_NOTE_LEN)
      errors.push({ key: 'validation.lead.noteMaxLength', params: { n: MAX_LEAD_NOTE_LEN } });
    else picked.note = src.note;
  }
  if (src.owner_user_id !== undefined) {
    if (src.owner_user_id === null || src.owner_user_id === '') picked.owner_user_id = null;
    else if (typeof src.owner_user_id !== 'string' || src.owner_user_id.length > 64)
      errors.push({ key: 'validation.lead.ownerInvalid' });
    else picked.owner_user_id = src.owner_user_id;
  }

  if (!errors.length && Object.keys(picked).length === 0)
    errors.push({ key: 'validation.lead.noFields' });

  if (errors.length) return _fail(req, res, errors);
  req.body = picked;
  next();
}

// ── Markaður status hand-off ─────────────────────────────────────────────────
// PATCH /api/v1/admin/markadur/:id/status. The body is exactly { status } and
// the target is one of the two the app may set; the transition itself
// (only FROM shortlist) is checked in the controller against the live row.
const MARKET_TARGET_STATUSES = ['handed_to_sales', 'rejected'];

function validateMarketStatus(req, res, next) {
  const { status } = req.body || {};
  if (typeof status !== 'string' || !MARKET_TARGET_STATUSES.includes(status)) {
    return _fail(req, res, [{ key: 'validation.marketStatus.invalid' }]);
  }
  req.body = { status };
  next();
}

// ── Customer accounts (migration 098) ────────────────────────────────────────
// Whitelisted body for POST / PATCH /api/v1/admin/accounts. Owner and status
// have their own rules: `owner_user_id` is only honoured for unscoped callers
// (controller), `status` moves through the model's transition map.
const ACCOUNT_TIERS    = ['vefur', 'verslun', 'rekstur'];
const ACCOUNT_STATUSES = ['lead', 'offered', 'signed', 'provisioning', 'building', 'live', 'paused', 'churned'];
const ACCOUNT_SLUG_RE  = /^[a-z0-9-]{3,40}$/;
const KENNITALA_RE     = /^\d{10}$/;
const ISO_DATE_RE      = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_TEXT = {           // field → max length
  name: 200, contact_name: 150, contact_email: 200, contact_phone: 40,
  repo_name: 100, test_url: 300, prod_url: 300, canonical_host: 200,
  azure_subscription_id: 100, azure_rg_test: 100, azure_rg_prod: 100,
  // The buyer party block (migration 100). Lengths mirror
  // Setting.updateBookkeepingSettings, so the two sides of an invoice are
  // bounded identically.
  street: 200, city: 120, postal_zone: 20, vat_number: 20, endpoint_id: 50,
  notes: 4000,
};
const ACCOUNT_INTS = {           // field → [min, max]
  build_fee_isk: [0, 1e12], monthly_fee_isk: [0, 1e12], quota_units: [0, 100000],
  build_rate_bp: [0, 10000], recurring_rate_bp: [0, 10000],
};

function _accountBody(src, errors, { isCreate }) {
  const picked = {};
  for (const [field, max] of Object.entries(ACCOUNT_TEXT)) {
    const v = src[field];
    if (v === undefined) continue;
    if (v === null || v === '') { if (field !== 'name') picked[field] = null; else errors.push({ key: 'validation.account.nameRequired' }); continue; }
    if (typeof v !== 'string') { errors.push({ key: 'validation.account.fieldInvalid', params: { field } }); continue; }
    if (v.length > max) { errors.push({ key: 'validation.account.fieldMaxLength', params: { field, n: max } }); continue; }
    picked[field] = v.trim();
  }
  if (src.contact_email && typeof src.contact_email === 'string' && !isEmail(src.contact_email.trim())) {
    errors.push({ key: 'validation.account.emailInvalid' });
  }
  for (const [field, [min, max]] of Object.entries(ACCOUNT_INTS)) {
    const v = src[field];
    if (v === undefined) continue;
    if (v === null || v === '') { picked[field] = null; continue; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) { errors.push({ key: 'validation.account.fieldInvalid', params: { field } }); continue; }
    picked[field] = n;
  }
  for (const field of ['contract_start', 'contract_end']) {
    const v = src[field];
    if (v === undefined) continue;
    if (v === null || v === '') { picked[field] = null; continue; }
    if (typeof v !== 'string' || !ISO_DATE_RE.test(v)) { errors.push({ key: 'validation.account.fieldInvalid', params: { field } }); continue; }
    picked[field] = v;
  }
  if (src.kennitala !== undefined) {
    if (src.kennitala === null || src.kennitala === '') picked.kennitala = null;
    else if (typeof src.kennitala !== 'string' || !KENNITALA_RE.test(src.kennitala.trim())) errors.push({ key: 'validation.account.kennitalaInvalid' });
    else picked.kennitala = src.kennitala.trim();
  }
  // BT-55. Uppercased before the shape test so "is" is a typo, not a refusal;
  // the DB CHECK admits NULL or two capitals and nothing else.
  if (src.country !== undefined) {
    if (src.country === null || src.country === '') picked.country = null;
    else if (typeof src.country !== 'string' || !/^[A-Za-z]{2}$/.test(src.country.trim())) errors.push({ key: 'validation.account.countryInvalid' });
    else picked.country = src.country.trim().toUpperCase();
  }
  // BT-49-1: an ISO 6523 ICD / Peppol EAS code. 0196 is the kennitala.
  if (src.endpoint_scheme !== undefined) {
    if (src.endpoint_scheme === null || src.endpoint_scheme === '') picked.endpoint_scheme = null;
    else if (typeof src.endpoint_scheme !== 'string' || !/^[0-9]{4}$/.test(src.endpoint_scheme.trim())) errors.push({ key: 'validation.account.endpointSchemeInvalid' });
    else picked.endpoint_scheme = src.endpoint_scheme.trim();
  }
  if (src.tier !== undefined) {
    if (typeof src.tier !== 'string' || !ACCOUNT_TIERS.includes(src.tier)) errors.push({ key: 'validation.account.tierInvalid' });
    else picked.tier = src.tier;
  }
  if (isCreate) {
    if (src.slug !== undefined && src.slug !== null && src.slug !== '') {
      if (typeof src.slug !== 'string' || !ACCOUNT_SLUG_RE.test(src.slug)) errors.push({ key: 'validation.account.slugInvalid' });
      else picked.slug = src.slug;
    }
    if (src.market_company_id !== undefined && src.market_company_id !== null && src.market_company_id !== '') {
      const n = Number(src.market_company_id);
      if (!Number.isInteger(n) || n <= 0) errors.push({ key: 'validation.account.fieldInvalid', params: { field: 'market_company_id' } });
      else picked.market_company_id = n;
    }
    if (src.owner_user_id !== undefined && src.owner_user_id !== null && src.owner_user_id !== '') {
      if (typeof src.owner_user_id !== 'string' || src.owner_user_id.length > 64) errors.push({ key: 'validation.account.fieldInvalid', params: { field: 'owner_user_id' } });
      else picked.owner_user_id = src.owner_user_id;
    }
    // name + tier are required unless a market company supplies them.
    if (!picked.market_company_id) {
      if (!picked.name) errors.push({ key: 'validation.account.nameRequired' });
      if (!picked.tier) errors.push({ key: 'validation.account.tierInvalid' });
    }
  } else if (src.status !== undefined) {
    if (typeof src.status !== 'string' || !ACCOUNT_STATUSES.includes(src.status)) errors.push({ key: 'validation.account.statusInvalid' });
    else picked.status = src.status;
  }
  return picked;
}

function validateAccountCreate(req, res, next) {
  const errors = [];
  const picked = _accountBody(req.body || {}, errors, { isCreate: true });
  if (errors.length) return _fail(req, res, errors);
  req.body = picked;
  next();
}

function validateAccountPatch(req, res, next) {
  const errors = [];
  const picked = _accountBody(req.body || {}, errors, { isCreate: false });
  if (!errors.length && Object.keys(picked).length === 0) errors.push({ key: 'validation.account.noFields' });
  if (errors.length) return _fail(req, res, errors);
  req.body = picked;
  next();
}

// POST /api/v1/shop/checkout — the SHAPE of the shipping address's postcode and
// phone (ported from icelandicstore #399, utils/contactFormat.js). Everything
// else about the body (items, currency, required fields, lengths) stays with
// shopController.createCheckoutSession, which runs next.
//
// Only an Icelandic address is held to the three-digit postnúmer: a buyer in
// Denmark or Britain keeps a free-text postcode. The phone is optional; when
// present it gets the same rule as every other phone field. Nothing is read
// when the method needs no address (local pickup ignores it).
function validateCheckoutContact(req, res, next) {
  const b = req.body || {};
  const a = b.shipping_address;
  if (b.shipping_method !== 'flat_rate' || !a || typeof a !== 'object' || Array.isArray(a)) return next();
  const errors = [];
  if (typeof a.postal === 'string' && a.postal.trim() && !isValidZip(a.postal, a.country)) {
    errors.push({ key: 'validation.checkout.postcodeInvalid' });
  }
  if (typeof a.phone === 'string' && a.phone.trim() && !isValidPhone(a.phone.trim())) {
    errors.push({ key: 'validation.phone.invalid' });
  }
  if (errors.length) return _fail(req, res, errors);
  next();
}

module.exports = {
  validateCheckoutContact,
  _isEmail: isEmail,
  validateProject,
  validateQuery,
  validateLeadUpdate,
  validateMarketStatus,
  validateAccountCreate,
  validateAccountPatch,
  validateSignup,
  validatePartyRequest,
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
  validateGuide,
  validateGuideReorder,
  ALLOWED_AVATARS,
  UPLOADED_AVATAR_RE,
  isOwnUploadedAvatar,
};
