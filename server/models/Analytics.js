// Repository for first-party analytics — all SQL lives here, parameterised
// throughout (A03: prevents SQL injection). page_views is append-only and
// high-volume; analytics_events holds low-volume conversions.
//
// COUNT(*) is a bigint and pg returns it as a STRING — every aggregate is cast
// ::int so the dashboard charts receive numbers, not strings.
// Page-view aggregates exclude bots (device <> 'bot') by default.
const db = require('../config/database');

class PageView {
  static async record({ path, referrer_host = null, device = 'unknown', browser = 'unknown', os = 'unknown', locale = 'unknown', visitor_token }) {
    await db.query(
      `INSERT INTO page_views (path, referrer_host, device, browser, os, locale, visitor_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [path, referrer_host, device, browser, os, locale, visitor_token]
    );
  }

  // ── Aggregations (from/to are 'YYYY-MM-DD' strings, inclusive) ──────────────

  static async summary(from, to) {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int                       AS total_views,
              COUNT(DISTINCT visitor_token)::int  AS unique_visitors,
              COUNT(DISTINCT path)::int           AS distinct_pages
         FROM page_views
        WHERE device <> 'bot' AND view_date BETWEEN $1 AND $2`,
      [from, to]
    );
    const conv = await db.query(
      `SELECT COUNT(*)::int AS total_conversions
         FROM analytics_events
        WHERE event_date BETWEEN $1 AND $2`,
      [from, to]
    );
    return { ...rows[0], total_conversions: conv.rows[0].total_conversions };
  }

  static async timeseries(from, to) {
    const { rows } = await db.query(
      `SELECT view_date::text                      AS date,
              COUNT(*)::int                        AS views,
              COUNT(DISTINCT visitor_token)::int   AS uniques
         FROM page_views
        WHERE device <> 'bot' AND view_date BETWEEN $1 AND $2
        GROUP BY view_date
        ORDER BY view_date`,
      [from, to]
    );
    return rows;
  }

  static async topPages(from, to, limit = 20) {
    const { rows } = await db.query(
      `SELECT path,
              COUNT(*)::int                        AS views,
              COUNT(DISTINCT visitor_token)::int   AS uniques
         FROM page_views
        WHERE device <> 'bot' AND view_date BETWEEN $1 AND $2
        GROUP BY path
        ORDER BY views DESC
        LIMIT $3`,
      [from, to, limit]
    );
    return rows;
  }

  static async topReferrers(from, to, limit = 20) {
    const { rows } = await db.query(
      `SELECT COALESCE(referrer_host, 'direct')    AS referrer,
              COUNT(*)::int                        AS views
         FROM page_views
        WHERE device <> 'bot' AND view_date BETWEEN $1 AND $2
        GROUP BY referrer
        ORDER BY views DESC
        LIMIT $3`,
      [from, to, limit]
    );
    return rows;
  }

  static async devices(from, to) {
    const { rows } = await db.query(
      `SELECT device, browser, COUNT(*)::int AS views
         FROM page_views
        WHERE device <> 'bot' AND view_date BETWEEN $1 AND $2
        GROUP BY device, browser
        ORDER BY views DESC`,
      [from, to]
    );
    return rows;
  }
}

class AnalyticsEvent {
  static async record({ event_type, path = null, locale = null, props = {} }) {
    await db.query(
      `INSERT INTO analytics_events (event_type, path, locale, props)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [event_type, path, locale, JSON.stringify(props || {})]
    );
  }

  static async byType(from, to) {
    const { rows } = await db.query(
      `SELECT event_type, COUNT(*)::int AS total
         FROM analytics_events
        WHERE event_date BETWEEN $1 AND $2
        GROUP BY event_type
        ORDER BY total DESC`,
      [from, to]
    );
    return rows;
  }
}

module.exports = { PageView, AnalyticsEvent };
