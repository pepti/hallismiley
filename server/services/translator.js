'use strict';

/**
 * Anthropic-backed EN → IS translator for admin-saved content.
 *
 * Design rules (see plan `auto-translate-en-is-on-admin-save`):
 *   - Feature-flagged via TRANSLATE_ENABLED. When the flag is off OR
 *     ANTHROPIC_API_KEY is blank, every exported function becomes a no-op
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

const logger = require('../logger');

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
]);

const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_TREE_DEPTH = 20;

// Lazy-initialised Anthropic client. Recreated if the API key changes at
// runtime (rare but cheap).
let cachedClient = null;
let cachedKey = null;

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (cachedClient && cachedKey === key) return cachedClient;
  // eslint-disable-next-line global-require
  const AnthropicMod = require('@anthropic-ai/sdk');
  const Ctor = AnthropicMod.default || AnthropicMod.Anthropic || AnthropicMod;
  cachedClient = new Ctor({ apiKey: key });
  cachedKey = key;
  return cachedClient;
}

function isEnabled() {
  return process.env.TRANSLATE_ENABLED === 'true' && !!process.env.ANTHROPIC_API_KEY;
}

function getModel() {
  return process.env.TRANSLATE_MODEL || DEFAULT_MODEL;
}

function getTimeout() {
  const raw = parseInt(process.env.TRANSLATE_TIMEOUT_MS, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function systemPrompt(format) {
  const formatNote = format === 'markdown'
    ? 'The input uses Markdown formatting — preserve all Markdown syntax (headings, lists, emphasis, links, code fences) exactly.'
    : 'The input is plain text — preserve line breaks, punctuation, and spacing exactly.';
  return [
    'You are a professional translator. Translate the provided text from English to Icelandic.',
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
    'Icelandic style: natural, native — not word-for-word. Match the case of the input (ALL CAPS stays ALL CAPS, Title Case stays Title Case).',
    '',
    'Output rules:',
    '  • Return ONLY the Icelandic translation.',
    '  • No preamble, no commentary, no quotation marks around the result.',
    '  • If a segment cannot be translated (e.g. it is already Icelandic), return it unchanged.',
  ].join('\n');
}

function systemPromptForTree() {
  return [
    'You are a professional translator. You will receive a JSON array of English strings.',
    'Translate each string from English to Icelandic and return a JSON array of the SAME LENGTH with the translated strings in the SAME ORDER.',
    '',
    'For each string follow these rules strictly:',
    '  • Preserve URLs, email addresses, file paths, slash-handles, HTML tags, Markdown syntax, placeholder tokens ({0}, {1}, {name}), and code spans verbatim.',
    '  • Preserve proper nouns: "Halli Smiley", "Halli", "NetApp", "GitHub", "LinkedIn", "Azure", "Railway", "Node.js", "Express", "PostgreSQL", "Resend", "Sentry", "Stripe", "Multer", "Pino", "Helmet", "CSRF", "Lucia".',
    '  • Match the case of each input (ALL CAPS stays ALL CAPS, Title Case stays Title Case).',
    '  • Short English enum tokens ("open", "limited", "draft") stay unchanged.',
    '',
    'Output: a JSON array only — no preamble, no commentary, no code fences, no keys other than array elements.',
    'If the input is already Icelandic for a given string, return it unchanged at the same position.',
  ].join('\n');
}

async function callModel({ systemText, userText, maxTokens, signal }) {
  const client = getClient();
  if (!client) return null;
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
  if (!res || !Array.isArray(res.content)) return null;
  const textBlock = res.content.find(b => b && b.type === 'text');
  return textBlock && typeof textBlock.text === 'string' ? textBlock.text.trim() : null;
}

function withTimeout(promiseFactory, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  return promiseFactory(ac.signal)
    .finally(() => clearTimeout(timer));
}

/**
 * Translate a single piece of text. Returns null on any failure (flag off,
 * missing key, timeout, SDK error) so the caller keeps the EN save moving.
 */
