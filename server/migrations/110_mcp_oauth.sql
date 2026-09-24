-- 110_mcp_oauth — reference copy; the authoritative entry is in
-- server/config/schema.js.
--
-- OAuth 2.1 for the MCP connector (R5a, 2026-09-24): dynamically registered
-- public clients and single-use authorization requests/codes. The tokens stay
-- in mcp_tokens (088: kind 'access'/'refresh', oauth_client_id, parent_id).

CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id      TEXT PRIMARY KEY,
  client_name    VARCHAR(200) NOT NULL,
  redirect_uris  TEXT[] NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  id              SERIAL PRIMARY KEY,
  request_id      TEXT NOT NULL UNIQUE,
  client_id       TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri    TEXT NOT NULL,
  code_challenge  TEXT NOT NULL,
  scopes          TEXT[] NOT NULL DEFAULT '{read}',
  state           TEXT,
  resource        TEXT,
  status          VARCHAR(10) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'denied')),
  user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
  code_hash       VARCHAR(64) UNIQUE,
  token_id        INTEGER REFERENCES mcp_tokens(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_codes_client ON mcp_oauth_codes(client_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_oauth_client ON mcp_tokens(oauth_client_id) WHERE oauth_client_id IS NOT NULL;
