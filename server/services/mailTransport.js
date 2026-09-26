'use strict';

// ── Mail transports: which one, is it configured, and the Graph sender ──────
//
// emailService.deliver() is the one choke point every message goes through
// (placeholder drop, EMAIL_ALLOWLIST rewrite, Reply-To, bounded wait, loud
// failure). Behind it sits exactly one transport, chosen by ONE explicit
// switch:
//
//   EMAIL_TRANSPORT=resend  (default) Resend's HTTP API — RESEND_API_KEY.
//   EMAIL_TRANSPORT=graph   Microsoft Graph sendMail from a Microsoft 365
//                           mailbox in the customer's own tenant — an Entra
//                           app registration (client credentials) with the
//                           application permission Mail.Send, narrowed to the
//                           one mailbox by an Exchange application access
//                           policy on the tenant side:
//                             GRAPH_TENANT_ID, GRAPH_CLIENT_ID,
//                             GRAPH_CLIENT_SECRET (on the expiry watch — a
//                             client secret lives at most 24 months),
//                             GRAPH_SENDER (the mailbox; default: the
//                             address in EMAIL_FROM),
//                             GRAPH_SAVE_TO_SENT_ITEMS=true (opt-in; off by
//                             default).
//                           icelandicstore's names M365_TENANT_ID /
//                           M365_CLIENT_ID / M365_CLIENT_SECRET are read as a
//                           fallback, so its App Service settings keep
//                           working when it takes the engine sync.
//
// The Graph variables alone never switch the transport: an instance with a
// half-finished Entra setup keeps sending through Resend until someone sets
// EMAIL_TRANSPORT=graph on purpose. An unknown EMAIL_TRANSPORT value is not a
// transport — nothing is configured, which the senders report loudly.
//
// Ported from icelandicstore #173 (2026-08-18), where Graph REPLACED Resend
// (Halli: the store keeps Microsoft 365, one mailbox for everything). In the
// engine it is an option beside Resend, off unless configured (harvest 2
// lane 2, 2026-09-26). Differences from ice, on purpose:
//   • saveToSentItems defaults to false — a transactional stream (resets,
//     receipts) would otherwise fill the shared mailbox's Sent Items; the
//     minted client-request-id is what an Exchange message trace finds it
//     by. An instance that wants the copies (ice did) sets
//     GRAPH_SAVE_TO_SENT_ITEMS=true;
//   • ONE deadline per send: the caller's AbortSignal bounds the token
//     fetch, the sendMail call and the 401 retry together, so a slow token
//     cannot buy the send a second full timeout;
//   • every call is a trackedFetch (App Insights dependency, no query
//     string recorded); the token is cached until a minute before it
//     expires and concurrent sends share ONE in-flight token request; a 401
//     on a cached token retries once with a fresh one.
//
// The Resend-shaped result ({ data: { id }, error }) is the contract: the
// senders return data.id as "sent" (the invite-sent-means-sent contract,
// server/utils/inviteSend.js). Graph answers 202 with NO message id, so the
// id is the client-request-id minted here — the value to quote in a message
// trace or a Microsoft support case.

const { randomUUID } = require('crypto');
const { trackedFetch } = require('../observability/trackedFetch');

const TRANSPORTS = Object.freeze(['resend', 'graph']);

/** The transport this environment selects: 'resend' | 'graph' | null (unknown). */
function transportName(env = process.env) {
  const raw = String(env.EMAIL_TRANSPORT || 'resend').trim().toLowerCase();
  return TRANSPORTS.includes(raw) ? raw : null;
}

// GRAPH_* first, icelandicstore's M365_* as the fallback (see the header).
const pick = (env, ...names) => {
  for (const n of names) if (env[n] !== undefined && String(env[n]).trim() !== '') return String(env[n]);
  return '';
};

function graphSettings(env = process.env, fallbackSender = '') {
  return {
    tenantId:     pick(env, 'GRAPH_TENANT_ID', 'M365_TENANT_ID').trim(),
    clientId:     pick(env, 'GRAPH_CLIENT_ID', 'M365_CLIENT_ID').trim(),
    clientSecret: pick(env, 'GRAPH_CLIENT_SECRET', 'M365_CLIENT_SECRET'),
    sender:       String(env.GRAPH_SENDER || fallbackSender || '').trim(),
    saveToSentItems: /^(true|1|yes|on)$/i.test(String(env.GRAPH_SAVE_TO_SENT_ITEMS || '').trim()),
  };
}

/** The env vars the selected transport still lacks ([] = configured). */
function missingSettings(env = process.env, fallbackSender = '') {
  const name = transportName(env);
  if (name === 'resend') return env.RESEND_API_KEY ? [] : ['RESEND_API_KEY'];
  if (name === 'graph') {
    const g = graphSettings(env, fallbackSender);
    return [
      !g.tenantId && 'GRAPH_TENANT_ID',
      !g.clientId && 'GRAPH_CLIENT_ID',
      !g.clientSecret && 'GRAPH_CLIENT_SECRET',
      !g.sender && 'GRAPH_SENDER (or EMAIL_FROM)',
    ].filter(Boolean);
  }
  return [`EMAIL_TRANSPORT (unknown value "${env.EMAIL_TRANSPORT}"; one of ${TRANSPORTS.join(', ')})`];
}

