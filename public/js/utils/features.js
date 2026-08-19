// SPA feature flags.
//
// Social login (Google + Facebook) is LIVE on this site, so the flag defaults
// true — the port from icelandicstore (where the owner turned it off) must not
// change live behavior. Turning it off is a two-step kill switch: flip this to
// false AND set SOCIAL_LOGIN_ENABLED=false on the server (the /auth/google and
// /auth/facebook routes 404 when the server side is off — see the gate in
// server/routes/authRoutes.js).
export const SOCIAL_LOGIN_ENABLED = true;
