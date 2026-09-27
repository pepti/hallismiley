'use strict';
// server/utils/indexability.js — the one rule deciding whether a request may be
// indexed; ssrMeta (the robots meta tag), robots.txt and the sitemap all read it,
// so they can never disagree. Ported from icelandicstore #123.
const { isPublicHost, isIndexableRequest } = require('../../server/utils/indexability');

const req = (host) => ({ headers: { host } });

describe('isPublicHost', () => {
  test('a real custom domain is public', () => {
    expect(isPublicHost('www.orangesmiley.is')).toBe(true);
    expect(isPublicHost('orangesmiley.is')).toBe(true);
  });

  test('Azure default hostnames are infrastructure, never public', () => {
    expect(isPublicHost('orangesmiley-prod-web.azurewebsites.net')).toBe(false);
    expect(isPublicHost('orangesmiley-web-canary.azurewebsites.net')).toBe(false);
  });

  test('localhost and bare IPs are not public', () => {
    expect(isPublicHost('localhost')).toBe(false);
    expect(isPublicHost('localhost:3000')).toBe(false);
    expect(isPublicHost('books.localhost:3000')).toBe(false);
    expect(isPublicHost('127.0.0.1:3000')).toBe(false);
    expect(isPublicHost('10.0.0.4')).toBe(false);
    expect(isPublicHost('[::1]:3000')).toBe(false);
    expect(isPublicHost('::1')).toBe(false);
  });

  test('the port is ignored and matching is case-insensitive', () => {
    expect(isPublicHost('WWW.OrangeSmiley.is:443')).toBe(true);
    expect(isPublicHost('ORANGESMILEY-WEB.AZUREWEBSITES.NET')).toBe(false);
  });

  test('a missing or empty Host is not public', () => {
    expect(isPublicHost(undefined)).toBe(false);
    expect(isPublicHost('')).toBe(false);
    expect(isPublicHost('   ')).toBe(false);
  });

  test('a lookalike that merely contains the Azure suffix is still public (suffix, not substring)', () => {
    expect(isPublicHost('azurewebsites.net.orangesmiley.is')).toBe(true);
  });
});

describe('isIndexableRequest', () => {
  const prev = process.env.APP_ENV;
  afterEach(() => {
    if (prev === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = prev;
  });

  test('production on the public domain is indexable', () => {
    process.env.APP_ENV = 'production';
    expect(isIndexableRequest(req('www.orangesmiley.is'))).toBe(true);
  });

  test('production on the Azure hostname is not', () => {
    process.env.APP_ENV = 'production';
    expect(isIndexableRequest(req('orangesmiley-prod-web.azurewebsites.net'))).toBe(false);
  });

  test.each(['test', 'staging', 'development', 'canary'])('APP_ENV=%s is never indexable, even on a custom domain', (tier) => {
    process.env.APP_ENV = tier;
    expect(isIndexableRequest(req('www.orangesmiley.is'))).toBe(false);
  });

  test('an unset APP_ENV defaults to production, so the host alone decides', () => {
    delete process.env.APP_ENV;
    expect(isIndexableRequest(req('www.orangesmiley.is'))).toBe(true);
    expect(isIndexableRequest(req('localhost:3000'))).toBe(false);
  });

  test('a malformed request object does not throw', () => {
    process.env.APP_ENV = 'production';
    expect(isIndexableRequest(undefined)).toBe(false);
    expect(isIndexableRequest({})).toBe(false);
  });
});
