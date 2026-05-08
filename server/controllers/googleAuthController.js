// Google Sign-In — OAuth 2.0 Authorization Code flow with PKCE.
//
// Flow:
//   1. GET /auth/google?returnTo=/some/path
//        → generate state + code_verifier, set both as short-lived httpOnly
//          cookies. If returnTo is a safe relative path, also persist it as
//          an httpOnly cookie. 302 to Google's consent screen.
//   2. GET /auth/google/callback?code=…&state=…
//        → verify state matches the cookie, exchange code + verifier for tokens,
//          fetch the userinfo profile, find-or-create / auto-link the user,
//          create a Lucia session, 302 to the (revalidated) returnTo cookie or
//          /<locale>/ as fallback.
//
// Errors bubble back to /<locale>/#/?error=<code> so the SPA can render them.

const { query: dbQuery }          = require('../config/database');
const { lucia }                   = require('../auth/lucia');
const { loadArctic, isConfigured } = require('../auth/google');
const { generateUniqueUsername, isSafeReturnTo } = require('../auth/oauthHelpers');

const COOKIE_TTL_MS = 10 * 60 * 1000;
const USERINFO_URL  = 'https://openidconnect.googleapis.com/v1/userinfo';

function setOAuthCookie(res, name, value) {
  res.cookie(name, value, {
    path:     '/',
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    // Must be 'lax' — the callback navigation from accounts.google.com is a
    // cross-site top-level GET, and 'strict' would drop the cookie.
    sameSite: 'lax',
    maxAge:   COOKIE_TTL_MS,
  });
}

function clearOAuthCookies(res) {
  res.clearCookie('google_oauth_state');
  res.clearCookie('google_oauth_code_verifier');
  res.clearCookie('google_oauth_return_to');
}

function redirectWithError(res, code, locale = 'en') {
  clearOAuthCookies(res);
  // Include the locale prefix so the browser lands directly on the locale-prefixed
  // SPA path without a second server redirect from GET / → GET /en/. Without the
  // prefix the i18n catch-all would swallow the hash fragment in some browsers.
  return res.redirect(`/${locale}/#/?error=${encodeURIComponent(code)}`);
}

// GET /auth/google
async function start(req, res, next) {
  try {
    if (!isConfigured()) {
      return redirectWithError(res, 'google_not_configured', req.locale);
    }

    const { client, generateState, generateCodeVerifier } = await loadArctic();
    const state        = generateState();
    const codeVerifier = generateCodeVerifier();
    const url          = client.createAuthorizationURL(state, codeVerifier, [
      'openid', 'email', 'profile',
    ]);

    setOAuthCookie(res, 'google_oauth_state',         state);
    setOAuthCookie(res, 'google_oauth_code_verifier', codeVerifier);

    // Optional ?returnTo= — only persist if the SPA sent a safe relative path.
    // Stored as an httpOnly cookie so the value can't be tampered with by the
    // OAuth provider's redirect chain.
    if (isSafeReturnTo(req.query.returnTo)) {
      setOAuthCookie(res, 'google_oauth_return_to', req.query.returnTo);
    }

    return res.redirect(url.toString());
  } catch (err) {
    return next(err);
  }
}

// GET /auth/google/callback?code=…&state=…
async function callback(req, res, next) {
  try {
    if (!isConfigured()) {
      return redirectWithError(res, 'google_not_configured', req.locale);
    }

    const { code, state }    = req.query;
    const storedState        = req.cookies?.google_oauth_state;
    const codeVerifier       = req.cookies?.google_oauth_code_verifier;
    // Read the returnTo cookie up-front and revalidate — never trust a value
    // we read from a cookie without re-checking it satisfies the safe-path rule.
    const rawReturnTo        = req.cookies?.google_oauth_return_to;
    const returnTo           = isSafeReturnTo(rawReturnTo) ? rawReturnTo : null;

    if (!code || !state || !storedState || !codeVerifier || state !== storedState) {
      return redirectWithError(res, 'invalid_state', req.locale);
    }

    let profile;
    try {
      const { client } = await loadArctic();
      const tokens     = await client.validateAuthorizationCode(code, codeVerifier);
      // Arctic v3 exposes the access token via an accessor.
      const accessToken = typeof tokens.accessToken === 'function'
        ? tokens.accessToken()
        : tokens.accessToken;

      const userinfoRes = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!userinfoRes.ok) throw new Error(`userinfo ${userinfoRes.status}`);
      profile = await userinfoRes.json();
    } catch (err) {
      console.error('[google-oauth] token exchange failed:', err.message);
      return redirectWithError(res, 'oauth_failed', req.locale);
    }

    clearOAuthCookies(res);

    if (!profile?.sub || !profile.email || profile.email_verified !== true) {
      return redirectWithError(res, 'google_profile_invalid', req.locale);
    }

    const email = String(profile.email).toLowerCase();

    // 1. Existing Google-linked user.
    const { rows: byGoogle } = await dbQuery(
      `SELECT id, disabled FROM users WHERE google_id = $1`,
      [profile.sub],
    );
    if (byGoogle[0]?.disabled) return redirectWithError(res, 'account_disabled', req.locale);
    let userId = byGoogle[0]?.id ?? null;

    // 2. Else existing by email → auto-link (Google has verified the email).
    if (!userId) {
      const { rows: byEmail } = await dbQuery(
        `SELECT id, disabled FROM users WHERE email = $1`,
        [email],
      );
      if (byEmail[0]) {
        if (byEmail[0].disabled) return redirectWithError(res, 'account_disabled', req.locale);
        await dbQuery(
          `UPDATE users
             SET google_id = $1,
                 oauth_provider = COALESCE(oauth_provider, 'google'),
                 email_verified = TRUE
           WHERE id = $2`,
          [profile.sub, byEmail[0].id],
        );
        userId = byEmail[0].id;
      }
    }

    // 3. Else new user — auto-generate a unique username.
    if (!userId) {
      const username = await generateUniqueUsername(email, profile.name);
      const { rows: ins } = await dbQuery(
        `INSERT INTO users
           (email, username, role, display_name, avatar,
            email_verified, google_id, oauth_provider)
         VALUES ($1, $2, 'user', $3, 'avatar-01.svg',
                 TRUE, $4, 'google')
         RETURNING id`,
        [email, username, profile.name ?? null, profile.sub],
      );
      userId = ins[0].id;
    }

    // Reset any lockout state from previous password-login failures, then
    // create a Lucia session with the same pattern as password login.
    await dbQuery(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW()
         WHERE id = $1`,
      [userId],
    );

    const session = await lucia.createSession(userId, {
      ip_address: req.ip ?? null,
      user_agent: req.headers['user-agent'] ?? null,
    });
    // append() — not setHeader() — so we don't clobber the clearCookie() calls
    // above (state, code_verifier, return_to) that were appended earlier.
    res.append('Set-Cookie', lucia.createSessionCookie(session.id).serialize());

    return res.redirect(returnTo || `/${req.locale}/`);
  } catch (err) {
    return next(err);
  }
}

module.exports = { start, callback };
