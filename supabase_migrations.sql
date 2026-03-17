-- ============================================================
-- SUPABASE MIGRATIONS — run in SQL Editor before starting backend
-- Run sections in order: 0 → 1A → 1B → 1C → 1D → 1E → 1F → (1G last)
-- ============================================================

-- ── 0. Drop broken auth trigger (if any) ─────────────────────────────────────
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();


-- ── 1A. Companies (empresas) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre      TEXT NOT NULL,
  nit         TEXT,
  email       TEXT,
  telefono    TEXT,
  plan        TEXT NOT NULL DEFAULT 'basico' CHECK (plan IN ('basico', 'profesional', 'enterprise')),
  activa      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);


-- ── 1B. Projects (proyectos) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);


-- ── 1C. App users (updated role hierarchy) ───────────────────────────────────
-- Roles:
--   superadmin     → platform owner, manages companies
--   company_owner  → owns a company, manages all its projects
--   admin          → manages exactly one project (project_id required)
--   user           → project-level access (permission_type required)
--   cliente        → client portal access (cliente_id required)
CREATE TABLE IF NOT EXISTS app_users (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id      UUID REFERENCES companies(id) ON DELETE SET NULL,
  full_name       TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('superadmin', 'company_owner', 'admin', 'user', 'cliente')),
  -- only for role='user'
  permission_type TEXT CHECK (permission_type IN ('total', 'lectura', 'financiero', 'administrativo')),
  -- only for role='admin': their single assigned project
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  -- only for role='cliente': linked to clientes table
  cliente_id      UUID,   -- FK added after clientes table exists (see section 1E)
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_user_needs_permission  CHECK (role != 'user'    OR permission_type IS NOT NULL),
  CONSTRAINT chk_admin_needs_project    CHECK (role != 'admin'   OR project_id IS NOT NULL),
  CONSTRAINT chk_cliente_needs_id       CHECK (role != 'cliente' OR cliente_id IS NOT NULL)
);


-- ── 1D. Session storage ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_sessions (
  sid     VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess    JSON    NOT NULL,
  expire  TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS IDX_session_expire ON user_sessions (expire);
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;


-- ── 1E. Clientes (updated with project scope) ─────────────────────────────────
-- NOTE: add project_id to existing clientes table
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Now add the FK from app_users.cliente_id → clientes.id
ALTER TABLE app_users
  ADD CONSTRAINT IF NOT EXISTS fk_app_users_cliente
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL;


-- ── 1F. Registros (updated with project scope) ────────────────────────────────
ALTER TABLE registros ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;


-- ── 1G. User–project assignments (M2M for 'user' role) ────────────────────────
-- A 'user' can be assigned to multiple projects with a permission per project.
CREATE TABLE IF NOT EXISTS user_project_assignments (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  permission_type TEXT NOT NULL CHECK (permission_type IN ('total', 'lectura', 'financiero', 'administrativo')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, project_id)
);


-- ── 1H. Pagos (payments — client portal) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS pagos (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  registro_id     UUID REFERENCES registros(id) ON DELETE SET NULL,
  cliente_id      UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  monto           DECIMAL(10,2) NOT NULL,
  metodo          TEXT NOT NULL CHECK (metodo IN ('efectivo', 'transferencia', 'paypal', 'tarjeta', 'otro')),
  referencia      TEXT,
  boleta_url      TEXT,           -- uploaded receipt image (base64 or storage URL)
  paypal_order_id TEXT,
  estado          TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'verificado', 'rechazado')),
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);


-- ── 1I. Security logs ─────────────────────────────────────────────────────────
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


-- ── 1J. Password reset tokens + RPCs ─────────────────────────────────────────
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
    RETURN jsonb_build_object('success', true);
  END IF;
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO password_reset_tokens (user_id, token, email, ip_address, user_agent)
    VALUES (v_user_id, v_token, lower(email_input), ip_address, user_agent);
  RETURN jsonb_build_object('success', true, 'token', v_token);
END;
$$;

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


-- ── 1K. Performance indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_registros_cliente_id  ON registros (cliente_id);
CREATE INDEX IF NOT EXISTS idx_registros_fecha        ON registros (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_registros_estado       ON registros (estado);
CREATE INDEX IF NOT EXISTS idx_registros_project_id   ON registros (project_id);
CREATE INDEX IF NOT EXISTS idx_clientes_codigo        ON clientes  (codigo);
CREATE INDEX IF NOT EXISTS idx_clientes_project_id    ON clientes  (project_id);
CREATE INDEX IF NOT EXISTS idx_projects_company_id    ON projects  (company_id);
CREATE INDEX IF NOT EXISTS idx_upa_user_id            ON user_project_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_upa_project_id         ON user_project_assignments (project_id);
CREATE INDEX IF NOT EXISTS idx_pagos_cliente_id       ON pagos     (cliente_id);
CREATE INDEX IF NOT EXISTS idx_pagos_registro_id      ON pagos     (registro_id);


-- ── 1L. RLS deny-all policies (run LAST after confirming backend works) ────────
/*
ALTER TABLE clientes   ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_direct" ON clientes   FOR ALL USING (false);

ALTER TABLE registros  ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_direct" ON registros  FOR ALL USING (false);

ALTER TABLE companies  ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_direct" ON companies  FOR ALL USING (false);

ALTER TABLE projects   ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_direct" ON projects   FOR ALL USING (false);

ALTER TABLE app_users  ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_direct" ON app_users  FOR ALL USING (false);

ALTER TABLE pagos      ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_direct" ON pagos      FOR ALL USING (false);

ALTER TABLE user_project_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_direct" ON user_project_assignments FOR ALL USING (false);
*/
