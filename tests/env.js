// Runs in each Jest worker before any modules are loaded.
// Sets all environment variables that the app reads at require-time.

const { workerDbUrl } = require('./workerDb');

process.env.NODE_ENV        = 'test';
// Each Jest worker gets its own database (see tests/workerDb.js) so suites
// running in parallel workers can't clobber each other's fixtures. Under
// --runInBand JEST_WORKER_ID is '1', so the serial path uses <base>_w1_test.
// The base is the per-branch one globalSetup pinned into TEST_DATABASE_URL
// (or the explicit override); in the unit tier, which has no globalSetup, it
// is derived here and never connected to.
process.env.DATABASE_URL    = workerDbUrl(process.env.JEST_WORKER_ID || '1').url;
process.env.DB_SSL          = 'false';
// Close idle DB connections fast: each suite file gets its own pool (Jest
// module registry per file) and 4 workers run suites concurrently, so at the
// production 30s idle timeout the lingering pools of finished suites sum past
// Postgres's max_connections. See server/config/database.js.
process.env.DB_POOL_IDLE_MS = '1000';
process.env.ADMIN_USERNAME  = 'testadmin';
process.env.ADMIN_PASSWORD  = 'testpassword123';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
// Pin the canonical host for SSR-meta/sitemap assertions. Without this the
// suite inherits whatever APP_URL the developer's .env happens to hold
// (localhost in dev), and every absolute-URL expectation breaks.
process.env.APP_URL         = 'https://www.hallismiley.is';
process.env.CSRF_SECRET     = 'test-csrf-secret-not-used-in-test-mode';
// Auto-translation is always disabled in tests so no suite accidentally
// calls the real Anthropic API. Integration tests that need to exercise
// the feature mock `server/services/translator` directly.
process.env.TRANSLATE_ENABLED = 'false';
process.env.ANTHROPIC_API_KEY = '';
// Nor workload identity (services/anthropicAuth.js): a stray .env with the
// federation settings must not switch it on. The auth suites set their own.
process.env.ANTHROPIC_FEDERATION_RULE_ID = '';
process.env.ANTHROPIC_ORGANIZATION_ID = '';
process.env.ANTHROPIC_WIF_AUDIENCE = '';
// Two-factor enrolment is OPTIONAL by default (security.mfa.enrolment,
// mfa-optional-2026-09-23), so no suite needs this any more. It stays as a
// belt-and-braces for a suite that switches an instance to `required`
// (CLIENT_CONFIG_SECURITY_MFA_ENROLMENT, read per request by auth/mfaPolicy.js)
// while minting admin sessions by the hundred — a switch production ignores.
// adminTotpEnforcement, the suite that IS about the mandatory rule, clears it.
process.env.ADMIN_TOTP_EXEMPT = '*';
// A fixed key so the encrypted-at-rest path (utils/secretBox.js) is what the
// suites exercise by default. 32 bytes, base64. Test-only.
process.env.TOTP_ENC_KEY = 'dGVzdC1vbmx5LXRvdHAta2V5LTMyLWJ5dGVzLWxvbmc=';
