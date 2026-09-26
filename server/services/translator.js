'use strict';

/**
 * Anthropic-backed EN → IS translator for admin-saved content.
 *
 * Design rules (see plan `auto-translate-en-is-on-admin-save`):
 *   - Feature-flagged via TRANSLATE_ENABLED. When the flag is off OR no
 *     Anthropic credentials are configured (services/anthropicAuth.js: the
 *     App Service managed identity via workload identity federation, else
 *     ANTHROPIC_API_KEY), every exported function becomes a no-op
 *     returning null/unchanged input so we can deploy dark.
 *   - Never throws into the controller. Errors + timeouts log via pino
 *     and return null so the EN save still succeeds with IS left null.
 *   - System prompt enforces preservation of markdown, HTML, {n}/{name}
 *     placeholders, URLs, emails, slash-handles (e.g. pepti/hallismiley),
 *     code fences, and proper-noun brand tokens. temperature=0 for
 *     determinism.
 *
 * Exports:
 *   translate({text, targetLocale='is', format='plain'|'markdown'})
 *     → Promise<string|null>
 *   translateTree(obj, {format='plain'})
 *     → Promise<object|null>   // deep-translates string leaves of a jsonb
 *   isEnabled() → boolean      // convenience for callers deciding whether
 *                              //   to skip a DB read they would only need
 *                              //   if translation is going to happen.
 */

const { fetchNamed } = require('../observability/trackedFetch');
const logger = require('../logger');
const anthropicAuth = require('./anthropicAuth');
// Process-wide cap on concurrent paid AI calls (harvest2, ported from
// icelandicstore #218). The translator fans a big tree out into parallel
// batches, so every model call takes a slot — queued, never refused outright.
const aiGate = require('./aiGate');

// Keys that must NEVER be translated when walking a site_content jsonb.
// Extend as new structural keys are introduced.
//
// `fieldId` is the show-if reference inside party_rsvp_form entries
// (`{ showIf: { fieldId: 'helping', value: '…' } }`). Translating it would
// break the dependent-field matching in PartyView's _showIfAttrs.
const BLOCK_KEYS = new Set([
  'href', 'url', 'src', 'image_url', 'cover_image',
  'type', 'kind', 'icon', 'status',
  'github_url', 'twitter_url', 'linkedin_url',
  'brand_name', 'email', 'phone',
  'id', 'slug', 'key', 'locale', 'fieldId',
  'filename', 'code_snippet_filename',
]);

const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_TREE_DEPTH = 20;

// Human-readable language names used to build the system prompt. The
// translator is direction-agnostic: callers pass sourceLocale/targetLocale
// and the prompt is assembled from these. Defaults keep the historical
// EN → IS behaviour for every existing caller (site content, projects,
// news, shop) — only the party flow opts into IS → EN.
const LOCALE_NAMES = { en: 'English', is: 'Icelandic' };

function isSupportedDirection(from, to) {
  return from !== to && !!LOCALE_NAMES[from] && !!LOCALE_NAMES[to];
}

// Lazy-initialised Anthropic client, rebuilt whenever the auth configuration
// changes (a key rotation, or the switch to workload identity — anthropicAuth,
// harvested from icelandicstore #326, 2026-09-24).
let cachedClient = null;
let cachedKey = null;

function getClient() {
  const key = anthropicAuth.authSignature();
  if (!key) return null;
  if (cachedClient && cachedKey === key) return cachedClient;

  const auth = anthropicAuth.clientAuthOptions({ name: 'Anthropic (translate)' });
  const AnthropicMod = require('@anthropic-ai/sdk');
  const Ctor = AnthropicMod.default || AnthropicMod.Anthropic || AnthropicMod;
  // fetch: the SDK's undici client is invisible to App Insights; the tracked
  // wrapper records each model call as an HTTP dependency (dark without AI).
  cachedClient = new Ctor({ ...auth, fetch: fetchNamed('Anthropic messages (translate)') });
  cachedKey = key;
  return cachedClient;
}

function isEnabled() {
  return process.env.TRANSLATE_ENABLED === 'true' && anthropicAuth.isConfigured();
}

function getModel() {
  return process.env.TRANSLATE_MODEL || DEFAULT_MODEL;
}

