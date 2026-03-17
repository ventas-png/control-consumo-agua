-- ============================================================
-- SUPABASE MIGRATIONS — run in SQL Editor before starting backend
-- Run sections in order: 1A → 1B → 1C → 1D → (1E last, once backend is confirmed working)
-- ============================================================

-- ── 0. app_users table + trigger cleanup ─────────────────────────────────────
-- Drop any broken trigger that auto-inserts into app_users on auth user creation.
-- The backend handles inserting into app_users explicitly after creating the auth user.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

CREATE TABLE IF NOT EXISTS app_users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'operador', 'visor')),
  created_at  TIMESTAMPTZ DEFAULT now()
);


-- ── 1A. Session storage table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_sessions (
  sid     VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess    JSON    NOT NULL,
  expire  TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS IDX_session_expire ON user_sessions (expire);
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
-- Service role bypasses RLS, so no policy needed for sessions.


-- ── 1B. Security logs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS security_logs (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID,
  event_type  TEXT NOT NULL,
  details     JSONB,
  ip_address  TEXT,
  user_agent  TEXT,
  timestamp   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE security_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_security_logs_ts ON security_logs (timestamp DESC);


-- ── 1C. Password reset tokens + RPCs ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '1 hour',
  used        BOOLEAN DEFAULT false,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens (token);

-- RPC: request_password_reset
-- Returns {success: true, token: '...'} or {success: true} if email not found
CREATE OR REPLACE FUNCTION request_password_reset(
  email_input  TEXT,
  ip_address   TEXT DEFAULT NULL,
  user_agent   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_token   TEXT;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = lower(email_input);
  IF v_user_id IS NULL THEN
    -- Return success to prevent email enumeration
    RETURN jsonb_build_object('success', true);
  END IF;
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO password_reset_tokens (user_id, token, email, ip_address, user_agent)
    VALUES (v_user_id, v_token, lower(email_input), ip_address, user_agent);
  RETURN jsonb_build_object('success', true, 'token', v_token);
END;
$$;

-- RPC: validate_reset_token
CREATE OR REPLACE FUNCTION validate_reset_token(token_input TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  r RECORD;
BEGIN
  SELECT * INTO r FROM password_reset_tokens
    WHERE token = token_input AND used = false AND expires_at > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false);
  END IF;
  RETURN jsonb_build_object('valid', true, 'email', r.email);
END;
$$;


-- ── 1D. Performance indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_registros_cliente_id ON registros (cliente_id);
CREATE INDEX IF NOT EXISTS idx_registros_fecha      ON registros (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_registros_estado     ON registros (estado);
CREATE INDEX IF NOT EXISTS idx_clientes_codigo      ON clientes  (codigo);


-- ── 1E. RLS deny-all policies ────────────────────────────────────────────────
-- ⚠️  RUN THIS LAST — only after the backend is confirmed working end-to-end.
-- The service_role key bypasses RLS, so the backend continues to work.
-- Direct browser access to Supabase REST API will be blocked.

/*
ALTER TABLE clientes   ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_direct" ON clientes   FOR ALL USING (false);

ALTER TABLE registros  ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_direct" ON registros  FOR ALL USING (false);

ALTER TABLE empresa    ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_direct" ON empresa    FOR ALL USING (false);

ALTER TABLE app_users  ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_direct" ON app_users  FOR ALL USING (false);
*/
