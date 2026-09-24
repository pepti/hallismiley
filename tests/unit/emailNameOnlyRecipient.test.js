'use strict';

// A name-only login's reserved <username>@noemail.invalid (harvested from
// icelandicstore #397, 2026-09-24) is not a recipient: deliver() drops it from
// every list BEFORE the EMAIL_ALLOWLIST rewrite, a message left with nobody is
// not sent at all, and the senders report that as "not sent" (false), never as
// a delivery. The Resend client is replaced so nothing is sent.

const sent = [];
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn(async (msg) => { sent.push(msg); return { data: { id: 'msg-1' }, error: null }; }) },
  })),
}));

function load({ allowlist } = {}) {
  let svc;
  jest.isolateModules(() => {
    process.env.RESEND_API_KEY = 're_test';
    if (allowlist) process.env.EMAIL_ALLOWLIST = allowlist; else delete process.env.EMAIL_ALLOWLIST;
    svc = require('../../server/services/emailService');
  });
  return svc;
}

describe('emailService — placeholder recipients', () => {
  const saved = { key: process.env.RESEND_API_KEY, allow: process.env.EMAIL_ALLOWLIST };
  beforeEach(() => { sent.length = 0; });
  afterAll(() => {
    if (saved.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved.key;
    if (saved.allow === undefined) delete process.env.EMAIL_ALLOWLIST; else process.env.EMAIL_ALLOWLIST = saved.allow;
  });

  test('a message to a placeholder alone is not sent, and reads as not sent', async () => {
    const svc = load();
    expect(await svc.sendPasswordResetEmail('anna@noemail.invalid', 'tok', 'is')).toBe(false);
    expect(await svc.sendWelcomeInviteEmail('anna@noemail.invalid', 'tok', 'is')).toBe(false);
    expect(await svc.sendVerificationEmail('anna@noemail.invalid', 'tok', 'is')).toBe(false);
    expect(sent).toHaveLength(0);
  });

  test('the allowlist does not turn a placeholder into a send (staging behaves like production)', async () => {
    const svc = load({ allowlist: 'tester@example.is' });
    expect(await svc.sendPasswordResetEmail('anna@noemail.invalid', 'tok', 'is')).toBe(false);
    expect(sent).toHaveLength(0);
    expect(svc.isRedirecting()).toBe(true);
  });

  test('a real address still goes out, and the sender returns its id', async () => {
    const svc = load();
    expect(await svc.sendPasswordResetEmail('anna@example.is', 'tok', 'is')).toBe('msg-1');
    expect(sent[0].to).toEqual(['anna@example.is']);
  });

  test('a mixed list keeps only the real addresses', async () => {
    const svc = load();
    await svc.deliver({ from: 'a@x.is', to: ['anna@noemail.invalid', 'bob@example.is'], subject: 's', html: 'h' });
    expect(sent[0].to).toEqual(['bob@example.is']);
  });
});
