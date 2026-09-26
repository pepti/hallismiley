'use strict';

/**
 * The email shell is the instance's own (harvest 2 lane 2, 2026-09-26;
 * ported from icelandicstore #179 + #190): the header logo, brand name, host,
 * legal line and From display name come from the identity seam
 * (identity.brand / identity.organization / identity.email, APP_URL), never
 * from a literal in engine code.
 *
 * Two identities are rendered through every sender:
 *   • the ENGINE defaults (schema, CLIENT_CONFIG_FILE → {}): Orange Smiley's
 *     emblem + name, as the engine ships them;
 *   • a FAKE downstream (a wordmark logo, its own name, host, address and an
 *     accent override): not one "Orange Smiley" / "orangesmiley" survives in
 *     any mail, header or From line.
 * Plus: the logo THIS instance's config names exists under
 * public/assets/brand/ and is not upscaled (every repo).
 *
 * The Resend client is replaced so nothing is sent.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const sent = [];
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn(async (msg) => { sent.push(msg); return { data: { id: 'msg-1' }, error: null }; }) },
  })),
}));

const { renderAllEmails } = require('../lib/renderAllEmails');

const ROOT = path.join(__dirname, '../..');
const saved = {
  file: process.env.CLIENT_CONFIG_FILE, appUrl: process.env.APP_URL, key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM,
};
let dir;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-shell-')); });
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [k, env] of [['file', 'CLIENT_CONFIG_FILE'], ['appUrl', 'APP_URL'], ['key', 'RESEND_API_KEY'], ['from', 'EMAIL_FROM']]) {
    if (saved[k] === undefined) delete process.env[env]; else process.env[env] = saved[k];
  }
});

/** A fresh emailService over a client.json holding exactly `fileConfig`. */
function load(fileConfig, appUrl) {
  const file = path.join(dir, `client-${process.hrtime.bigint()}.json`);
  fs.writeFileSync(file, JSON.stringify(fileConfig));
  let svc;
  jest.isolateModules(() => {
    process.env.CLIENT_CONFIG_FILE = file;
    process.env.APP_URL = appUrl;
    process.env.RESEND_API_KEY = 're_test';
    delete process.env.EMAIL_FROM;
    svc = require('../../server/services/emailService');
  });
  return svc;
}

const imgTag = (html) => (html.match(/<img[\s\S]*?\/>/) || [''])[0];

