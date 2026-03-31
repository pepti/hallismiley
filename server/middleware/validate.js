// A03 Injection + A04 Insecure Design: strict input validation for all routes

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

module.exports = { validateProject, validateQuery };