function isTransportConfigured(env = process.env, fallbackSender = '') {
  return missingSettings(env, fallbackSender).length === 0;
}

// ── Microsoft Graph ──────────────────────────────────────────────────────────

let cachedToken = null; // { key, value, expiresAt }
let inflight = null;    // { key, promise } — one token request shared by concurrent sends

function _resetTokenCache() { cachedToken = null; inflight = null; }

async function fetchToken(g, key, signal) {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(g.tenantId)}/oauth2/v2.0/token`;
  const res = await trackedFetch('Graph token', url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: g.clientId,
      client_secret: g.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    // The AADSTS code (AADSTS7000215 = bad secret, AADSTS700016 = unknown
    // app) is what the operator needs — never the secret. First line only:
    // Entra's descriptions are paragraphs with a trace id and timestamp.
    const detail = String(json.error_description || json.error || 'no access_token in the response').split(/\r?\n/)[0];
    const err = new Error(`Entra token request failed (${res.status}): ${detail}`);
    err.tokenRejected = true;
    throw err;
  }
  // Refresh a minute early so a token never expires mid-send.
  const ttl = Math.max(60, Number(json.expires_in) || 3600);
  cachedToken = { key, value: json.access_token, expiresAt: Date.now() + (ttl - 60) * 1000 };
  return cachedToken.value;
}

// The cached token, or the ONE in-flight request for it: a burst of sends
// (a party announcement, a bulk invite) with a cold cache asks Entra once.
// The shared request is bounded on its own (timeoutMs) rather than by the
// first caller's deadline — one caller running out must not fail the others —
// and each caller still races its OWN deadline, so no send outlives its budget.
async function getAccessToken(g, signal, timeoutMs = 10000) {
  const key = `${g.tenantId}/${g.clientId}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  if (!inflight || inflight.key !== key) {
    const entry = { key, promise: null };
    entry.promise = fetchToken(g, key, AbortSignal.timeout(timeoutMs)).finally(() => { if (inflight === entry) inflight = null; });
    inflight = entry;
  }
  return raceSignal(inflight.promise, signal);
}

function raceSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

// "Name <a@b>" or "a@b" → Graph's recipient record.
function toRecipient(entry) {
  const s = String(entry || '').trim();
  const m = /^(.*)<([^>]+)>\s*$/.exec(s);
  if (m) {
    const name = m[1].trim().replace(/^"|"$/g, '');
    return { emailAddress: name ? { name, address: m[2].trim() } : { address: m[2].trim() } };
  }
  return { emailAddress: { address: s } };
}

function toRecipients(v) {
  return (Array.isArray(v) ? v : [v]).filter(Boolean).map(toRecipient);
}

/**
 * Send one Resend-shaped message ({ from, to, cc?, bcc?, replyTo?, subject,
 * html, attachments? }) through Graph sendMail. `from` is not sent: the
 * mailbox in the URL is the sender, enforced tenant-side. Resolves
 * { data: { id }, error: null } on 202, { data: null, error: { message } }
 * otherwise; throws only on a network error or when `signal` (the ONE
 * deadline for the whole send — token, sendMail and the retry) fires;
 * deliver() catches both.
 */
async function sendViaGraph(msg, { env = process.env, fallbackSender = '', signal, timeoutMs = 10000, _retriedAuth = false } = {}) {
  const g = graphSettings(env, fallbackSender);
  const id = randomUUID();
  const message = {
    subject: msg.subject,
    body: { contentType: 'HTML', content: msg.html },
    toRecipients: toRecipients(msg.to),
  };
  if (msg.cc)      message.ccRecipients  = toRecipients(msg.cc);
  if (msg.bcc)     message.bccRecipients = toRecipients(msg.bcc);
  if (msg.replyTo) message.replyTo       = toRecipients(msg.replyTo);
  if (Array.isArray(msg.attachments) && msg.attachments.length) {
    message.attachments = msg.attachments.map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename,
      contentBytes: Buffer.from(a.content).toString('base64'),
    }));
  }

  let token;
  try {
    token = await getAccessToken(g, signal, timeoutMs);
  } catch (err) {
    if (!err || !err.tokenRejected) throw err;   // timeout / network: deliver() reports it
    return { data: null, error: { message: err.message } };
  }

  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(g.sender)}/sendMail`;
  const res = await trackedFetch('Graph sendMail', url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'client-request-id': id,
      'return-client-request-id': 'true',
    },
    body: JSON.stringify({ message, saveToSentItems: g.saveToSentItems }),
    signal,
  });
  if (res.status === 202) return { data: { id }, error: null };
  // A 401 on a cached token: revoked, or the app's credential rotated under
  // us. Drop it and try once with a fresh one — under the SAME deadline.
  if (res.status === 401 && !_retriedAuth) {
    _resetTokenCache();
    return sendViaGraph(msg, { env, fallbackSender, signal, timeoutMs, _retriedAuth: true });
  }
  const body = await res.json().catch(() => ({}));
  const detail = [res.status, body && body.error && body.error.code, body && body.error && body.error.message]
    .filter(Boolean).join(' ');
  return { data: null, error: { message: `Graph sendMail failed: ${detail} (client-request-id ${id})` } };
}

module.exports = {
  TRANSPORTS, transportName, graphSettings, missingSettings, isTransportConfigured, sendViaGraph, _resetTokenCache,
};
