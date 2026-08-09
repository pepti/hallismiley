const { _partyNotifyRecipients } = require('../../server/controllers/partyController');

// The owner request-notification must always reach Halli (a fixed/configured
// address) AND any verified admin accounts — deduped, lower-cased.
describe('_partyNotifyRecipients', () => {
  const ORIG = process.env.PARTY_NOTIFY_EMAIL;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.PARTY_NOTIFY_EMAIL;
    else process.env.PARTY_NOTIFY_EMAIL = ORIG;
  });

  test('always includes the default owner address, even with no admins', () => {
    delete process.env.PARTY_NOTIFY_EMAIL;
    expect(_partyNotifyRecipients([])).toEqual(['halli@hallismiley.is']);
  });

  test('adds verified admins alongside the owner; deduped, lower-cased, null-safe', () => {
    delete process.env.PARTY_NOTIFY_EMAIL;
    expect(_partyNotifyRecipients(['Admin@Test.com', 'HALLI@hallismiley.is', null, '']))
      .toEqual(['halli@hallismiley.is', 'admin@test.com']);
  });

  test('honours the PARTY_NOTIFY_EMAIL override', () => {
    process.env.PARTY_NOTIFY_EMAIL = 'Owner@Foo.is';
    expect(_partyNotifyRecipients(['a@b.com'])).toEqual(['owner@foo.is', 'a@b.com']);
  });
});
