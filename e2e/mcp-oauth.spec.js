// @ts-check
// The MCP connector's OAuth consent in a real browser (R5a, 2026-09-24): a
// Claude client registers and starts an authorization request; the admin,
// signed out at first, signs in on the consent page, sees the client and —
// the fact that matters — the host the approval goes back to, approves, and
// the browser lands on the client's callback with a code the client can
// redeem for a working token. claude.ai itself is never contacted: its
// callback URL is fulfilled locally.
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const s256 = (v) => crypto.createHash('sha256').update(v, 'ascii').digest('base64url');
const ADMIN = { username: 'testadmin', password: 'AdminPass123' };

test('an admin approves a Claude connection and the client gets a working token', async ({ page, request }) => {
  const reg = await request.post('/oauth/register', { data: { client_name: 'Claude', redirect_uris: [CALLBACK] } });
  expect(reg.status()).toBe(201);
  const { client_id } = await reg.json();

  const verifier = crypto.randomBytes(32).toString('base64url');
  const qs = new URLSearchParams({
    response_type: 'code', client_id, redirect_uri: CALLBACK, state: 'e2e-state',
    code_challenge: s256(verifier), code_challenge_method: 'S256', scope: 'read',
  });

  // The client's callback is answered here, so the approval's redirect can be
  // observed without leaving the test.
  await page.route('https://claude.ai/**', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'callback' }));

  await page.goto(`/oauth/authorize?${qs}`);
  await expect(page).toHaveURL(/\/(is|en)\/tengja\/[a-f0-9]{48}$/);
  const card = page.getByTestId('connect-card');
  await expect(card).toBeVisible();

  // Signed out: the page asks for a sign-in and opens the nav's login modal.
  await card.locator('#connect-signin').click();
  await page.fill('#login-username', ADMIN.username);
  await page.fill('#login-password', ADMIN.password);
  await page.click('.login-form [type=submit]');

  // Signed in as an admin: the request, with the redirect host spelled out.
  await expect(page.getByTestId('connect-client')).toHaveText('Claude');
  await expect(page.getByTestId('connect-host')).toHaveText('claude.ai');
  await expect(page).toHaveTitle(/.+/);

  await page.getByTestId('connect-approve').click();
  await page.waitForURL((u) => u.href.startsWith(CALLBACK));
  const back = new URL(page.url());
  expect(back.searchParams.get('state')).toBe('e2e-state');
  const code = back.searchParams.get('code');
  expect(code).toMatch(/^[a-f0-9]{64}$/);

  const tok = await request.post('/oauth/token', {
    form: { grant_type: 'authorization_code', client_id, code, redirect_uri: CALLBACK, code_verifier: verifier },
  });
  expect(tok.status()).toBe(200);
  const { access_token, scope } = await tok.json();
  expect(scope).toBe('read');

  const list = await request.post('/api/v1/mcp', {
    headers: { Authorization: `Bearer ${access_token}` },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  expect(list.status()).toBe(200);
  expect((await list.json()).result.tools.map((t) => t.name)).toContain('environment_info');
});

test('a denied request sends access_denied back to the client', async ({ page, request }) => {
  const { client_id } = await (await request.post('/oauth/register', { data: { client_name: 'Claude', redirect_uris: [CALLBACK] } })).json();
  const qs = new URLSearchParams({
    response_type: 'code', client_id, redirect_uri: CALLBACK, state: 'deny-state',
    code_challenge: s256(crypto.randomBytes(32).toString('base64url')), code_challenge_method: 'S256',
  });
  await page.route('https://claude.ai/**', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'callback' }));

  await page.goto(`/oauth/authorize?${qs}`);
  await page.locator('#connect-signin').click();
  await page.fill('#login-username', ADMIN.username);
  await page.fill('#login-password', ADMIN.password);
  await page.click('.login-form [type=submit]');

  await page.getByTestId('connect-deny').click();
  await page.waitForURL((u) => u.href.startsWith(CALLBACK));
  const back = new URL(page.url());
  expect(back.searchParams.get('error')).toBe('access_denied');
  expect(back.searchParams.get('state')).toBe('deny-state');
});