function getTimeout() {
  const raw = parseInt(process.env.TRANSLATE_TIMEOUT_MS, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

// How long a call may wait for a free aiGate slot before giving up (the
// caller then leaves the target locale empty, as for any other failure).
//
// translate() runs ON the request path — autoTranslateFields awaits it before
// a product/news/project save is written — so it waits only briefly: under
// load a save goes through with the IS field empty rather than stalling, and
// wait + call stay inside server.js's 10 s shutdown grace (a self-update
// SIGTERM must not drop a save mid-flight). The tree batches run in the
// background (siteContentTranslate), so they may queue for two per-call
// timeouts: every call ahead finishes or aborts within one timeout of taking
// its slot, so a queued batch is not starved by a race with the release.
const REQUEST_QUEUE_WAIT_MS = 1000;
function getBatchQueueWaitMs() {
  return getTimeout() * 2;
}

function systemPrompt(format, from = 'en', to = 'is') {
  const fromName = LOCALE_NAMES[from] || 'English';
  const toName   = LOCALE_NAMES[to]   || 'Icelandic';
  const formatNote = format === 'markdown'
    ? 'The input uses Markdown formatting — preserve all Markdown syntax (headings, lists, emphasis, links, code fences) exactly.'
    : 'The input is plain text — preserve line breaks, punctuation, and spacing exactly.';
  return [
    `You are a professional translator. Translate the provided text from ${fromName} to ${toName}.`,
    formatNote,
    '',
    'DO NOT translate, paraphrase, or alter any of the following — keep them verbatim:',
    '  • URLs, email addresses, and file paths',
    '  • Slash-handle strings (e.g. pepti/hallismiley, @username)',
    '  • Placeholder tokens written as {0}, {1}, {name}, etc.',
    '  • HTML tags and their attributes',
    '  • Markdown syntax characters',
    '  • Code inside ` … ` or ``` … ``` fences',
    '  • Proper nouns: "Halli Smiley", "Halli", "HALLI SMILEY", "NetApp", "GitHub", "LinkedIn", "Azure", "Railway", "Node.js", "Express", "PostgreSQL", "Resend", "Sentry", "Stripe", "Multer", "Pino", "Helmet", "CSRF", "Lucia"',
    '  • Short English enum tokens like "open", "limited", "draft", "published"',
    '',
    `${toName} style: natural, native — not word-for-word. Match the case of the input (ALL CAPS stays ALL CAPS, Title Case stays Title Case).`,
    '',
    'Output rules:',
    `  • Return ONLY the ${toName} translation.`,
    '  • No preamble, no commentary, no quotation marks around the result.',
    `  • If a segment cannot be translated (e.g. it is already ${toName}), return it unchanged.`,
  ].join('\n');
}

function systemPromptForTree(from = 'en', to = 'is') {
  const fromName = LOCALE_NAMES[from] || 'English';
  const toName   = LOCALE_NAMES[to]   || 'Icelandic';
  return [
    `You are a professional translator. You will receive a JSON array of ${fromName} strings.`,
    `Translate each string from ${fromName} to ${toName} and return a JSON array of the SAME LENGTH with the translated strings in the SAME ORDER.`,
    '',
    'For each string follow these rules strictly:',
    '  • Preserve URLs, email addresses, file paths, slash-handles, HTML tags, Markdown syntax, placeholder tokens ({0}, {1}, {name}), and code spans verbatim.',
    '  • Preserve proper nouns: "Halli Smiley", "Halli", "NetApp", "GitHub", "LinkedIn", "Azure", "Railway", "Node.js", "Express", "PostgreSQL", "Resend", "Sentry", "Stripe", "Multer", "Pino", "Helmet", "CSRF", "Lucia".',
    '  • Match the case of each input (ALL CAPS stays ALL CAPS, Title Case stays Title Case).',
    '  • Short English enum tokens ("open", "limited", "draft") stay unchanged.',
    '',
    'Output: a JSON array only — no preamble, no commentary, no code fences, no keys other than array elements.',
    `If the input is already ${toName} for a given string, return it unchanged at the same position.`,
  ].join('\n');
}

// One model call. Returns { text, stopReason } (text null when there is no
// client or no text block), so a caller that cannot use the reply can log WHY:
// a `max_tokens` stop is a truncated JSON array, not a model that ignored the
// prompt.
async function callModel({ systemText, userText, maxTokens, signal }) {
  const client = getClient();
  if (!client) return { text: null, stopReason: null };
  const model = getModel();
  const res = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature: 0,
    system: systemText,
    messages: [{ role: 'user', content: userText }],
  }, { signal });

  // @anthropic-ai/sdk returns content as an array of typed blocks. For
  // non-tool responses we expect a single text block.
  const stopReason = (res && res.stop_reason) || null;
  if (!res || !Array.isArray(res.content)) return { text: null, stopReason };
  const textBlock = res.content.find(b => b && b.type === 'text');
  return {
    text: textBlock && typeof textBlock.text === 'string' ? textBlock.text.trim() : null,
    stopReason,
  };
}

