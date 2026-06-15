// Gate that only lets a request through when the app is NOT running in
// production. Used by the in-app change-request submit endpoint so it is
// completely absent in production. Returns 404 (not 403) so production reveals
// nothing about the route's existence. APP_ENV (if set) wins over NODE_ENV.
function requireTestEnv(req, res, next) {
  const env = process.env.APP_ENV || process.env.NODE_ENV || 'production';
  if (env === 'production') {
    return res.status(404).json({ error: 'Not found', code: 404 });
  }
  next();
}

module.exports = { requireTestEnv };
