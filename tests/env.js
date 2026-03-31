// Runs in each Jest worker before any modules are loaded.
// Sets all environment variables that the app reads at require-time.
const bcrypt = require('bcrypt');

process.env.NODE_ENV          = 'test';
process.env.DATABASE_URL      = process.env.TEST_DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5432/halliprojects_test';
process.env.DB_SSL            = 'false';
process.env.ADMIN_USERNAME    = 'testadmin';
process.env.ADMIN_PASSWORD    = 'testpassword123';
// rounds=1 is intentionally insecure — fine for test speed, never used in prod
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync('testpassword123', 1);
process.env.ALLOWED_ORIGINS   = 'http://localhost:3000';
