// One signed-in session per role for the role × route harness
// (e2e/roles/*.spec.js), reused through Playwright's storageState: each worker
// seeds the role's account once, signs in once through POST /auth/login (the
// endpoint the modal posts to — CSRF is off on the NODE_ENV=test server) and
// saves the cookies. Every test of that role then starts signed in, with no
// homepage load and no modal. Ported from icelandicstore #62
// (setup-e2e-fixtures.js + loginAs), harvest 2 lane 9, 2026-09-26.
//
// The accounts are the harness's own (`e2erole_*`), never `testadmin`: per-user
// state such as the admin sidebar layout must not be shared with another
// spec's worker (e2e/lib/accounts.js explains the race).
//
// Seeding upserts rows, so it proves its target first with the destructive-
// script guard (server/scripts/targetGuard.js), like e2e/global-setup.js.
const fs = require('fs');
const path = require('path');
const { request } = require('@playwright/test');
const { Pool } = require('pg');
const { e2eDatabaseUrl } = require('./dbUrl');
const { checkTarget } = require('../../server/scripts/targetGuard');

const PASSWORD = 'RoleWalk123!';
// `seller` is the engine-seeded `solumadur` role (migration 098: handbok,
// leads, accounts, commission) — a real custom role with a partial view list,
// which is exactly the case the refusal half needs.
const ROLES = {
  admin:  { username: 'e2erole_admin',  email: 'role-admin@e2e.test',  role: 'admin' },
  user:   { username: 'e2erole_user',   email: 'role-user@e2e.test',   role: 'user' },
  seller: { username: 'e2erole_seller', email: 'role-seller@e2e.test', role: 'solumadur' },
};

function pool() {
  const url = e2eDatabaseUrl();
  const target = checkTarget({ databaseUrl: url, env: process.env });
  if (!target.ok) throw new Error(`[e2e roles] refusing to seed: ${target.reason}`);
  return new Pool({ connectionString: url, ssl: false });
}

/** The role's view list from the database (`["*"]` for admin), or null if the role does not exist here. */
async function roleViews(roleName) {
  const p = pool();
  try {
    const { rows } = await p.query('SELECT view_access FROM roles WHERE name = $1', [roleName]);
    return rows.length ? rows[0].view_access : null;
  } finally {
    await p.end();
  }
}

async function seedRoleUser(key) {
  const spec = ROLES[key];
  const { Scrypt } = require('oslo/password');
  const hash = await new Scrypt().hash(PASSWORD);
  const p = pool();
  try {
    await p.query(
      `INSERT INTO users (email, username, password_hash, role, email_verified)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (username) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
      [spec.email, spec.username, hash, spec.role]
    );
  } finally {
    await p.end();
  }
}

const cache = new Map();

/**
 * Path of a storageState file holding a signed-in session for `key`, built
 * once per worker. The config's default state (cookie banner pre-declined) is
 * kept, so the banner never covers a click.
 */
function storageStateFor(key, { baseURL, workerIndex = 0 }) {
  const id = `${key}:${baseURL}:${workerIndex}`;
  if (!cache.has(id)) {
    cache.set(id, (async () => {
      await seedRoleUser(key);
      const ctx = await request.newContext({ baseURL });
      try {
        const res = await ctx.post('/auth/login', { data: { username: ROLES[key].username, password: PASSWORD } });
        if (!res.ok()) throw new Error(`[e2e roles] sign-in as ${key} failed: HTTP ${res.status()} ${await res.text()}`);
        const state = await ctx.storageState();
        state.origins = [{ origin: baseURL, localStorage: [{ name: 'cookie_consent', value: 'declined' }] }];
        const dir = path.join(__dirname, '../../test-results/.role-auth');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${key}-w${workerIndex}.json`);
        fs.writeFileSync(file, JSON.stringify(state));
        return file;
      } finally {
        await ctx.dispose();
      }
    })());
  }
  return cache.get(id);
}

/** `test.use(signedInAs('admin'))` — every test in the file starts signed in as that role. */
function signedInAs(key) {
  return {
    storageState: async ({ baseURL }, use, testInfo) => {
      await use(await storageStateFor(key, { baseURL, workerIndex: testInfo.workerIndex }));
    },
  };
}

module.exports = { ROLES, PASSWORD, roleViews, seedRoleUser, storageStateFor, signedInAs };