describe('email shell — the engine defaults', () => {
  let mails;
  beforeAll(async () => { mails = await renderAllEmails(load({}, 'https://www.orangesmiley.is'), sent); });

  test('the header logo is the emblem, absolute under APP_URL, alt = the brand name', () => {
    for (const { msg } of mails) {
      const img = imgTag(msg.html);
      expect(img).toMatch(/src="https:\/\/www\.orangesmiley\.is\/assets\/brand\/orangesmiley-emblem\.png"/);
      expect(img).toMatch(/alt="Orange Smiley"/);
      expect(img).toMatch(/width="48" height="48"/);
    }
  });

  test('an emblem is not a wordmark: the name is set as text beside it, with the host', () => {
    const { html } = mails[0].msg;
    expect(html).toMatch(/<p style="margin:0;font-size:22px;font-weight:700;[^"]*">Orange Smiley<\/p>/);
    expect(html).toMatch(/text-transform:uppercase;">orangesmiley\.is<\/p>/);
  });

  test('the footer names the legal entity and links the site', () => {
    const { html } = mails[0].msg;
    expect(html).toMatch(/>\s*Orange Smiley ehf\.\s*<\/p>/);
    expect(html).toMatch(/<a href="https:\/\/www\.orangesmiley\.is" style="color:#[0-9A-F]{6};text-decoration:underline;">orangesmiley\.is<\/a>/);
  });

  test('From is the brand at the organization address', () => {
    for (const { msg } of mails) expect(msg.from).toBe('Orange Smiley <info@orangesmiley.is>');
  });
});

describe('email shell — a downstream identity leaks no engine brand', () => {
  const DOWNSTREAM = {
    identity: {
      brand: { name: 'Kaffibrennslan Glóð', legalName: 'Kaffibrennslan Glóð ehf.', alternateNames: [], titleSuffix: ' — Glóð' },
      organization: { email: 'hallo@glod.test' },
      email: { logo: 'glod-logo.png', logoWidth: 150, logoHeight: 52, logoWordmark: true, palette: { accent: '#0B5D3B' } },
    },
  };
  let mails;
  beforeAll(async () => { mails = await renderAllEmails(load(DOWNSTREAM, 'https://www.glod.test'), sent); });

  test('not one mail, subject or From line carries Orange Smiley', () => {
    for (const { name, msg } of mails) {
      const all = [msg.from, msg.subject, msg.html].join('\n');
      expect({ name, leak: all.match(/orange\s*smiley/i) }).toEqual({ name, leak: null });
    }
  });

  test('its wordmark logo stands alone, alt text in the wordmark type as the blocked-image fallback', () => {
    const { html } = mails[0].msg;
    const img = imgTag(html);
    expect(img).toMatch(/src="https:\/\/www\.glod\.test\/assets\/brand\/glod-logo\.png"/);
    expect(img).toMatch(/alt="Kaffibrennslan Glóð"/);
    expect(img).toMatch(/width="150" height="52"/);
    expect(img).toMatch(/font-size:18px;font-weight:700;/);
    expect(html).toMatch(/<a href="https:\/\/www\.glod\.test" style="text-decoration:none;">\s*<img/);
    expect(html).not.toMatch(/font-size:22px;font-weight:700;[^"]*">Kaffibrennslan/);   // no text lockup beside a wordmark
  });

  test('host, legal line, From and the palette override are its own', () => {
    const { html, from } = mails[0].msg;
    expect(html).toMatch(/text-transform:uppercase;">glod\.test<\/p>/);
    expect(html).toMatch(/>\s*Kaffibrennslan Glóð ehf\.\s*<\/p>/);
    expect(html).toContain('style="color:#0B5D3B;text-decoration:underline;">glod.test</a>');
    expect(from).toBe('Kaffibrennslan Glóð <hallo@glod.test>');
  });

  test('a brand name with an RFC 5322 special is quoted in From', () => {
    const svc = load({ identity: { brand: { name: 'Glóð ehf.', legalName: 'Glóð ehf.' }, organization: { email: 'hallo@glod.test' } } }, 'https://www.glod.test');
    return svc.sendVerificationEmail('a@example.test', 'tok', 'is').then(() => {
      expect(sent[sent.length - 1].from).toBe('"Glóð ehf." <hallo@glod.test>');
    });
  });
});

describe('email shell — this instance', () => {
  const { identity } = require('../../server/config/identity');
  const file = path.join(ROOT, 'public/assets/brand', identity.email.logo);

  test('the configured logo exists under public/assets/brand/', () => {
    expect(fs.existsSync(file)).toBe(true);
  });

  test('the logo is not upscaled: its pixels are at least its shown size', () => {
    const buf = fs.readFileSync(file);
    if (buf.slice(1, 4).toString() !== 'PNG') return;   // only PNG headers are read here
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(width).toBeGreaterThanOrEqual(identity.email.logoWidth);
    expect(height).toBeGreaterThanOrEqual(identity.email.logoHeight);
  });

  // #190: a wordmark's alt text replaces the image when it is blocked, so it
  // must fit the box rather than wrap and clip. ~0.49em per character is a
  // safe upper bound for a bold UI sans at 18px.
  test('a wordmark logo is wide enough for its alt-text fallback', () => {
    if (!identity.email.logoWordmark) return;
    expect(identity.brand.name.length * 18 * 0.49).toBeLessThan(identity.email.logoWidth);
  });
});
