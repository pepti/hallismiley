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

// ── Fetch with timeout ────────────────────────────────────────────────────────
// Browsers have no default fetch timeout. Without this, a hung backend stalls
// the view forever. Wraps AbortSignal.timeout and distinguishes a timeout
// abort from an explicit caller abort.
//
// Usage: fetchWithTimeout(url, options, 15000)
export const DEFAULT_API_TIMEOUT_MS  = 15_000;
export const DEFAULT_UPLOAD_TIMEOUT_MS = 120_000; // uploads may be slow on mobile

export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_API_TIMEOUT_MS) {
  // If the caller already passed a signal, compose ours with theirs so either
  // source can abort. When AbortSignal.any is missing (older browsers), fall
  // back to just our timeout signal.
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([options.signal, timeoutSignal])
    : (options.signal ?? timeoutSignal);

  try {
    return await fetch(url, { ...options, signal });
  } catch (err) {
    // AbortSignal.timeout fires a TimeoutError — normalise it so callers can
    // show a friendly message without sniffing error names themselves.
    if (err?.name === 'TimeoutError' || timeoutSignal.aborted) {
      const e = new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
      e.name = 'TimeoutError';
      e.cause = err;
      throw e;
    }
    throw err;
  }
}
