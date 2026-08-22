// MCP tool registry — the single list the transport serves. Deliberately
// SDK-shaped ({ name, description, inputSchema, handler }) so a later move to
// @modelcontextprotocol/sdk is a transport-file swap, not a tool rewrite.
//
// Scope model (two gates, both must pass):
//   tool.scope  ⊆  token.scopes  ⊆  MCP_ALLOWED_SCOPES (the environment ceiling)
// The ceiling is read PER CALL so lowering it on a stack demotes existing
// write tokens immediately — no re-mint, no restart.
// v1 toolset for this instance is deliberately system-only (ENHANCEMENTS #13
// scope): leads have no DB rows to query and the shop is hidden. More tool
// modules slot in here exactly like icelandicstore's orders/inventory/etc.
const system    = require('./tools/system');

const TOOLS = [...system];

// The environment's scope ceiling. Unset → read-only: PROD is safe by default
// and turning writes on is a deliberate per-stack act (REGLA_WS_ALLOW_LIVE
// precedent).
function allowedScopes() {
  const raw = process.env.MCP_ALLOWED_SCOPES || 'read';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function permitted(tool, tokenScopes) {
  const ceiling = allowedScopes();
  const scope = tool.scope || 'read';
  return ceiling.includes(scope) && (tokenScopes || []).includes(scope);
}

// Tools the presented token may call in this environment (drives tools/list —
// Claude never sees a tool it would be refused).
function listTools(tokenScopes) {
  return TOOLS.filter((t) => permitted(t, tokenScopes))
    .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

function getTool(name) {
  return TOOLS.find((t) => t.name === name) || null;
}

// Minimal JSON-Schema-subset validation: required keys + primitive types. The
// tools only take flat objects of strings/numbers/booleans; anything richer
// should reconsider hand-rolling. Returns an error string or null.
function validateArgs(tool, args) {
  const schema = tool.inputSchema || {};
  const props = schema.properties || {};
  const required = schema.required || [];
  if (args == null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  for (const key of required) {
    if (!(key in args) || args[key] === null || args[key] === '') return `missing required argument: ${key}`;
  }
  for (const [key, val] of Object.entries(args)) {
    const spec = props[key];
    if (!spec) return `unknown argument: ${key}`;
    if (spec.type === 'string'  && typeof val !== 'string')  return `${key} must be a string`;
    if (spec.type === 'number'  && typeof val !== 'number')  return `${key} must be a number`;
    if (spec.type === 'integer' && !Number.isInteger(val))   return `${key} must be an integer`;
    if (spec.type === 'boolean' && typeof val !== 'boolean') return `${key} must be a boolean`;
    if (spec.enum && !spec.enum.includes(val))               return `${key} must be one of ${spec.enum.join(', ')}`;
  }
  return null;
}

module.exports = { listTools, getTool, validateArgs, permitted, allowedScopes };
