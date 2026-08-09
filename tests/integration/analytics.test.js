const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const { cleanTables, getTestSessionCookie, createTestRegularUser } = require('../helpers');

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// The collect + conversion inserts are fire-and-forget (they run after the
// response is sent), so assertions poll until the row lands.
async function waitFor(fn, { timeout = 3000, interval = 25 } = {}) {
  const start = Date.now();
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, interval));
  }
}

const countViews  = async () => (await db.query('SELECT COUNT(*)::int AS n FROM page_views')).rows[0].n;
const countEvents = async (type) => (await db.query('SELECT COUNT(*)::int AS n FROM analytics_events WHERE event_type = $1', [type])).rows[0].n;

async function seedView(over = {}) {
  const r = { path: '/', referrer_host: null, device: 'desktop', browser: 'Chrome', os: 'Windows', locale: 'en', visitor_token: 'tok-a', ...over };
  await db.query(
    `INSERT INTO page_views (path, referrer_host, device, browser, os, locale, visitor_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [r.path, r.referrer_host, r.device, r.browser, r.os, r.locale, r.visitor_token]
  );
}

beforeEach(cleanTables);

// ── POST /api/v1/analytics/collect (public, anonymous) ─────────────────────────

describe('POST /api/v1/analytics/collect', () => {
  test('records a page view and returns 204', async () => {
    const res = await request(app)
      .post('/api/v1/analytics/collect')
      .set('User-Agent', DESKTOP_UA)
      .send({ path: '/projects', ref: 'https://news.ycombinator.com/', locale: 'en', screen: 1440 });

    expect(res.status).toBe(204);

    const row = await waitFor(async () => {
      const { rows } = await db.query('SELECT * FROM page_views WHERE path = $1', ['/projects']);
      return rows[0] || false;
    });
    expect(row.device).toBe('desktop');
    expect(row.browser).toBe('Chrome');
    expect(row.referrer_host).toBe('news.ycombinator.com');
    expect(row.locale).toBe('en');
    expect(row.visitor_token).toHaveLength(22);
  });

  test('stores no raw PII — no IP or user-agent columns exist', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'page_views'`
    );
    const cols = rows.map(r => r.column_name);
    expect(cols).not.toContain('ip_address');
    expect(cols).not.toContain('user_agent');
    expect(cols).toContain('visitor_token');
  });

  test('flags bots and excludes them from the summary', async () => {
    await request(app).post('/api/v1/analytics/collect').set('User-Agent', 'Googlebot/2.1 (+http://www.google.com/bot.html)').send({ path: '/' });
    const bot = await waitFor(async () => {
      const { rows } = await db.query("SELECT device FROM page_views WHERE device = 'bot'");
      return rows[0] || false;
    });
    expect(bot.device).toBe('bot');

    const cookie = await getTestSessionCookie(); // admin
    const res = await request(app).get('/api/v1/admin/analytics/summary').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.total_views).toBe(0); // the only view was a bot
  });

  test('drops a payload with a non-app path (no leading slash)', async () => {
    await request(app).post('/api/v1/analytics/collect').set('User-Agent', DESKTOP_UA).send({ path: 'projects' });
    // Follow with a valid one; once it lands, the bad one must not have.
    await request(app).post('/api/v1/analytics/collect').set('User-Agent', DESKTOP_UA).send({ path: '/ok' });
    await waitFor(async () => (await countViews()) >= 1);
    expect(await countViews()).toBe(1);
  });

  test('empty referrer is stored as NULL (shown as "direct")', async () => {
    await request(app).post('/api/v1/analytics/collect').set('User-Agent', DESKTOP_UA).send({ path: '/contact', ref: '' });
    const row = await waitFor(async () => {
      const { rows } = await db.query('SELECT referrer_host FROM page_views WHERE path = $1', ['/contact']);
      return rows[0] || false;
    });
    expect(row.referrer_host).toBeNull();
  });
});

// ── Conversion events (server-side hooks) ──────────────────────────────────────

