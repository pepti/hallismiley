const { execSync } = require('child_process');

module.exports = async function globalSetup() {
  const opts = { stdio: 'inherit' };

  // Run database migrations
  execSync('node server/scripts/migrate.js', opts);

  // Create (or upsert) the E2E admin account
  execSync(
    'node server/scripts/setup-admin.js testadmin admin@e2e.test AdminPass123',
    opts,
  );

  // Seed the Stofan Bakhús carpentry project with its media gallery
  execSync('node server/scripts/seed-stofan-bakhus.js', opts);
};
