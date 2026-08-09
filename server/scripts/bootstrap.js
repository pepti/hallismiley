// One-shot data bootstrap: runs migrations, idempotent seeds, and the
// admin-user bootstrap. Safe to re-run — each block checks for existing
// data and skips if present.
//
// Usage:
//   npm run bootstrap                 (local, reads .env)
//   az webapp ssh ... -- npm run bootstrap    (production, one-off)
//
// Moved out of the server's start() path so cold boots (especially
// post-deploy on Azure App Service with a cross-region DB) no longer pay
// 5–7 extra SELECTs before listen(). Migrations still run on boot so
// the app never serves against a stale schema.
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { pool } = require('../config/database');
const { migrate } = require('./migrate');
const logger = require('../logger');

async function bootstrap() {
  await migrate();

  try {
    const { rows: p } = await pool.query('SELECT COUNT(*)::int AS n FROM projects');
    if (p[0].n === 0) {
      const { seedProjects } = require('./seed');
      await seedProjects();
    }
    const { rows: n } = await pool.query('SELECT COUNT(*)::int AS n FROM news_articles');
    if (n[0].n === 0) {
      const { seedNews } = require('./seed-news');
      await seedNews();
    }
  } catch (err) {
    logger.warn({ err: err.message }, '[bootstrap] First-boot seed skipped');
  }

  try {
    const { seedStofanBakhus } = require('./seed-stofan-bakhus');
    await seedStofanBakhus();
    const { seedArnarhraun } = require('./seed-arnarhraun');
    await seedArnarhraun();
  } catch (err) {
    logger.warn({ err: err.message }, '[bootstrap] Project gallery seed skipped');
  }

  try {
    const { ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
    if (ADMIN_USERNAME && ADMIN_EMAIL && ADMIN_PASSWORD) {
      const { rows } = await pool.query(
        "SELECT 1 FROM users WHERE role = 'admin' LIMIT 1"
      );
      if (rows.length === 0) {
        const { Scrypt } = require('oslo/password');
        const hash = await new Scrypt().hash(ADMIN_PASSWORD);
        await pool.query(
          `INSERT INTO users (email, username, password_hash, role)
           VALUES ($1, $2, $3, 'admin')
           ON CONFLICT (username) DO UPDATE
             SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, role = 'admin'`,
          [ADMIN_EMAIL, ADMIN_USERNAME, hash]
        );
        logger.info({ username: ADMIN_USERNAME }, '[bootstrap] Admin user upserted');
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, '[bootstrap] Admin bootstrap skipped');
  }
}

bootstrap()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async err => {
    logger.error({ err }, '[bootstrap] Failed');
    await pool.end().catch(() => {});
    process.exit(1);
  });
