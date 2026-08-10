'use strict';

// Renders a release changelog (Markdown, from a manifest we did not write) into
// HTML safe to inject into the admin page.
//
// Two rules make this safe rather than clever:
//   1. everything is HTML-escaped FIRST, so no source byte can become markup —
//      the renderer then adds only tags it chose itself;
//   2. the result still goes through sanitize-html with a tiny allowlist, so a
//      bug in rule 1 is contained rather than exploitable.
//
// The supported subset is deliberately small — headings, lists, paragraphs,
// emphasis, inline code, links — because that is what a changelog is. Anything
// else survives as plain text, which is a worse-looking changelog and not a
// security event. No images (a changelog that phones home on render is a
// tracking pixel), no raw HTML passthrough, no tables.

const sanitizeHtml = require('sanitize-html');

const ALLOWED_TAGS = ['h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'code', 'pre', 'a', 'br'];

const SANITIZE_OPTIONS = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https'],
  allowedSchemesAppliedToAttributes: ['href'],
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }, true),
  },
};

function escapeHtml(s) {
  return String(s)
    // Null bytes go first: they are the one character that could otherwise
    // forge the code-span placeholder below.
    .replace(/\0/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Inline spans, applied to text that is ALREADY escaped. */
function inline(escaped) {
  // Lift code spans out before anything else runs, so `a * b * c` stays code
  // rather than growing an <em> inside it. The placeholder cannot appear in the
  // input: escapeHtml has already removed every null byte.
  const codes = [];
  let s = escaped.replace(/`([^`]+)`/g, (_m, code) => `\0C${codes.push(code) - 1}\0`);

  s = s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    // [text](url), http(s) only. Anything else — javascript:, data:, a bare
    // word — simply is not a link and stays literal text.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text, url) => `<a href="${url}">${text}</a>`);

  return s.replace(/\0C(\d+)\0/g, (_m, i) => `<code>${codes[Number(i)]}</code>`);
}

/**
 * @param {string} md
 * @returns {string} sanitized HTML — '' for empty input.
 */
function renderChangelog(md) {
  if (typeof md !== 'string' || !md.trim()) return '';

  const lines = escapeHtml(md).split(/\r?\n/);
  const out = [];
  let list = null;          // 'ul' | 'ol' | null
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) { out.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; }
  };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) { flushParagraph(); closeList(); continue; }

    // Headings. Everything collapses to h3/h4: the card already owns h1/h2, and
    // a changelog that outranks its own page heading breaks the document outline.
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph(); closeList();
      const tag = heading[1].length <= 2 ? 'h3' : 'h4';
      out.push(`<${tag}>${inline(heading[2])}</${tag}>`);
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flushParagraph();
      const want = bullet ? 'ul' : 'ol';
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      continue;
    }

    closeList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  closeList();

  return sanitizeHtml(out.join('\n'), SANITIZE_OPTIONS);
}

module.exports = { renderChangelog, ALLOWED_TAGS };
