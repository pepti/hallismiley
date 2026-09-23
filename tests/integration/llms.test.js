'use strict';

/**
 * GET /llms.txt — server/routes/sitemapRoutes.js (rk-feed, 2026-09-23; born in
 * rekstrarkerfid 0a928c9 as a product hook, now the engine's).
 *
 * A plain-Markdown summary of the product for AI assistants (llmstxt.org):
 * the brand as the H1, the Organization description as the blockquote, then
 * every ADVERTISED page — home, the nav routes, the legal pages, minus hidden
 * and noindex — with its composed title and description, once per locale
 * (a locale-locked route under its lock only). Every expectation reads the
 * resolved seam and the same meta tables the pages read, so the suite passes
 * unchanged in a downstream.
 */
const request = require('supertest');
const app     = require('../../server/app');
const { HIDDEN_PUBLIC_ROUTES, NOINDEX_ROUTES, PUBLIC_NAV, LEGAL_ROUTES } = require('../../server/config/publicSurface');
const { identity, organizationDescription } = require('../../server/config/identity');
const { forcedLocaleFor, SUPPORTED_LOCALES, PUBLIC_DEFAULT_LOCALE } = require('../../server/config/i18n');
const { metaForRoute } = require('../../server/middleware/ssrMeta');
const { t, has } = require('../../server/i18n');

const ADVERTISED = ['/', ...PUBLIC_NAV.map((e) => e.route), ...LEGAL_ROUTES].filter((p) => !NOINDEX_ROUTES.includes(p));
const APP_URL = (process.env.APP_URL || 'https://www.orangesmiley.is').replace(/\/$/, '');
const urlOf = (locale, route) => (route === '/' ? `${APP_URL}/${locale}/` : `${APP_URL}/${locale}${route}`);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('GET /llms.txt', () => {
  let res;
  beforeAll(async () => { res = await request(app).get('/llms.txt'); });

  test('200, text/plain, cached like the sitemap', () => {
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.headers['cache-control']).toMatch(/public.*max-age=600.*stale-while-revalidate/);
  });

  test('opens with the brand as H1 and the Organization description as the blockquote', () => {
    const description = organizationDescription(PUBLIC_DEFAULT_LOCALE, { has, t });
    expect(res.text.startsWith(`# ${identity.brand.name}\n\n> ${description}\n`)).toBe(true);
    expect(res.text).toContain(identity.brand.legalName);
  });

  test('lists every advertised page under every locale (a locked route under its lock only), titled from the meta tables', () => {
    for (const route of ADVERTISED) {
      const lock = forcedLocaleFor(route);
      for (const locale of SUPPORTED_LOCALES) {
        const line = res.text.split('\n').find((l) => l.includes(`](${urlOf(locale, route)})`));
        if (lock && lock !== locale) { expect(line).toBeUndefined(); continue; }
        if (!line) throw new Error(`${locale}${route} is missing from /llms.txt`);
        const m = metaForRoute(locale, route);
        // The page name is the title's part (the brand suffix stripped, or
        // "Brand — x" as "Brand: x"), never the raw <title>.
        const suffix = identity.brand.titleSuffix;
        const part = suffix && m.title.endsWith(suffix) ? m.title.slice(0, -suffix.length)
          : m.title.startsWith(`${identity.brand.name} — `) ? `${identity.brand.name}: ${m.title.slice(identity.brand.name.length + 3)}` : m.title;
        expect(line).toMatch(new RegExp(`^- \\[${esc(part)}\\]\\(`));
        if (m.description) expect(line).toContain(`): ${m.description}`);
      }
    }
    // One section per locale, the visitor default first.
    const sections = [...res.text.matchAll(/^## Pages \(([a-z]{2})\)$/gm)].map((m) => m[1]);
    expect(sections[0]).toBe(PUBLIC_DEFAULT_LOCALE);
    expect(new Set(sections)).toEqual(new Set(SUPPORTED_LOCALES));
  });

  test('advertises nothing hidden, nothing noindex, nothing else', () => {
    const links = [...res.text.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    const allowed = new Set([`${APP_URL}/sitemap.xml`]);
    for (const route of ADVERTISED) for (const lc of SUPPORTED_LOCALES) allowed.add(urlOf(lc, route));
    expect(links.filter((u) => !allowed.has(u))).toEqual([]);
    for (const base of [...HIDDEN_PUBLIC_ROUTES, ...NOINDEX_ROUTES]) {
      for (const lc of SUPPORTED_LOCALES) expect(res.text).not.toContain(`(${urlOf(lc, base)}`);
    }
  });

  test('never leaks an unresolved value', () => {
    expect(res.text).not.toMatch(/undefined|null|\[object/);
    expect(res.text).toContain(`- [Sitemap](${APP_URL}/sitemap.xml)`);
  });
});
