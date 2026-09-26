'use strict';

/**
 * The email header logo is served where a mail client can load it (harvest 2
 * lane 2, 2026-09-26; icelandicstore #190). The shell points every message at
 * `${APP_URL}/assets/brand/<identity.email.logo>`, so that URL must answer
 * 200 with an image, and — because the mail renders on another origin — with
 * Cross-Origin-Resource-Policy: cross-origin (the one CORP exemption,
 * server/app.js; security.test.js pins that it does not widen).
 */
const request = require('supertest');
const app = require('../../server/app');
const { identity } = require('../../server/config/identity');

describe('email header logo asset', () => {
  test('the configured logo is served as an image, embeddable cross-origin', async () => {
    const res = await request(app).get(`/assets/brand/${encodeURIComponent(identity.email.logo)}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/(png|jpeg|gif)/);
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});
