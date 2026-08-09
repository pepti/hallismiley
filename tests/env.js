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
// Auto-translation is always disabled in tests so no suite accidentally
// calls the real Anthropic API. Integration tests that need to exercise
// the feature mock `server/services/translator` directly.
process.env.TRANSLATE_ENABLED = 'false';
process.env.ANTHROPIC_API_KEY = '';