function withTimeout(promiseFactory, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  return promiseFactory(ac.signal)
    .finally(() => clearTimeout(timer));
}

// A model call inside an aiGate slot. The slot is taken FIRST and the call's
// own timeout starts once it is held, so time spent queued behind other calls
// never eats into the model's budget.
function gatedCall(args, waitMs) {
  return aiGate.withQueuedSlot(
    () => withTimeout((signal) => callModel({ ...args, signal }), getTimeout()),
    { waitMs },
  );
}

// Every slot was taken for the whole wait: back-pressure, not a fault.
const BUSY = Symbol('translator.busy');
function logFailure(err, fields, msg) {
  if (err instanceof aiGate.AiBusyError) logger.warn(fields, `${msg} (aiGate busy)`);
  else logger.error({ err, ...fields }, msg);
}

function tryJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/**
 * The model's reply to a batch as an array, or null. Tolerant of a ```json
 * fence and of prose around the JSON, which the model occasionally adds
 * despite the prompt (ported from icelandicstore #216, visionCore.parseItems):
 * the whole reply first, then its outermost [...] span, then its outermost
 * {...} span when that object holds exactly one array (a reply shaped
 * {"translations": [...]}). The caller still checks the length.
 */
function parseJsonArray(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const span = (open, close) => {
    const i = cleaned.indexOf(open);
    const j = cleaned.lastIndexOf(close);
    return i !== -1 && j > i ? cleaned.slice(i, j + 1) : '';
  };
  const arrayOf = (v) => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const arrays = Object.values(v).filter(Array.isArray);
      if (arrays.length === 1) return arrays[0];
    }
    return null;
  };
  for (const candidate of [cleaned, span('[', ']'), span('{', '}')]) {
    if (!candidate) continue;
    const arr = arrayOf(tryJsonParse(candidate));
    if (arr) return arr;
  }
  return null;
}

/**
 * Translate a single piece of text. Returns null on any failure (flag off,
 * missing key, timeout, SDK error) so the caller keeps the EN save moving.
 */
async function translate({ text, sourceLocale = 'en', targetLocale = 'is', format = 'plain' } = {}) {
  if (!isSupportedDirection(sourceLocale, targetLocale)) return null;
  if (typeof text !== 'string' || text.trim() === '') return null;
  if (!isEnabled()) return null;

  const maxTokens = Math.max(256, Math.min(8000, Math.ceil(text.length * 0.7) + 64));
  const started = Date.now();
  try {
    const { text: out, stopReason } = await gatedCall({
      systemText: systemPrompt(format, sourceLocale, targetLocale),
      userText: text,
      maxTokens,
    }, REQUEST_QUEUE_WAIT_MS);
    const ms = Date.now() - started;
    if (typeof out === 'string' && out.length > 0) {
      logger.info({ chars: text.length, ms, ok: true }, 'translator.translate');
      return out;
    }
    logger.warn({ chars: text.length, ms, ok: false, stopReason }, 'translator.translate empty response');
    return null;
  } catch (err) {
    const ms = Date.now() - started;
    logFailure(err, { chars: text.length, ms, ok: false }, 'translator.translate failed');
    return null;
  }
}

/**
 * Walk a deep-cloned jsonb-style tree, collecting string leaves (except
 * those whose key is in BLOCK_KEYS) with their path. Returns the clone + a
 * parallel array of { path, value } descriptors so the caller can apply
 * translations by path.
 */
