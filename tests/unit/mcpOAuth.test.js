/**
 * The OAuth 2.1 protocol helpers for the MCP connector (server/mcp/oauth.js,
 * R5a 2026-09-24) — pure rules, no database. The flow end to end is
 * tests/integration/mcpOAuth.test.js.
 */
const crypto = require('crypto');
const oauth = require('../../server/mcp/oauth');

const s256 = (v) => crypto.createHash('sha256').update(v, 'ascii').digest('base64url');

describe('metadata', () => {
  const saved = process.env.APP_URL;
  afterEach(() => { process.env.APP_URL = saved; });

  test('the issuer is APP_URL without a trailing slash, and every endpoint hangs off it', () => {
    process.env.APP_URL = 'https://ops.example.is/';
    const as = oauth.authorizationServerMetadata();
    expect(as.issuer).toBe('https://ops.example.is');
    for (const k of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint']) {
      expect(as[k].startsWith('https://ops.example.is/oauth/')).toBe(true);
    }
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
    expect(as.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(as.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);

    const pr = oauth.protectedResourceMetadata();
    expect(pr.resource).toBe('https://ops.example.is/api/v1/mcp');
    expect(pr.authorization_servers).toEqual(['https://ops.example.is']);
    expect(oauth.protectedResourceMetadataUrl()).toBe('https://ops.example.is/.well-known/oauth-protected-resource');
  });

  test('a resource indicator must name this MCP server (or its origin); absent is fine', () => {
    process.env.APP_URL = 'https://ops.example.is';
    expect(oauth.resourceMatches(undefined)).toBe(true);
    expect(oauth.resourceMatches('')).toBe(true);
    expect(oauth.resourceMatches('https://ops.example.is/api/v1/mcp')).toBe(true);
    expect(oauth.resourceMatches('https://ops.example.is/api/v1/mcp/')).toBe(true);
    expect(oauth.resourceMatches('https://ops.example.is')).toBe(true);
    expect(oauth.resourceMatches('https://evil.example/api/v1/mcp')).toBe(false);
    expect(oauth.resourceMatches(['x'])).toBe(false);
  });
});

describe('redirect URIs', () => {
  const saved = process.env.MCP_OAUTH_REDIRECT_HOSTS;
  afterEach(() => { if (saved === undefined) delete process.env.MCP_OAUTH_REDIRECT_HOSTS; else process.env.MCP_OAUTH_REDIRECT_HOSTS = saved; });

  test('https only on an allowlisted host — no open redirect off this domain', () => {
    delete process.env.MCP_OAUTH_REDIRECT_HOSTS;
    expect(oauth.allowedRedirectHosts()).toEqual(['claude.ai', 'claude.com']);
    expect(oauth.redirectUriProblem('https://evil.example/cb')).toMatch(/claude\.ai/);
    expect(oauth.redirectUriProblem('https://claude.ai.evil.example/cb')).toMatch(/claude\.ai/);
    process.env.MCP_OAUTH_REDIRECT_HOSTS = 'chat.example.com, Claude.AI';
    expect(oauth.redirectUriProblem('https://chat.example.com/cb')).toBeNull();
    expect(oauth.redirectUriProblem('https://claude.ai/cb')).toBeNull();
    expect(oauth.redirectUriProblem('https://claude.com/cb')).toMatch(/chat\.example\.com/);
  });

  test.each([
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
    'http://localhost:33418/callback',
    'http://127.0.0.1:6274/oauth/callback',
    'http://[::1]:8080/cb',
  ])('accepts %s', (u) => expect(oauth.redirectUriProblem(u)).toBeNull());

  test.each([
    ['http://claude.ai/callback', /https/],
    ['javascript:alert(1)', /https/],
    ['myapp://callback', /https/],
    ['https://claude.ai/cb#frag', /fragment/],
    ['https://user:pw@claude.ai/cb', /credentials/],
    ['not a url', /valid URL/],
    ['', /at most 500/],
    [42, /at most 500/],
  ])('refuses %s', (u, why) => expect(oauth.redirectUriProblem(u)).toMatch(why));
});

describe('PKCE S256', () => {
  const verifier = crypto.randomBytes(32).toString('base64url'); // 43 chars

  test('the right verifier matches, a wrong one does not', () => {
    const challenge = s256(verifier);
    expect(oauth.challengeLooksValid(challenge)).toBe(true);
    expect(oauth.pkceMatches(verifier, challenge)).toBe(true);
    expect(oauth.pkceMatches(verifier + 'x', challenge)).toBe(false);
  });

  test('plain PKCE (verifier === challenge) never matches', () => {
    expect(oauth.pkceMatches(verifier, verifier)).toBe(false);
  });

  test('a malformed verifier or challenge is refused before hashing', () => {
    expect(oauth.pkceMatches('short', s256('short'))).toBe(false);
    expect(oauth.pkceMatches('x'.repeat(129), s256('x'.repeat(129)))).toBe(false);
    expect(oauth.pkceMatches(verifier + ' ', s256(verifier + ' '))).toBe(false);
    expect(oauth.pkceMatches(undefined, s256(verifier))).toBe(false);
    expect(oauth.challengeLooksValid('abc')).toBe(false);
    expect(oauth.challengeLooksValid(undefined)).toBe(false);
  });
});

describe('scopes', () => {
  test('read always; write only when asked; unknown scopes dropped', () => {
    expect(oauth.parseScopes(undefined)).toEqual(['read']);
    expect(oauth.parseScopes('')).toEqual(['read']);
    expect(oauth.parseScopes('write')).toEqual(['read', 'write']);
    expect(oauth.parseScopes('read  write')).toEqual(['read', 'write']);
    expect(oauth.parseScopes('admin openid')).toEqual(['read']);
  });
});

describe('redirects and errors', () => {
  test('parameters are appended, existing ones kept, empty ones left out', () => {
    const u = new URL(oauth.redirectWith('https://claude.ai/cb?x=1', { code: 'abc', state: 'st', iss: 'https://a.is', error: '' }));
    expect(u.searchParams.get('x')).toBe('1');
    expect(u.searchParams.get('code')).toBe('abc');
    expect(u.searchParams.get('state')).toBe('st');
    expect(u.searchParams.has('error')).toBe(false);
  });

  test('the RFC 6749 error shape', () => {
    expect(oauth.oauthError('invalid_grant')).toEqual({ error: 'invalid_grant' });
    expect(oauth.oauthError('invalid_grant', 'why')).toEqual({ error: 'invalid_grant', error_description: 'why' });
  });
});
