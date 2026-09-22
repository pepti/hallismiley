'use strict';

// EMAIL_REPLY_TO (2026-09-22, docs/HISTORY.md#go-live): production sends from
// a sending-only domain, so every message that sets no replyTo of its own gets
// the configured mailbox; a message that sets one (lead notifications reply to
// the enquirer) keeps it. The Resend client is replaced so nothing is sent.

const sent = [];
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn(async (msg) => { sent.push(msg); return { data: { id: 'x' }, error: null }; }) },
  })),
}));

function loadWith(replyTo) {
  let svc;
  jest.isolateModules(() => {
    if (replyTo === undefined) delete process.env.EMAIL_REPLY_TO;
    else process.env.EMAIL_REPLY_TO = replyTo;
    svc = require('../../server/services/emailService');
  });
  return svc;
}

describe('emailService deliver — EMAIL_REPLY_TO', () => {
  const saved = process.env.EMAIL_REPLY_TO;
  beforeEach(() => { sent.length = 0; });
  afterAll(() => {
    if (saved === undefined) delete process.env.EMAIL_REPLY_TO;
    else process.env.EMAIL_REPLY_TO = saved;
  });

  test('adds the configured Reply-To when the message sets none', async () => {
    const { deliver } = loadWith('info@orangesmiley.is');
    await deliver({ from: 'a@mail.orangesmiley.is', to: 'b@example.com', subject: 's', html: 'h' });
    expect(sent[0].replyTo).toBe('info@orangesmiley.is');
  });

  test("keeps a message's own replyTo", async () => {
    const { deliver } = loadWith('info@orangesmiley.is');
    await deliver({ from: 'a@mail.orangesmiley.is', to: 'b@example.com', replyTo: 'enquirer@example.com', subject: 's', html: 'h' });
    expect(sent[0].replyTo).toBe('enquirer@example.com');
  });

  test('sets no Reply-To when the variable is unset', async () => {
    const { deliver } = loadWith(undefined);
    await deliver({ from: 'a@mail.orangesmiley.is', to: 'b@example.com', subject: 's', html: 'h' });
    expect(sent[0]).not.toHaveProperty('replyTo');
  });
});