function collectLeaves(node, pathAcc, depth, leaves) {
  if (depth > MAX_TREE_DEPTH) return;
  if (node === null || node === undefined) return;

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const child = node[i];
      if (typeof child === 'string' && child.trim() !== '') {
        leaves.push({ path: pathAcc.concat(i), value: child });
      } else if (child && typeof child === 'object') {
        collectLeaves(child, pathAcc.concat(i), depth + 1, leaves);
      }
    }
    return;
  }

  if (typeof node === 'object') {
    // Sibling-peek: when an object declares `type: 'literal'` (code-snippet
    // property rows whose value is raw code like `() => true`), leave the
    // sibling `value` untouched so the translator never rewrites code.
    const skipValue = node.type === 'literal';
    for (const key of Object.keys(node)) {
      if (BLOCK_KEYS.has(key)) continue;
      if (skipValue && key === 'value') continue;
      const child = node[key];
      if (typeof child === 'string' && child.trim() !== '') {
        leaves.push({ path: pathAcc.concat(key), value: child });
      } else if (child && typeof child === 'object') {
        collectLeaves(child, pathAcc.concat(key), depth + 1, leaves);
      }
    }
  }
}

function setPath(root, path, value) {
  let cur = root;
  for (let i = 0; i < path.length - 1; i++) {
    cur = cur[path[i]];
  }
  cur[path[path.length - 1]] = value;
}

async function translateBatch(strings, { sourceLocale = 'en', targetLocale = 'is' } = {}) {
  if (!isEnabled()) return null;
  if (!Array.isArray(strings) || strings.length === 0) return [];

  const payload = JSON.stringify(strings);
  const maxTokens = Math.max(512, Math.min(16000, Math.ceil(payload.length * 0.8) + 128));

  const started = Date.now();
  try {
    const { text: out, stopReason } = await gatedCall({
      systemText: systemPromptForTree(sourceLocale, targetLocale),
      userText: payload,
      maxTokens,
    }, getBatchQueueWaitMs());
    if (typeof out !== 'string') {
      logger.warn({ count: strings.length, stopReason }, 'translator.batch no text in the response');
      return null;
    }

    const parsed = parseJsonArray(out);
    if (!parsed) {
      // stop_reason tells a truncated reply (max_tokens) from one that ignored
      // the format (end_turn). The preview is admin-authored site copy.
      logger.warn({ stopReason, rawLength: out.length, preview: out.slice(0, 200) },
        'translator.batch JSON parse failed');
      return null;
    }

    if (!Array.isArray(parsed) || parsed.length !== strings.length) {
      logger.warn({ got: Array.isArray(parsed) ? parsed.length : typeof parsed, want: strings.length },
        'translator.batch length mismatch');
      return null;
    }

    const ms = Date.now() - started;
    logger.info({ count: strings.length, ms, ok: true }, 'translator.translateTree batch');
    return parsed.map((v, i) => (typeof v === 'string' ? v : strings[i]));
  } catch (err) {
    const ms = Date.now() - started;
    logFailure(err, { count: strings.length, ms, ok: false }, 'translator.translateTree batch failed');
    // Busy is reported apart from a failure: the tree must not answer it
    // with a per-leaf fallback, which would multiply the calls the gate is
    // there to hold back.
    return err instanceof aiGate.AiBusyError ? BUSY : null;
  }
}

// Maximum string leaves to translate in a single batched LLM call. Each
// chunk asks the model to produce a JSON array of N translations; with
// N > ~30 the output token budget for a single call regularly exceeds
// the per-call timeout (TRANSLATE_TIMEOUT_MS=8000ms) on big jsonb keys
// like halli_bio (~200 leaves total). At CHUNK_SIZE=25 each batched
// call comfortably fits within the timeout; chunks run in parallel waves of
// aiGate.maxConcurrent() (default 4), so the wall-clock cost is roughly the
// slowest chunk per wave (~3-6s each).
const TRANSLATE_TREE_CHUNK_SIZE = 25;

/**
 * Translate all string leaves (outside BLOCK_KEYS) of a jsonb-style tree.
 * Returns a deep-cloned tree with translations substituted.
 *
 * Strategy (in order):
 *   1. Single batched call if leaves <= CHUNK_SIZE — same as before.
 *   2. Chunked batched calls in parallel waves, each batch sized to fit
 *      within TRANSLATE_TIMEOUT_MS. Successful chunks contribute their
 *      translations; failed chunks fall through to per-leaf for those
 *      specific leaves only, NOT the whole tree.
 *   3. If everything fails, return null so the caller skips the write.
 */
