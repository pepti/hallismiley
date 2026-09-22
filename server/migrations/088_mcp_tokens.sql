-- 088_mcp_tokens — reference copy of the migration in server/config/schema.js
-- MCP connector tokens (harvest 2026-08-22, from icelandicstore #188 — ice
-- numbers this 098; renumbered per chain). Implements ENHANCEMENTS #13.

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id              SERIAL PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  token_hash      VARCHAR(64) NOT NULL UNIQUE,
  token_prefix    VARCHAR(16) NOT NULL,
  kind            VARCHAR(10) NOT NULL DEFAULT 'manual'
                  CHECK (kind IN ('manual', 'access', 'refresh')),
  scopes          TEXT[] NOT NULL DEFAULT '{read}',
  oauth_client_id TEXT,
  parent_id       INTEGER REFERENCES mcp_tokens(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ NOT NULL,
  last_used_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens(user_id);