async function translate({ text, targetLocale = 'is', format = 'plain' } = {}) {
  if (targetLocale !== 'is') return null;
  if (typeof text !== 'string' || text.trim() === '') return null;
  if (!isEnabled()) return null;

  const maxTokens = Math.max(256, Math.min(8000, Math.ceil(text.length * 0.7) + 64));
  const started = Date.now();
  try {
    const out = await withTimeout(
      (signal) => callModel({
        systemText: systemPrompt(format),
        userText: text,
        maxTokens,
        signal,
      }),
      getTimeout(),
    );
    const ms = Date.now() - started;
    if (typeof out === 'string' && out.length > 0) {
      logger.info({ chars: text.length, ms, ok: true }, 'translator.translate');
      return out;
    }
    logger.warn({ chars: text.length, ms, ok: false }, 'translator.translate empty response');
    return null;
  } catch (err) {
    const ms = Date.now() - started;
    logger.error({ err, chars: text.length, ms, ok: false }, 'translator.translate failed');
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
    for (const key of Object.keys(node)) {
      if (BLOCK_KEYS.has(key)) continue;
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

async function translateBatch(strings) {
  if (!isEnabled()) return null;
  if (!Array.isArray(strings) || strings.length === 0) return [];

  const payload = JSON.stringify(strings);
  const maxTokens = Math.max(512, Math.min(16000, Math.ceil(payload.length * 0.8) + 128));

  const started = Date.now();
  try {
    const out = await withTimeout(
      (signal) => callModel({
        systemText: systemPromptForTree(),
        userText: payload,
        maxTokens,
        signal,
      }),
      getTimeout(),
    );
    if (typeof out !== 'string') return null;

    // Model occasionally wraps in ```json … ``` despite instructions.
    const cleaned = out
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      logger.warn({ preview: cleaned.slice(0, 200) }, 'translator.batch JSON parse failed');
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
    logger.error({ err, count: strings.length, ms, ok: false }, 'translator.translateTree batch failed');
    return null;
  }
}

// Maximum string leaves to translate in a single batched LLM call. Each
// chunk asks the model to produce a JSON array of N translations; with
// N > ~30 the output token budget for a single call regularly exceeds
// the per-call timeout (TRANSLATE_TIMEOUT_MS=8000ms) on big jsonb keys
// like halli_bio (~200 leaves total). At CHUNK_SIZE=25 each batched
// call comfortably fits within the timeout; chunks run in parallel via
// Promise.all so the wall-clock cost is roughly the slowest single
// chunk (~3-6s) regardless of total leaf count.
const TRANSLATE_TREE_CHUNK_SIZE = 25;

/**
 * Translate all string leaves (outside BLOCK_KEYS) of a jsonb-style tree.
 * Returns a deep-cloned tree with translations substituted.
 *
 * Strategy (in order):
 *   1. Single batched call if leaves <= CHUNK_SIZE — same as before.
 *   2. Chunked batched calls in parallel, each batch sized to fit
 *      within TRANSLATE_TIMEOUT_MS. Successful chunks contribute their
 *      translations; failed chunks fall through to per-leaf for those
 *      specific leaves only, NOT the whole tree.
 *   3. If everything fails, return null so the caller skips the write.
 */
async function translateTree(tree, { format = 'plain' } = {}) {
  // format is reserved; today we treat every string leaf as plain because
  // site_content rarely contains markdown. Left as a parameter so callers
  // can opt in later without changing signatures.
  void format;
  if (!isEnabled()) return null;
  if (!tree || typeof tree !== 'object') return null;

  const clone = JSON.parse(JSON.stringify(tree));
  const leaves = [];
  collectLeaves(clone, [], 0, leaves);
  if (leaves.length === 0) return clone;

  // For small trees the single batched call is most efficient — one
  // round-trip and no overhead from chunk coordination.
  if (leaves.length <= TRANSLATE_TREE_CHUNK_SIZE) {
    const batched = await translateBatch(leaves.map(l => l.value));
    if (batched) {
      leaves.forEach((leaf, i) => setPath(clone, leaf.path, batched[i]));
      return clone;
    }
    // Single batch failed — fall through to per-leaf below.
  } else {
    // Chunk the leaves and translate chunks in parallel. Each chunk
    // returns an array (success) or null (failure for that chunk).
    const chunks = [];
    for (let i = 0; i < leaves.length; i += TRANSLATE_TREE_CHUNK_SIZE) {
      chunks.push(leaves.slice(i, i + TRANSLATE_TREE_CHUNK_SIZE));
    }
    const chunkResults = await Promise.all(
      chunks.map(chunk => translateBatch(chunk.map(l => l.value)))
    );

    // Apply translations from successful chunks. Track which leaves
    // still need per-leaf translation (chunks that failed).
    const needsPerLeaf = [];
    chunks.forEach((chunkLeaves, ci) => {
      const result = chunkResults[ci];
      if (result && Array.isArray(result) && result.length === chunkLeaves.length) {
        chunkLeaves.forEach((leaf, li) => setPath(clone, leaf.path, result[li]));
      } else {
        needsPerLeaf.push(...chunkLeaves);
      }
    });

    if (needsPerLeaf.length === 0) return clone;
    logger.warn(
      { failed: needsPerLeaf.length, total: leaves.length },
      'translator.translateTree falling back to per-leaf for failed chunks'
    );
    // Fall through to per-leaf only for the leaves whose chunk failed.
    return await fillPerLeaf(clone, needsPerLeaf);
  }

  // Per-leaf fallback for the small-tree path (single batch failed).
  return await fillPerLeaf(clone, leaves);
}

// Translate the given leaves one at a time and apply to clone. Returns
// the populated clone if at least one leaf succeeded, null otherwise.
// Used as the last-resort fallback when batched translation fails.
async function fillPerLeaf(clone, leaves) {
  let anyOk = false;
  for (const leaf of leaves) {
    const t = await translate({ text: leaf.value, format: 'plain' });
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
  _internal: { BLOCK_KEYS, MAX_TREE_DEPTH, collectLeaves, setPath },
};