async function translateTree(tree, { format = 'plain', sourceLocale = 'en', targetLocale = 'is' } = {}) {
  // format is reserved; today we treat every string leaf as plain because
  // site_content rarely contains markdown. Left as a parameter so callers
  // can opt in later without changing signatures.
  void format;
  if (!isEnabled()) return null;
  if (!tree || typeof tree !== 'object') return null;

  const dir = { sourceLocale, targetLocale };
  const clone = JSON.parse(JSON.stringify(tree));
  const leaves = [];
  collectLeaves(clone, [], 0, leaves);
  if (leaves.length === 0) return clone;

  // For small trees the single batched call is most efficient — one
  // round-trip and no overhead from chunk coordination.
  if (leaves.length <= TRANSLATE_TREE_CHUNK_SIZE) {
    const batched = await translateBatch(leaves.map(l => l.value), dir);
    if (batched === BUSY) return null; // the gate was full: skip, never fan out
    if (batched) {
      leaves.forEach((leaf, i) => setPath(clone, leaf.path, batched[i]));
      return clone;
    }
    // Single batch failed — fall through to per-leaf below.
  } else {
    // Chunk the leaves and translate them in WAVES of at most
    // aiGate.maxConcurrent() chunks (harvest2 lane 1b review): a big tree
    // never queues more calls than there are slots, so its own chunks cannot
    // time out waiting on each other. Each chunk returns an array (success),
    // BUSY (the gate stayed full) or null (failure for that chunk).
    const chunks = [];
    for (let i = 0; i < leaves.length; i += TRANSLATE_TREE_CHUNK_SIZE) {
      chunks.push(leaves.slice(i, i + TRANSLATE_TREE_CHUNK_SIZE));
    }
    const chunkResults = [];
    const wave = aiGate.maxConcurrent();
    for (let i = 0; i < chunks.length; i += wave) {
      chunkResults.push(...await Promise.all(
        chunks.slice(i, i + wave).map(chunk => translateBatch(chunk.map(l => l.value), dir))
      ));
    }

    // Apply translations from successful chunks. Track which leaves
    // still need per-leaf translation (chunks that failed). A BUSY chunk
    // gets no per-leaf retry — that would multiply the calls the gate holds
    // back; its leaves keep the source text, as a failed leaf always has.
    const needsPerLeaf = [];
    let anyChunkOk = false;
    chunks.forEach((chunkLeaves, ci) => {
      const result = chunkResults[ci];
      if (result && Array.isArray(result) && result.length === chunkLeaves.length) {
        chunkLeaves.forEach((leaf, li) => setPath(clone, leaf.path, result[li]));
        anyChunkOk = true;
      } else if (result !== BUSY) {
        needsPerLeaf.push(...chunkLeaves);
      }
    });

    if (needsPerLeaf.length === 0) return anyChunkOk ? clone : null;
    logger.warn(
      { failed: needsPerLeaf.length, total: leaves.length },
      'translator.translateTree falling back to per-leaf for failed chunks'
    );
    // Fall through to per-leaf only for the leaves whose chunk failed; the
    // chunks that DID translate count even if every leaf retry fails.
    const filled = await fillPerLeaf(clone, needsPerLeaf, dir);
    return filled || (anyChunkOk ? clone : null);
  }

  // Per-leaf fallback for the small-tree path (single batch failed).
  return await fillPerLeaf(clone, leaves, dir);
}

// Translate the given leaves one at a time and apply to clone. Returns
// the populated clone if at least one leaf succeeded, null otherwise.
// Used as the last-resort fallback when batched translation fails.
async function fillPerLeaf(clone, leaves, { sourceLocale = 'en', targetLocale = 'is' } = {}) {
  let anyOk = false;
  for (const leaf of leaves) {
    const t = await translate({ text: leaf.value, sourceLocale, targetLocale, format: 'plain' });
    if (t) {
      setPath(clone, leaf.path, t);
      anyOk = true;
    }
  }
  return anyOk ? clone : null;
}

module.exports = {
  translate,
  translateTree,
  isEnabled,
  // exported for tests
  _internal: { BLOCK_KEYS, MAX_TREE_DEPTH, collectLeaves, setPath, parseJsonArray },
};
