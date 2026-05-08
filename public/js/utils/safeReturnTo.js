// Client-side mirror of server/auth/oauthHelpers.js#isSafeReturnTo. The
// returnTo value can come from sessionStorage (which any same-origin script
// can write to), so it must be re-validated before being used as a navigation
// target. Mirrors the server rules: must be a relative path starting with `/`,
// must not be protocol-relative, must not contain backslash (browsers normalize
// `\` → `/`, turning `/\evil.com` into `//evil.com`), null bytes, or embedded
// schemes.
export function isSafeReturnTo(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 500) return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  if (value.includes('\\')) return false;
  if (value.includes('\0') || value.toLowerCase().includes('%00')) return false;
  if (value.includes('://')) return false;
  return true;
}
