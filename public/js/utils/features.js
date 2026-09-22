// SPA feature flags.
//
// Social login (Google + Facebook) ships OFF on this instance: no OAuth app is
// configured for Orange Smiley, so the buttons would point at dead endpoints.
// The controllers, Arctic helpers and tests are all kept — to restore, flip
// this to true AND set SOCIAL_LOGIN_ENABLED=true on the server (the routes
// 404 without it — see the kill-switch in server/routes/authRoutes.js).
export const SOCIAL_LOGIN_ENABLED = false;
