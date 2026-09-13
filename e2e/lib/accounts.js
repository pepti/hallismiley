// Test accounts and a fast sign-in for specs that are not about signing in.
//
// Why this exists (2026-09-13, CI flake hunt):
//
// 1. Per-admin state is shared across workers. users.admin_nav_config belongs
//    to ONE account, and Playwright runs spec files on 4 workers at once. When
//    two specs that write the sidebar layout both used `testadmin`, one
//    worker's Reset could land between the other's save and its reload —
//    admin-surface.spec.js:70 then reloaded into a layout without the line it
//    had just revealed. A spec that WRITES per-admin state gets its own admin
//    account from seedAdminUser(), so no other worker can touch it.
//
// 2. The login modal is expensive on the CI runner. loginAsAdmin() loads the
//    homepage (hero video, the SPA's eager import of every view module) and
//    drives the modal: about 10 s on GitHub's 2-vCPU runner, measured from the
//    run 34765242769 traces — before the test does anything it is about. The
//    modal itself is covered by auth.spec.js. A long flow that switches users
//    signs in through the same endpoint the modal posts to, then loads the page
//    it actually needs. CSRF is off for the NODE_ENV=test e2e server
//    (server/middleware/csrf.js), and page.request shares the page's cookies,
//    so the session is the one the browser uses.
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./dbUrl');

/** Create (or re-key) an admin account for one spec's exclusive use. */
async function seedAdminUser({ username, email, password }) {
  const { Scrypt } = require('oslo/password');
  const hash = await new Scrypt().hash(password);
  const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
  try {
    await pool.query(
      `INSERT INTO users (email, username, password_hash, role, email_verified)
       VALUES ($1, $2, $3, 'admin', TRUE)
       ON CONFLICT (username) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
      [email, username, hash]
    );
  } finally {
    await pool.end();
  }
}

/** Sign in through POST /auth/login; the page's next load is authenticated. */
async function signInViaApi(page, { username, password }) {
  const res = await page.request.post('/auth/login', { data: { username, password } });
  if (!res.ok()) {
    throw new Error(`sign-in as ${username} failed: HTTP ${res.status()} ${await res.text()}`);
  }
}

module.exports = { seedAdminUser, signInViaApi };
