// Shared CSRF utilities used by both auth.js and projectApi.js.

let _csrfToken = null;

export async function getCSRFToken() {
  if (_csrfToken) return _csrfToken;
  try {
    const res  = await fetch('/api/v1/csrf-token', { credentials: 'include' });
    const data = await res.json();
    _csrfToken = data.token;
    return _csrfToken;
  } catch {
    return null;
  }
}

export function clearCSRFToken() {
  _csrfToken = null;
}

export async function getCsrfHeaders() {
  const token = await getCSRFToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-CSRF-Token': token } : {}),
  };
}
