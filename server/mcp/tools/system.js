// System tools — the environment-identity affordance, adapted for
// Rekstrarkerfið from icelandicstore #188. `environment_info` is the tool an
// admin should call first in any conversation: it makes "am I talking to TEST
// or PROD?" a question with a checked answer instead of a guess. Every other
// tool tags its payload with the same value (envTag.js).
//
// Scope note (ENHANCEMENTS #13, approved 2026-08-22): v1 ships system tools
// only. Leads are deliberately NOT queryable — this instance stores no lead
// rows (email-only by design; the leads table is a Job-3 deferral), and
// customer/order detail tools wait for a real need.
const db = require('../../config/database');
const { env } = require('../envTag');

const tools = [
  {
    name: 'environment_info',
    scope: 'read',
    description: 'Which deployment this connector talks to (test or production), with instance totals. Call this first when in doubt about which environment you are connected to.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async handler() {
      const { rows } = await db.query(
        `SELECT (SELECT COUNT(*)::int FROM orders)   AS orders,
                (SELECT COUNT(*)::int FROM products) AS products,
                (SELECT COUNT(*)::int FROM users)    AS users,
                (SELECT COUNT(*)::int FROM projects) AS projects`
      );
      return {
        environment: env(),
        app_url: process.env.APP_URL || null,
        instance: 'Halli Smiley (base engine)',
        counts: rows[0],
        server_time: new Date().toISOString(),
        access: (process.env.MCP_ALLOWED_SCOPES || 'read'),
      };
    },
  },
  {
    name: 'updates_status',
    scope: 'read',
    description: 'The self-update ledger: how this instance takes updates (mode/channel) and the most recent release records with their status.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async handler() {
      const { clientConfig: cfg } = require('../../config/clientConfig');
      const { rows } = await db.query(
        `SELECT version, channel, status, discovered_at
           FROM system_updates
          ORDER BY discovered_at DESC
          LIMIT 5`
      );
      return {
        environment: env(),
        mode: cfg.modules?.selfUpdate?.mode ?? 'managed',
        channel: cfg.modules?.selfUpdate?.channel ?? 'stable',
        recent: rows,
      };
    },
  },
];

module.exports = tools;
