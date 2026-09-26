// pino's redact config (server/observability/logger.js REDACT). The app logger
// is disabled under NODE_ENV=test, so this builds a pino with the SAME config
// writing into a buffer and asserts on the JSON it would have shipped.
//
// The case that motivated it (icelandicstore #382): pino's `*` wildcard
// matches exactly one level, so `*.password` never covered a top-level
// `logger.info({ password }, '…')`.
const pino = require('pino');
const { REDACT } = require('../../server/observability/logger');

function logged(obj) {
  const lines = [];
  const stream = { write: (s) => lines.push(s) };
  pino({ redact: REDACT }, stream).info(obj, 'test');
  return JSON.parse(lines[0]);
}

describe('logger redact paths', () => {
  test.each([
    'password', 'password_hash', 'current_password', 'new_password',
    'currentPassword', 'newPassword', 'token', 'secret', 'totp_secret', 'totp_secret_enc', 'kennitala',
  ])('a top-level %s is redacted', (field) => {
    expect(logged({ [field]: 'hunter2-SECRET' })[field]).toBe('[REDACTED]');
  });

  test.each([
    'password', 'current_password', 'new_password', 'newPassword', 'token', 'totp_secret',
  ])('a nested %s is redacted', (field) => {
    expect(logged({ user: { [field]: 'hunter2-SECRET' } }).user[field]).toBe('[REDACTED]');
  });

  test('request bodies: the password-change pair and the TOTP code', () => {
    const out = logged({ req: { body: { current_password: 'a', new_password: 'b', code: '123456', username: 'halli' } } });
    expect(out.req.body).toEqual({
      current_password: '[REDACTED]', new_password: '[REDACTED]', code: '[REDACTED]', username: 'halli',
    });
  });

  test('a bare `code` (an error code) stays readable', () => {
    expect(logged({ code: 'ECONNREFUSED', err: { code: 'E42' } })).toMatchObject({ code: 'ECONNREFUSED', err: { code: 'E42' } });
  });

  test('no secret survives anywhere in the serialized line', () => {
    const lines = [];
    pino({ redact: REDACT }, { write: s => lines.push(s) })
      .info({ password: 'pw-SECRET-1', auth: { newPassword: 'pw-SECRET-2' } }, 'rotated');
    expect(lines.join('')).not.toMatch(/SECRET/);
  });
});