describe('conversion events', () => {
  test('a valid contact submission records one contact_submit event', async () => {
    const res = await request(app).post('/api/v1/contact').send({
      name: 'Jane Doe', email: 'jane@example.com',
      message: 'I would love to discuss a project.', topic: 'carpentry',
    });
    expect(res.status).toBe(200);

    await waitFor(async () => (await countEvents('contact_submit')) === 1);
    const { rows } = await db.query("SELECT props FROM analytics_events WHERE event_type = 'contact_submit'");
    expect(rows[0].props).toEqual({ topic: 'carpentry' });
  });

  test('a honeypot submission records no conversion', async () => {
    await request(app).post('/api/v1/contact').send({
      name: 'Bot', email: 'bot@spam.com', message: 'spammy spam spam', website: 'http://spam.bot',
    });
    // A subsequent genuine submission should be the only recorded event.
    await request(app).post('/api/v1/contact').send({
      name: 'Real Person', email: 'real@example.com', message: 'A genuine enquiry about timber work.',
    });
    await waitFor(async () => (await countEvents('contact_submit')) === 1);
    expect(await countEvents('contact_submit')).toBe(1);
  });

  test('AnalyticsEvent.record persists each conversion type with a date', async () => {
    const { AnalyticsEvent } = require('../../server/models/Analytics');
    await AnalyticsEvent.record({ event_type: 'party_rsvp', locale: 'is' });
    await AnalyticsEvent.record({ event_type: 'shop_checkout', props: { currency: 'ISK', total: 12000 } });

    const { rows } = await db.query('SELECT event_type, props, event_date FROM analytics_events ORDER BY event_type');
    expect(rows.map(r => r.event_type)).toEqual(['party_rsvp', 'shop_checkout']);
    expect(rows[1].props).toEqual({ currency: 'ISK', total: 12000 });
    expect(rows[0].event_date).toBeTruthy();
  });
});

// ── Admin aggregation API ──────────────────────────────────────────────────────

describe('GET /api/v1/admin/analytics/* (aggregation)', () => {
  async function seedSample() {
    await seedView({ path: '/',         visitor_token: 'v1', referrer_host: null });
    await seedView({ path: '/',         visitor_token: 'v2', referrer_host: 'google.com' });
    await seedView({ path: '/projects', visitor_token: 'v1', referrer_host: 'google.com', device: 'mobile', browser: 'Safari' });
    await seedView({ path: '/',         visitor_token: 'bot', device: 'bot', browser: 'unknown' }); // excluded
  }

  test('summary returns numeric KPIs excluding bots', async () => {
    await seedSample();
    const cookie = await getTestSessionCookie();
    const res = await request(app).get('/api/v1/admin/analytics/summary').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.total_views).toBe(3);       // 4 seeded, 1 bot excluded
    expect(res.body.unique_visitors).toBe(2);   // v1, v2 (bot excluded)
    expect(res.body.distinct_pages).toBe(2);    // '/', '/projects'
    expect(typeof res.body.total_views).toBe('number');
  });

  test('timeseries returns per-day numeric counts', async () => {
    await seedSample();
    const cookie = await getTestSessionCookie();
    const res = await request(app).get('/api/v1/admin/analytics/timeseries').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const today = res.body[res.body.length - 1];
    expect(typeof today.views).toBe('number');
    expect(today.views).toBe(3);
    expect(today.uniques).toBe(2);
  });

  test('top-pages ranks pages by views (desc)', async () => {
    await seedSample();
    const cookie = await getTestSessionCookie();
    const res = await request(app).get('/api/v1/admin/analytics/top-pages').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body[0].path).toBe('/');
    expect(res.body[0].views).toBe(2);
    expect(res.body[0].uniques).toBe(2);
  });

  test('top-referrers folds NULL referrer into "direct"', async () => {
    await seedSample();
    const cookie = await getTestSessionCookie();
    const res = await request(app).get('/api/v1/admin/analytics/top-referrers').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const referrers = res.body.map(r => r.referrer);
    expect(referrers).toContain('direct');
    expect(referrers).toContain('google.com');
  });

  test('devices breaks down by device + browser', async () => {
    await seedSample();
    const cookie = await getTestSessionCookie();
    const res = await request(app).get('/api/v1/admin/analytics/devices').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const devices = res.body.map(r => r.device);
    expect(devices).toContain('desktop');
    expect(devices).toContain('mobile');
    expect(devices).not.toContain('bot');
  });

  test('conversions returns per-type counts', async () => {
    const { AnalyticsEvent } = require('../../server/models/Analytics');
    await AnalyticsEvent.record({ event_type: 'contact_submit' });
    await AnalyticsEvent.record({ event_type: 'contact_submit' });
    await AnalyticsEvent.record({ event_type: 'party_rsvp' });

    const cookie = await getTestSessionCookie();
    const res = await request(app).get('/api/v1/admin/analytics/conversions').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const map = Object.fromEntries(res.body.map(r => [r.event_type, r.total]));
    expect(map.contact_submit).toBe(2);
    expect(map.party_rsvp).toBe(1);
  });
});

// ── Authorization ──────────────────────────────────────────────────────────────

describe('admin analytics authorization', () => {
  test('summary requires authentication (401 without a session)', async () => {
    const res = await request(app).get('/api/v1/admin/analytics/summary');
    expect(res.status).toBe(401);
  });

  test('summary requires the admin role (403 for a regular user)', async () => {
    const userId = await createTestRegularUser();
    const cookie = await getTestSessionCookie(userId);
    const res = await request(app).get('/api/v1/admin/analytics/summary').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });
});
