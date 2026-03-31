// Loads RSA keys for RS256 JWT signing (same algorithm Azure AD uses)
// Prefers env vars (PRIVATE_KEY, PUBLIC_KEY) so keys are never baked into the image.
// Falls back to key files for local development.
const fs   = require('fs');
const path = require('path');

const KEYS_DIR = path.join(__dirname, '../../keys');

function loadKey(envVar, filename) {
  if (process.env[envVar]) {
    // Env vars store newlines as \n literals — expand them
    return process.env[envVar].replace(/\\n/g, '\n');
  }
  return fs.readFileSync(path.join(KEYS_DIR, filename), 'utf8');
}

const privateKey = loadKey('PRIVATE_KEY', 'private.pem');
const publicKey  = loadKey('PUBLIC_KEY',  'public.pem');

module.exports = { privateKey, publicKey };
