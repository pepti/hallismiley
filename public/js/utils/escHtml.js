/**
 * Escape HTML special characters to prevent XSS when injecting dynamic
 * content into innerHTML. Covers &, <, >, ", and ' (single quotes).
 * @param {*} str - value to escape (coerced to string)
 * @returns {string}
 */
export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
