'use strict';

/**
 * Unit tests for the sanitizeBody middleware.
 * No database required — pure in-process logic tests.
 */
const { sanitizeBody } = require('../../server/middleware/sanitize');

// Build minimal mock req/res/next
function mockReq(body) { return { body }; }
function mockNext()    { return jest.fn(); }

describe('sanitizeBody — HTML tag stripping', () => {
  test('strips script tags but keeps inner text content', () => {
    // The sanitizer removes tag syntax (<...>) but leaves text between tags
    const req  = mockReq({ title: '<script>alert(1)</script>Safe Title' });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.title).not.toMatch(/<script>/i);
    expect(req.body.title).toContain('Safe Title');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('strips img tags with event handlers', () => {
    const req  = mockReq({ description: '<img src=x onerror=alert(1)>Clean text' });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.description).not.toMatch(/<img/i);
    expect(req.body.description).toContain('Clean text');
  });

  test('strips bold/formatting tags', () => {
    const req  = mockReq({ name: '<b>Bold</b> Name' });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.name).toBe('Bold Name');
  });

  test('strips nested tags', () => {
    const req  = mockReq({ text: '<div><span>inner</span></div>' });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.text).toBe('inner');
  });
});

describe('sanitizeBody — null byte stripping', () => {
  test('removes null bytes from string fields', () => {
    const req  = mockReq({ title: 'Hello\u0000World' });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.title).toBe('HelloWorld');
    expect(req.body.title).not.toContain('\u0000');
  });

  test('removes multiple null bytes', () => {
    const req  = mockReq({ title: '\u0000\u0000Evil\u0000' });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.title).toBe('Evil');
  });
});

describe('sanitizeBody — whitespace trimming', () => {
  test('trims leading and trailing whitespace', () => {
    const req  = mockReq({ name: '  hello  ' });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.name).toBe('hello');
  });
});

describe('sanitizeBody — non-string value passthrough', () => {
  test('leaves numeric values unchanged', () => {
    const req  = mockReq({ count: 42 });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.count).toBe(42);
  });

  test('leaves boolean values unchanged', () => {
    const req  = mockReq({ featured: true });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.featured).toBe(true);
  });

  test('leaves null values unchanged', () => {
    const req  = mockReq({ caption: null });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.caption).toBeNull();
  });
});

describe('sanitizeBody — array handling', () => {
  test('sanitizes string items inside arrays', () => {
    const req  = mockReq({ tags: ['<b>node</b>', 'express'] });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.tags).toEqual(['node', 'express']);
  });

  test('leaves non-string array items unchanged', () => {
    const req  = mockReq({ ids: [1, 2, 3] });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.ids).toEqual([1, 2, 3]);
  });

  test('handles mixed-type arrays', () => {
    const req  = mockReq({ mixed: ['<b>text</b>', 42, true] });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.mixed[0]).toBe('text');
    expect(req.body.mixed[1]).toBe(42);
    expect(req.body.mixed[2]).toBe(true);
  });
});

describe('sanitizeBody — rich-text fields (body, content)', () => {
  test('preserves allowed formatting tags in body', () => {
    const req  = mockReq({ body: '<p>Hello <strong>world</strong></p>' });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.body).toContain('<p>');
    expect(req.body.body).toContain('<strong>world</strong>');
  });

  test('strips <script> tag and its contents from body', () => {
    const req  = mockReq({ body: '<p>safe</p><script>alert(1)</script>' });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.body).toContain('<p>safe</p>');
    expect(req.body.body).not.toMatch(/<script/i);
    expect(req.body.body).not.toContain('alert(1)');
  });

  test('strips onerror attribute from img (and the img tag itself, since not allowed)', () => {
    const req  = mockReq({ body: '<p>x</p><img src=x onerror=alert(1)>' });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.body).not.toMatch(/onerror/i);
    expect(req.body.body).not.toMatch(/<img/i);
  });

  test('rejects javascript: hrefs on anchors', () => {
    const req  = mockReq({ body: '<a href="javascript:alert(1)">click</a>' });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.body).not.toMatch(/javascript:/i);
  });

  test('forces rel="noopener noreferrer" on anchors', () => {
    const req  = mockReq({ body: '<a href="https://example.com">link</a>' });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.body).toMatch(/rel="[^"]*noopener[^"]*noreferrer/);
  });

  test('strips null bytes from body', () => {
    const req  = mockReq({ body: '<p>safe\u0000body</p>' });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.body).not.toContain('\u0000');
    expect(req.body.body).toContain('safebody');
  });

  test('content field gets the same allowlist treatment as body', () => {
    const req  = mockReq({ content: '<p>ok</p><script>x</script>' });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.content).toContain('<p>ok</p>');
    expect(req.body.content).not.toMatch(/<script/i);
  });
});

describe('sanitizeBody — nested object recursion', () => {
  test('strips tags in nested object string values', () => {
    const req  = mockReq({ rsvp: { answers: { food: '<b>vegan</b>' } } });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.rsvp.answers.food).toBe('vegan');
  });

  test('strips tags in objects inside arrays', () => {
    const req  = mockReq({ items: [{ name: '<b>x</b>' }, { name: 'y' }] });
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(req.body.items[0].name).toBe('x');
    expect(req.body.items[1].name).toBe('y');
  });
});

describe('sanitizeBody — edge cases', () => {
  test('calls next() when body is null', () => {
    const req  = { body: null };
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('calls next() when body is undefined', () => {
    const req  = {};
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('calls next() for an empty body', () => {
    const req  = mockReq({});
    const next = mockNext();
    sanitizeBody(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
