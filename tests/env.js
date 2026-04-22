// Runs in each Jest worker before any modules are loaded.
// Sets all environment variables that the app reads at require-time.

process.env.NODE_ENV        = 'test';
process.env.DATABASE_URL    = process.env.TEST_DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5432/hallismiley_test';
process.env.DB_SSL          = 'false';
process.env.ADMIN_USERNAME  = 'testadmin';
process.env.ADMIN_PASSWORD  = 'testpassword123';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.CSRF_SECRET     = 'test-csrf-secret-not-used-in-test-mode';
