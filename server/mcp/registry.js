// MCP tool registry — the single list the transport serves. Deliberately
// SDK-shaped ({ name, description, inputSchema, handler }) so a later move to
// @modelcontextprotocol/sdk is a transport-file swap, not a tool rewrite.
//
// Scope model (two gates, both must pass):
//   tool.scope  ⊆  token.scopes  ⊆  MCP_ALLOWED_SCOPES (the environment ceiling)
// The ceiling is read PER CALL so lowering it on a stack demotes existing
// write tokens immediately — no re-mint, no restart.
// v1 toolset for this instance is deliberately system-only (ENHANCEMENTS #13
// scope); the shop is hidden. Leads DO have rows since migration 097 (2026-09-07),
// but a read-only leads tool is a separate Halli sign-off. More tool
// modules slot in here exactly like icelandicstore's orders/inventory/etc.
const system    = require('./tools/system');
// R5b (2026-09-24): the write tools — update settings, module switches,
// feature requests. Scope 'write', so the environment ceiling decides whether
// a stack offers them at all (production: MCP_ALLOWED_SCOPES unset = read).
const manage    = require('./tools/manage');
// Catalogue write tools (harvest-ice-c-2026-09-24, from icelandicstore):
// create_product / update_product / set_stock. Scope 'write' AND each behind
// its own mcp.write.* switch in config/client.json, all OFF by default, AND
// the shop module — the third gate below.
const products  = require('./tools/products');
const { clientConfig, envNameFor } = require('../config/clientConfig');
const { isModuleEnabled } = require('../config/modules');

const TOOLS = [...system, ...manage, ...products];

// The environment's scope ceiling. Unset → read-only: PROD is safe by default
// and turning writes on is a deliberate per-stack act (REGLA_WS_ALLOW_LIVE
// precedent).
function allowedScopes() {
  const raw = process.env.MCP_ALLOWED_SCOPES || 'read';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// Third gate, for a tool that names a write switch (writeFlag, a key of
// mcp.write in config/client.json): the switch must be on. The env var is
// re-read per call like the ceiling, so turning one off bites immediately;
// otherwise the resolved config decides. A tool may also name the module it
// belongs to — a switched-off module's tools are absent.
function writeFlagOn(flag) {
  const raw = process.env[envNameFor(['mcp', 'write', flag])];
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return Boolean(clientConfig.mcp && clientConfig.mcp.write && clientConfig.mcp.write[flag]);
}

function permitted(tool, tokenScopes) {
  const ceiling = allowedScopes();
  const scope = tool.scope || 'read';
  if (!ceiling.includes(scope) || !(tokenScopes || []).includes(scope)) return false;
  if (tool.writeFlag && !writeFlagOn(tool.writeFlag)) return false;
  if (tool.module && !isModuleEnabled(tool.module)) return false;
  return true;
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

// Minimal JSON-Schema-subset validation: required keys, primitive types and
// enums, plus — since add_variants (ported from icelandicstore #432, harvest 2
// lane 6c, 2026-09-26), the first tool that takes a list — arrays (minItems /
// maxItems / items) and nested objects (properties, required,
// additionalProperties given as a schema). Unknown keys are refused at every
// level, so a misspelt field fails loudly instead of being dropped. Anything
// richer should reconsider hand-rolling. Returns an error string or null.
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkObject(schema, obj, where) {
  const props = schema.properties || {};
  const extra = isPlainObject(schema.additionalProperties) ? schema.additionalProperties : null;
  const at = (key) => (where ? `${where}.${key}` : key);
  for (const key of schema.required || []) {
    if (!Object.hasOwn(obj, key) || obj[key] === null || obj[key] === '') return `missing required argument: ${at(key)}`;
  }
  for (const [key, val] of Object.entries(obj)) {
    // Own keys only: `props["constructor"]` would otherwise find
    // Object.prototype's and wave the key through untyped.
    const spec = Object.hasOwn(props, key) ? props[key] : extra;
    if (!spec) return `unknown argument: ${at(key)}`;
    const err = checkValue(spec, val, at(key));
    if (err) return err;
  }
  return null;
}

function checkValue(spec, val, name) {
  if (spec.type === 'string'  && typeof val !== 'string')  return `${name} must be a string`;
  if (spec.type === 'number'  && typeof val !== 'number')  return `${name} must be a number`;
  if (spec.type === 'integer' && !Number.isInteger(val))   return `${name} must be an integer`;
  if (spec.type === 'boolean' && typeof val !== 'boolean') return `${name} must be a boolean`;
  if (spec.enum && !spec.enum.includes(val))               return `${name} must be one of ${spec.enum.join(', ')}`;
  if (spec.type === 'array') {
    if (!Array.isArray(val)) return `${name} must be an array`;
    if (spec.minItems != null && val.length < spec.minItems) return `${name} needs at least ${spec.minItems} item(s)`;
    if (spec.maxItems != null && val.length > spec.maxItems) return `${name} may hold at most ${spec.maxItems} items`;
    for (let i = 0; spec.items && i < val.length; i++) {
      const err = checkValue(spec.items, val[i], `${name}[${i}]`);
      if (err) return err;
    }
  }
  if (spec.type === 'object') {
    if (!isPlainObject(val)) return `${name} must be an object`;
    return checkObject(spec, val, name);
  }
  return null;
}

function validateArgs(tool, args) {
  if (args == null) args = {};
  if (!isPlainObject(args)) return 'arguments must be an object';
  return checkObject(tool.inputSchema || {}, args, '');
}

module.exports = { listTools, getTool, validateArgs, permitted, allowedScopes, writeFlagOn };
