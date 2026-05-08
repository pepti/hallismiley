// Client-side mirror of server/auth/oauthHelpers.js#isSafeReturnTo. The
// returnTo value can come from sessionStorage (which any same-origin script
// can write to), so it must be re-validated before being used as a navigation
// target. Mirrors the server rules: must be a relative path starting with `/`,
// must not be protocol-relative, must not contain backslash — raw `\` or the
// percent-encoded `%5c` — (browsers normalize `\` → `/`, turning `/\evil.com`
// into `//evil.com`), null bytes (raw or `%00`), or embedded schemes.
export function isSafeReturnTo(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 500) return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  if (value.includes('\\')) return false;
  if (value.includes('\0')) return false;
  const lower = value.toLowerCase();
  if (lower.includes('%00')) return false;
  if (lower.includes('%5c')) return false;
  if (value.includes('://')) return false;
  return true;
}
