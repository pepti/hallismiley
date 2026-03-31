// Generates a bcrypt hash for your admin password
// Run: node server/scripts/setup-admin.js <your-password>
// Then paste the output into ADMIN_PASSWORD_HASH in .env
const bcrypt = require('bcrypt');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node server/scripts/setup-admin.js <password>');
  process.exit(1);
}

bcrypt.hash(password, 12).then(hash => {
  console.log('\nAdd this to your .env file:\n');
  console.log(`ADMIN_PASSWORD_HASH=${hash}`);
  console.log('');
});
