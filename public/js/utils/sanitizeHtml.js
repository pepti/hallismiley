// Shared DOMParser-based allowlist sanitizer for rich-text bodies rendered by
// the SPA (news articles, sales-handbook guides). Extracted from ArticleView
// (2026-08-27) so every rich-body renderer uses the same allowlist. The tag
// set mirrors RICH_TEXT_ALLOWED_TAGS in server/middleware/sanitize.js — the
// server layer is the durable guard against stored XSS from non-browser
// clients, this layer covers display.

const ALLOWED_TAGS = new Set([
  'P', 'H2', 'H3', 'H4', 'STRONG', 'EM', 'B', 'I', 'A',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'BR', 'HR',
  'SPAN', 'DIV', 'FIGURE', 'FIGCAPTION',
]);

const ALLOWED_ATTRS = {
  A: new Set(['href', 'target', 'rel']),
};

/**
 * Parse body HTML through DOMParser, strip disallowed tags/attrs, return a
 * safe HTML string. Disallowed elements are unwrapped (children survive);
 * `javascript:` hrefs are dropped; external links get target=_blank + noopener.
 */
export function sanitizeBodyHtml(rawHtml) {
  const doc  = new DOMParser().parseFromString(rawHtml, 'text/html');
  const body = doc.body;

  function clean(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.cloneNode();

    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const tag = node.tagName.toUpperCase();
    if (!ALLOWED_TAGS.has(tag)) {
      // Replace disallowed element with its children (unwrap)
      const frag = document.createDocumentFragment();
      for (const child of node.childNodes) {
        const cleaned = clean(child);
        if (cleaned) frag.appendChild(cleaned);
      }
      return frag;
    }

    const el = document.createElement(tag === 'DIV' ? 'DIV' : tag);

    // Copy only allowed attributes
    const allowedAttrs = ALLOWED_ATTRS[tag];
    if (allowedAttrs) {
      for (const attr of allowedAttrs) {
        if (node.hasAttribute(attr)) {
          const val = node.getAttribute(attr);
          // Reject javascript: hrefs
          if (attr === 'href' && /^\s*javascript:/i.test(val)) continue;
          el.setAttribute(attr, val);
        }
      }
    }

    // Force external links open in new tab with noopener
    if (tag === 'A' && el.href && !el.href.startsWith(window.location.origin)) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel',    'noopener noreferrer');
    }

    for (const child of node.childNodes) {
      const cleaned = clean(child);
      if (cleaned) el.appendChild(cleaned);
    }
    return el;
  }

  const frag = document.createDocumentFragment();
  for (const child of body.childNodes) {
    const cleaned = clean(child);
    if (cleaned) frag.appendChild(cleaned);
  }

  const wrapper = document.createElement('div');
  wrapper.appendChild(frag);
  return wrapper.innerHTML;
}
