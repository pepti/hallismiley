// Party info (site_content 'party_*' keys) — shared read logic + seed defaults.
// Lives in a service so both partyController (GET /party/info) and
// partyApproval (the owner-triggered welcome email pulls live schedule/venue/
// activities at send time) can use it without a circular require.
const db = require('../config/database');
const { DEFAULT_LOCALE } = require('../config/i18n');

// Keys whose content is the same across locales — stored once at
// DEFAULT_LOCALE and returned on every locale read. An admin adds an
// activity once and it shows on both /en/party and /is/party instead of
// living only in whichever locale was active when they hit Save. Free-form
// entries (instagram handles, URLs, host names) don't benefit from per-locale
// editing the way structural copy (hero, RSVP labels) does.
const LOCALE_NEUTRAL_INFO_KEYS = new Set(['activities']);

// Default party info stored in site_content under key 'party_info'
const DEFAULT_PARTY_INFO = {
  date: 'July 25, 2026',
  rsvp_message: '',
  cover_image: '',
  venue_name: 'Mýrarkot og SPA',
  venue_address: 'Lambhagavegi 23, 113 Reykjavík',
  venue_link: 'https://www.salir.is/index.php/is/skoda/1169',
  venue_maps_link: 'https://www.google.com/maps/search/Mýrarkot+Lambhagavegi+23+Reykjavik',
  venue_rating: '4.3/5 on Google (20 reviews)',
  venue_details: JSON.stringify({
    hall: [
      'Banquet hall seats 40 at 6 long tables, romantic atmosphere with Bluetooth speaker',
      'Small kitchen inside, two large outdoor grills + fridge',
      'Guests bring own food, drinks, and tableware',
      '15 min drive from downtown Reykjavík, near Bauhaus by Úlfarsfell',
      'Hall rental: 100,000 ISK (including cleaning)',
      'Venue closes at 22:00',
    ],
    spa: [
      'Sauna (barrel-shaped, heated stones)',
      '2 hot tubs (7 tons each)',
      'Cold plunge pool',
      'Outdoor shower',
      'Covered veranda with tables/chairs for 20',
      'New changing rooms with 7 showers',
      'Towels, hairdryers, shampoo, shoes included',
      'Max 20 per group, 4-hour sessions — 100,000 ISK',
      'Sheltered veranda surrounded by trees, great for northern lights viewing',
    ],
  }),
  schedule: JSON.stringify([
    { time: '14:00', event: 'Doors Open & Welcome Drinks' },
    { time: '14:30', event: 'SPA Session (Group 1) / Outdoor Games' },
    { time: '15:30', event: 'SPA Session (Group 2) / Lawn Games' },
    { time: '16:30', event: 'BBQ Grill Starts' },
    { time: '17:30', event: 'Dinner at the Long Tables' },
    { time: '18:30', event: 'Speeches & Toasts' },
    { time: '19:00', event: 'Birthday Cake' },
    { time: '19:30', event: 'Party Games' },
    { time: '20:30', event: 'Music & Dancing' },
    { time: '21:30', event: 'Last Round & Farewells' },
    { time: '22:00', event: 'Venue Closes' },
  ]),
  activities: JSON.stringify({
    heading:        'Activities',
    daytimeHeading: 'Daytime Activities',
    eveningHeading: 'Evening Activities',
    daytime: [
      { name: 'TBD', description: 'TBD', rulesLabel: 'Rules:', rules: 'TBD' },
    ],
    evening: [
      { name: 'TBD', description: 'TBD', rulesLabel: 'Rules:', rules: 'TBD' },
    ],
  }),
};

/**
 * Read the merged party info for a locale: seed defaults overlaid with
 * site_content rows, preferring the requested locale per key and falling back
 * to DEFAULT_LOCALE. Locale-neutral keys always come from DEFAULT_LOCALE (a
 * stale per-locale row from before a key was made neutral must not shadow the
 * canonical value). Structured values are returned JSON-stringified, matching
 * how the SPA and email templates consume them.
 */
async function readPartyInfo(locale) {
  const loc = locale || DEFAULT_LOCALE;
  const { rows } = await db.query(
    `SELECT DISTINCT ON (key) key, locale, value FROM site_content
      WHERE key LIKE 'party_%' AND key <> 'party_invite_code'
        AND (locale = $1 OR locale = $2)
      ORDER BY key, (locale = $1) DESC`,
    [loc, DEFAULT_LOCALE]
  );
  const info = { ...DEFAULT_PARTY_INFO };
  const neutralOverrides = new Set();
  for (const row of rows) {
    const k = row.key.replace(/^party_/, '');
    if (LOCALE_NEUTRAL_INFO_KEYS.has(k) && row.locale !== DEFAULT_LOCALE) continue;
    info[k] = typeof row.value === 'object' ? JSON.stringify(row.value) : row.value;
    if (LOCALE_NEUTRAL_INFO_KEYS.has(k)) neutralOverrides.add(k);
  }
  // Backfill any locale-neutral key that the request-locale read skipped
  // because only a non-default-locale row exists for it. (No default row
  // means we keep the DEFAULT_PARTY_INFO seed value.)
  const missingNeutral = [...LOCALE_NEUTRAL_INFO_KEYS].filter(k => !neutralOverrides.has(k));
  if (missingNeutral.length > 0 && loc !== DEFAULT_LOCALE) {
    const { rows: defRows } = await db.query(
      `SELECT key, value FROM site_content
        WHERE locale = $1 AND key = ANY($2::text[])`,
      [DEFAULT_LOCALE, missingNeutral.map(k => `party_${k}`)]
    );
    for (const row of defRows) {
      const k = row.key.replace(/^party_/, '');
      info[k] = typeof row.value === 'object' ? JSON.stringify(row.value) : row.value;
    }
  }
  // Backward compat: migrate legacy flat games array → activities object
  if (info.games && !info.activities) {
    const games = typeof info.games === 'string' ? JSON.parse(info.games) : info.games;
    if (Array.isArray(games)) {
      const half = Math.ceil(games.length / 2);
      info.activities = JSON.stringify({ daytime: games.slice(0, half), evening: games.slice(half) });
    }
  }
  delete info.games;
  return info;
}

module.exports = { DEFAULT_PARTY_INFO, LOCALE_NEUTRAL_INFO_KEYS, readPartyInfo };
