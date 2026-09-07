// The e2e sales-staff user (role `solufolk`, seeded by migration 090; the
// `leads` view appended by 097). Shared by sales-handbook.spec.js and
// leads.spec.js so both work the same account. Seeds straight into the
// ISOLATED e2e database (./dbUrl).
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./dbUrl');

const SALES_USER = {
  username: 'e2esales',
  email:    'sales@e2e.test',
  password: 'SalesPass123',
};

async function seedSalesUser() {
  const { Scrypt } = require('oslo/password');
  const hash = await new Scrypt().hash(SALES_USER.password);
  const pool = new Pool({ connectionString: e2eDatabaseUrl(), ssl: false });
  try {
    await pool.query(
      `INSERT INTO users (email, username, password_hash, role, email_verified)
       VALUES ($1, $2, $3, 'solufolk', TRUE)
       ON CONFLICT (username) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, role = 'solufolk'`,
      [SALES_USER.email, SALES_USER.username, hash]
    );
  } finally {
    await pool.end();
  }
}

async function loginAsSales(page) {
  await page.goto('/');
  if (await page.locator('[data-testid="nav-user-btn"]').isVisible()) return;
  await page.locator('[data-testid="nav-signin"]').click();
  await page.fill('#login-username', SALES_USER.username);
  await page.fill('#login-password', SALES_USER.password);
  await page.click('.login-form [type=submit]');
  await page.waitForSelector('[data-testid="nav-user-btn"]', { timeout: 10_000 });
}

module.exports = { SALES_USER, seedSalesUser, loginAsSales };
