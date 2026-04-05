// Shared CSRF utilities — delegates to services/auth.js to keep one shared token cache.
import { getCSRFToken } from '../services/auth.js';

export { getCSRFToken };

export async function getCsrfHeaders() {
  const token = await getCSRFToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-CSRF-Token': token } : {}),
  };
}
