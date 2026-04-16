// Facebook Sign-In — OAuth 2.0 Authorization Code flow (no PKCE; Facebook
// doesn't support it and Arctic's Facebook provider doesn't expose a code
// verifier). State alone is sufficient CSRF defense because the state cookie
// is httpOnly + SameSite=Lax and uses arctic.generateState() (crypto random).
//
// Flow:
//   1. GET /auth/facebook
//        → generate state, set it as a short-lived httpOnly cookie,
//          302 to Facebook's consent dialog.
//   2. GET /auth/facebook/callback?code=…&state=…
//        → verify state matches the cookie, exchange code for tokens, fetch
//          the Graph API /me profile, find-or-create / auto-link the user,
//          create a Lucia session, 302 to /#/?welcome=facebook.
//
// Errors bubble back to /#/login?error=<code> so the SPA can render them.

const { query: dbQuery }           = require('../config/database');
const { lucia }                    = require('../auth/lucia');
const { loadArctic, isConfigured } = require('../auth/facebook');
const { generateUniqueUsername }   = require('../auth/oauthHelpers');

const COOKIE_TTL_MS = 10 * 60 * 1000;
const USERINFO_URL  = 'https://graph.facebook.com/me?fields=id,name,email';

function setOAuthCookie(res, name, value) {
  res.cookie(name, value, {
    path:     '/',
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    // Must be 'lax' — the callback navigation from facebook.com is a
    // cross-site top-level GET, and 'strict' would drop the cookie.
    sameSite: 'lax',
    maxAge:   COOKIE_TTL_MS,
  });
}

function clearOAuthCookies(res) {
  res.clearCookie('facebook_oauth_state');
}

function redirectWithError(res, code) {
  clearOAuthCookies(res);
  return res.redirect(`/#/login?error=${encodeURIComponent(code)}`);
}

// GET /auth/facebook
async function start(req, res, next) {
  try {
    if (!isConfigured()) {
      return redirectWithError(res, 'facebook_not_configured');
    }

    const { client, generateState } = await loadArctic();
    const state = generateState();
    const url   = client.createAuthorizationURL(state, ['email', 'public_profile']);

    setOAuthCookie(res, 'facebook_oauth_state', state);

    return res.redirect(url.toString());
  } catch (err) {
    return next(err);
  }
}

// GET /auth/facebook/callback?code=…&state=…
async function callback(req, res, next) {
  try {
    if (!isConfigured()) {
      return redirectWithError(res, 'facebook_not_configured');
    }

    const { code, state } = req.query;
    const storedState     = req.cookies?.facebook_oauth_state;

    if (!code || !state || !storedState || state !== storedState) {
      return redirectWithError(res, 'invalid_state');
    }

    let profile;
    try {
      const { client } = await loadArctic();
      const tokens     = await client.validateAuthorizationCode(code);
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
      console.error('[facebook-oauth] token exchange failed:', err.message);
      return redirectWithError(res, 'oauth_failed');
    }

    clearOAuthCookies(res);

    // Facebook returns `id` (not `sub`) and does NOT expose an email_verified
    // flag. Email can be absent when the user registered FB without one, or
    // declined the `email` permission during consent. Reject if missing.
    if (!profile?.id || !profile.email) {
      return redirectWithError(res, 'facebook_profile_invalid');
    }

    const email      = String(profile.email).toLowerCase();
    const facebookId = String(profile.id);

    // 1. Existing Facebook-linked user.
    const { rows: byFacebook } = await dbQuery(
      `SELECT id, disabled FROM users WHERE facebook_id = $1`,
      [facebookId],
    );
    if (byFacebook[0]?.disabled) return redirectWithError(res, 'account_disabled');
    let userId = byFacebook[0]?.id ?? null;

    // 2. Else existing by email → auto-link. Note: unlike Google, Facebook
    //    does NOT verify email ownership; we trust it per product decision.
    if (!userId) {
      const { rows: byEmail } = await dbQuery(
        `SELECT id, disabled FROM users WHERE email = $1`,
        [email],
      );
      if (byEmail[0]) {
        if (byEmail[0].disabled) return redirectWithError(res, 'account_disabled');
        await dbQuery(
          `UPDATE users
             SET facebook_id = $1,
                 oauth_provider = COALESCE(oauth_provider, 'facebook'),
                 email_verified = TRUE
           WHERE id = $2`,
          [facebookId, byEmail[0].id],
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
            email_verified, facebook_id, oauth_provider)
         VALUES ($1, $2, 'user', $3, 'avatar-01.svg',
                 TRUE, $4, 'facebook')
         RETURNING id`,
        [email, username, profile.name ?? null, facebookId],
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
    res.setHeader('Set-Cookie', lucia.createSessionCookie(session.id).serialize());

    return res.redirect('/#/?welcome=facebook');
  } catch (err) {
    return next(err);
  }
}

module.exports = { start, callback };
