const jwt  = require('jsonwebtoken');
const fs   = require('fs');
const path = require('path');
const db   = require('../server/config/database');

const privateKey = fs.readFileSync(path.join(__dirname, '../keys/private.pem'), 'utf8');

/** Generate a valid RS256 access token for the test admin user. */
function generateToken(overrides = {}) {
  return jwt.sign(
    { sub: process.env.ADMIN_USERNAME, role: 'admin', ...overrides },
    privateKey,
    { algorithm: 'RS256', expiresIn: '15m', issuer: 'halliprojects' }
  );
}

/** Generate a token that is already expired. */
function generateExpiredToken() {
  return jwt.sign(
    { sub: process.env.ADMIN_USERNAME, role: 'admin' },
    privateKey,
    { algorithm: 'RS256', expiresIn: -1, issuer: 'halliprojects' }
  );
}

/** Truncate both tables and reset sequences between tests. */
async function cleanTables() {
  await db.query(
    'TRUNCATE TABLE projects, refresh_tokens RESTART IDENTITY CASCADE'
  );
}

/** A minimal valid project body for POST requests. */
function validProject(overrides = {}) {
  return {
    title:       'Test Project',
    description: 'A test project description for integration tests.',
    category:    'tech',
    year:        2024,
    tools_used:  ['Node.js', 'PostgreSQL'],
    featured:    false,
    ...overrides,
  };
}

module.exports = { generateToken, generateExpiredToken, cleanTables, validProject };
