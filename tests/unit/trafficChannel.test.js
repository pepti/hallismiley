'use strict';

// server/utils/trafficChannel.js — which marketing channel a session came
// from, by its referrer host (harvest 2 lane 5, the marketing overview).
const { classifyReferrer, summariseChannels, CHANNELS } = require('../../server/utils/trafficChannel');

describe('classifyReferrer', () => {
  test.each([
    [null, 'direct'], ['', 'direct'], ['internal', 'direct'], ['direct', 'direct'],
    ['www.google.is', 'search'], ['google.com', 'search'], ['www.google.co.uk', 'search'],
    ['duckduckgo.com', 'search'], ['www.bing.com', 'search'], ['search.brave.com', 'search'],
    ['yandex.ru', 'search'],
    ['mail.google.com', 'email'], ['outlook.live.com', 'email'], ['webmail.simnet.is', 'email'],
    ['mail.example.is', 'email'],
    ['l.facebook.com', 'social'], ['m.facebook.com', 'social'], ['www.instagram.com', 'social'],
    ['t.co', 'social'], ['www.linkedin.com', 'social'], ['lnkd.in', 'social'], ['youtu.be', 'social'],
    ['www.pinterest.co.uk', 'social'],
    ['blogg.example.is', 'referral'], ['mbl.is', 'referral'], ['notgoogle.io', 'referral'],
    ['googleblog.example.com', 'referral'], ['fakefacebook.com', 'referral'],
  ])('%s → %s', (host, channel) => {
    expect(classifyReferrer(host)).toBe(channel);
  });

  test('case and a trailing dot do not matter', () => {
    expect(classifyReferrer('WWW.GOOGLE.IS.')).toBe('search');
  });
});

test('summariseChannels folds hosts into every channel and ranks the referring sites', () => {
  const out = summariseChannels([
    { referrer_host: null, sessions: 4 },
    { referrer_host: 'internal', sessions: 1 },
    { referrer_host: 'www.google.is', sessions: 3 },
    { referrer_host: 'mbl.is', sessions: 2 },
    { referrer_host: 'visir.is', sessions: 5 },
  ]);
  expect(out.total).toBe(15);
  expect(out.channels.map(c => c.channel)).toEqual(CHANNELS);
  expect(Object.fromEntries(out.channels.map(c => [c.channel, c.sessions])))
    .toEqual({ direct: 5, search: 3, social: 0, email: 0, referral: 7 });
  expect(out.topReferrers).toEqual([{ host: 'visir.is', sessions: 5 }, { host: 'mbl.is', sessions: 2 }]);
  expect(summariseChannels([]).total).toBe(0);
});
