// MCP write tools (R5b, 2026-09-24) — what the AI operations loop may change
// on an instance (REKSTRARKERFI-PLAN §5 "Manage"), and the feature-request
// path ("Build"). All three are scope `write`: a token needs `write` AND the
// stack's MCP_ALLOWED_SCOPES ceiling must include it (registry.js), so a
// production stack on the default read-only ceiling does not even list them.
//
// Each tool goes through the SAME service the admin screens use — never a
// parallel rule set:
//   • set_update_settings → services/selfUpdateSettings.applyAdminSettings
//     (a `managed` instance refuses; admin modes, channels, a valid window);
//   • set_module          → config/modules.setModuleSwitch (the contract is
//     the ceiling: a contracted module may be switched off and back on, never
//     one the tier does not include);
//   • file_feature_request → models/ChangeRequest (the /admin/feedback inbox,
//     the same rows the in-app change-request widget writes).
// The token's owner has been re-checked as a live admin by mcpAuth; every
// write is audited here with who and what (never a request's free text).
const db = require('../../config/database');
const { env } = require('../envTag');
const securityLogger = require('../../observability/securityLogger');
const { MODULE_IDS } = require('../../config/moduleCatalog');
// Required here, not inside the handlers: the tools must bind to the same
// module instances as the app that registered them.
const selfUpdateSettings = require('../../services/selfUpdateSettings');
const { setModuleSwitch } = require('../../config/modules');
const ChangeRequest = require('../../models/ChangeRequest');
const Setting = require('../../models/Setting');
const { isTestStack } = require('../../config/appEnv');

const TITLE_MAX = 200;
const NOTE_MAX = 4000; // changeRequestController MAX_NOTE_LEN
const PAGE_MAX = 2000;

function fail(message) {
  const err = new Error(message);
  err.expose = true;
  throw err;
}

const tools = [
  {
    name: 'set_update_settings',
    scope: 'write',
    description: 'Change how this instance takes software updates: mode (auto = applies itself inside the maintenance window, manual = an admin presses "Update now"), release channel (stable or canary), and the maintenance window. Refused on an instance whose updates Orange Smiley manages. Give only the fields to change; window fields are merged into the current window.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['auto', 'manual'] },
        channel: { type: 'string', enum: ['stable', 'canary'] },
        window_days: { type: 'string', description: 'Comma-separated day keys, e.g. "tue,wed,thu"' },
        window_from_hour: { type: 'integer', description: '0–23, local to window_tz' },
        window_to_hour: { type: 'integer', description: '0–23, local to window_tz' },
        window_tz: { type: 'string', description: 'IANA time zone, e.g. Atlantic/Reykjavik' },
      },
      required: [],
    },
    async handler(args, { token }) {
      const patch = {};
      if (args.mode !== undefined) patch.mode = args.mode;
      if (args.channel !== undefined) patch.channel = args.channel;
      const touchesWindow = ['window_days', 'window_from_hour', 'window_to_hour', 'window_tz'].some((k) => args[k] !== undefined);
      if (touchesWindow) {
        const now = (await selfUpdateSettings.getSelfUpdateSettings()).maintenanceWindow;
        patch.maintenanceWindow = {
          days: args.window_days !== undefined ? args.window_days.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean) : now.days,
          fromHour: args.window_from_hour !== undefined ? args.window_from_hour : now.fromHour,
          toHour: args.window_to_hour !== undefined ? args.window_to_hour : now.toHour,
          tz: args.window_tz !== undefined ? args.window_tz : now.tz,
        };
      }
      const result = await selfUpdateSettings.applyAdminSettings(patch);
      if (!result.ok) fail(result.status === 404 ? 'Self-update is not present on this instance' : result.error);
      securityLogger.adminAction(token.user_id, 'mcp_set_update_settings', String(token.id), { patch });
      const s = result.settings;
      return { environment: env(), mode: s.mode, channel: s.channel, maintenanceWindow: s.maintenanceWindow };
    },
  },
  {
    name: 'set_module',
    scope: 'write',
    description: `Switch one of this instance's modules off, or back on. Only modules in the instance's contract (its tier) can be switched; a module the contract does not include cannot be turned on here. Takes effect at once on the server that handles the call: its APIs and pages answer 404 until it is switched back on (cached pages may show it for a few more minutes; other instances of a scaled-out deployment follow at their next restart). Modules: ${MODULE_IDS.join(', ')}. Call environment_info first to see the contract and what is on.`,
    inputSchema: {
      type: 'object',
      properties: {
        module: { type: 'string', enum: MODULE_IDS.slice() },
        enabled: { type: 'boolean' },
      },
      required: ['module', 'enabled'],
    },
    async handler(args, { token }) {
      const result = await setModuleSwitch(args.module, args.enabled);
      if (!result.ok) fail(result.error);
      securityLogger.adminAction(token.user_id, 'mcp_set_module', args.module, { enabled: args.enabled, tokenId: token.id });
      return { environment: env(), module: args.module, enabled: args.enabled, modules: result.summary };
    },
  },
  {
    name: 'file_feature_request',
    scope: 'write',
    description: 'File a feature request or change request for this system on behalf of the signed-in admin. It lands in the admin change-request inbox (/admin/feedback), where Orange Smiley picks it up and estimates it. Describe what the business needs and why, not how to build it.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: `One line, at most ${TITLE_MAX} characters` },
        description: { type: 'string', description: `What is needed and why, at most ${NOTE_MAX} characters in all` },
        page: { type: 'string', description: 'Optional: the page or screen it concerns, e.g. /admin/books' },
      },
      required: ['title', 'description'],
    },
    async handler(args, { token }) {
      const title = args.title.trim();
      const description = args.description.trim();
      if (!title || title.length > TITLE_MAX) fail(`title must be 1–${TITLE_MAX} characters`);
      const note = `${title}\n\n${description}`;
      if (!description || note.length > NOTE_MAX) fail(`title + description must be at most ${NOTE_MAX} characters`);
      const page = args.page !== undefined ? args.page.trim() : '';
      if (page.length > PAGE_MAX) fail(`page must be at most ${PAGE_MAX} characters`);

      // The same switch that opens the in-app change-request widget on a
      // production stack (middleware/changeRequestGate.js): no parallel rule.
      if (!isTestStack() && !(await Setting.getChangeRequestsEnabled())) {
        fail('Change requests are switched off on this instance (Admin → Breytingarbeiðnir)');
      }
      const { rows } = await db.query('SELECT email FROM users WHERE id = $1', [String(token.user_id)]);
      const { batch, items } = await ChangeRequest.createBatchWithItems({
        submitterUserId: String(token.user_id),
        submitterEmail: rows[0] ? rows[0].email : null,
        userAgent: `mcp:${token.name}`.slice(0, 300),
        // The inbox shows the label, so the page Claude names rides in it.
        items: [{ pageUrl: page || '/', pageLabel: (page ? `Claude (MCP): ${page}` : 'Claude (MCP)').slice(0, 300), note }],
      });
      securityLogger.adminAction(token.user_id, 'mcp_file_feature_request', String(items[0].id), { tokenId: token.id });
      return {
        environment: env(),
        id: items[0].id,
        batch_id: batch.id,
        status: items[0].status,
        inbox: '/admin/feedback',
      };
    },
  },
];

module.exports = tools;
