// Which marketing channel a visit came from, by its referrer host (harvest 2
// lane 5, 2026-09-26 — the marketing overview on the sales report). Pure.
//
// page_views.referrer_host is already reduced to a bare hostname by the
// analytics beacon (controllers/analyticsController.js _referrerHost): NULL
// for no referrer, 'internal' for a click inside the site. The five channels:
//   direct   — no referrer, or our own site (a reload, a bookmark);
//   email    — a webmail host (checked BEFORE search: mail.google.com is not a search);
//   search   — a search engine;
//   social   — a social network or its link shortener (l.facebook.com, t.co …);
//   referral — any other site that linked to us.
// A newsletter click from a desktop mail program arrives with no referrer at
// all, so it counts as direct — tag such links if the split matters.

const CHANNELS = ['direct', 'search', 'social', 'email', 'referral'];

const EMAIL = [
  'mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com',
  'mail.yahoo.com', 'mail.proton.me', 'mail.aol.com', 'mail.zoho.com', 'mail.simnet.is',
];
const SEARCH = [
  'bing.com', 'duckduckgo.com', 'ecosia.org', 'baidu.com', 'search.brave.com', 'startpage.com',
  'qwant.com', 'ask.com', 'search.yahoo.com', 'kagi.com', 'you.com', 'perplexity.ai',
];
const SOCIAL = [
  'facebook.com', 'fb.com', 'fb.me', 'messenger.com', 'instagram.com', 'threads.net',
  't.co', 'twitter.com', 'x.com', 'linkedin.com', 'lnkd.in', 'reddit.com', 'tiktok.com',
  'youtube.com', 'youtu.be', 'snapchat.com', 'whatsapp.com', 'bsky.app', 'pinterest.com',
  'tumblr.com', 'discord.com', 'telegram.org', 't.me',
];

// host equals the domain, or is a subdomain of it.
const under = (host, domain) => host === domain || host.endsWith(`.${domain}`);

function classifyReferrer(referrerHost) {
  const host = String(referrerHost || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host || host === 'direct' || host === 'internal') return 'direct';
  if (EMAIL.some(d => under(host, d)) || /^(web)?mail\./.test(host)) return 'email';
  // Google and Yandex search on every country domain (google.is, google.co.uk).
  if (/(^|\.)(google|yandex)\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host) || SEARCH.some(d => under(host, d))) return 'search';
  if (SOCIAL.some(d => under(host, d)) || /(^|\.)pinterest\.[a-z.]+$/.test(host)) return 'social';
  return 'referral';
}

/**
 * Fold [{ referrer_host, sessions }] rows into the five channels, every
 * channel present (0 when none), plus the busiest referring sites.
 */
function summariseChannels(rows, { topReferrers = 5 } = {}) {
  const totals = Object.fromEntries(CHANNELS.map(c => [c, 0]));
  const referrers = [];
  for (const r of rows || []) {
    const n = Number(r.sessions) || 0;
    const channel = classifyReferrer(r.referrer_host);
    totals[channel] += n;
    if (channel === 'referral') referrers.push({ host: r.referrer_host, sessions: n });
  }
  const total = CHANNELS.reduce((s, c) => s + totals[c], 0);
  return {
    total,
    channels: CHANNELS.map(c => ({ channel: c, sessions: totals[c] })),
    topReferrers: referrers.sort((a, b) => b.sessions - a.sessions || a.host.localeCompare(b.host)).slice(0, topReferrers),
  };
}

module.exports = { CHANNELS, classifyReferrer, summariseChannels };
