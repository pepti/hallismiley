// Lucia v3 session management — httpOnly session cookie, stored in user_sessions table
// Sessions are stored in user_sessions table; cookies are httpOnly + secure in prod
const { Lucia }               = require('lucia');
const { NodePostgresAdapter } = require('@lucia-auth/adapter-postgresql');
const { pool }                = require('../config/database');

const adapter = new NodePostgresAdapter(pool, {
  user:    'users',
  session: 'user_sessions',
});

const lucia = new Lucia(adapter, {
  sessionCookie: {
    name: 'auth_session',
    attributes: {
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      httpOnly: true,
    },
  },
  getUserAttributes(attributes) {
    return {
      username:       attributes.username,
      email:          attributes.email,
      role:           attributes.role,
      avatar:         attributes.avatar,
      display_name:   attributes.display_name,
      phone:          attributes.phone,
      email_verified: attributes.email_verified,
      disabled:       attributes.disabled,
      party_access:   attributes.party_access,
    };
  },
  getSessionAttributes(attributes) {
    return {
      ipAddress: attributes.ip_address,
      userAgent: attributes.user_agent,
    };
  },
});

module.exports = { lucia };
