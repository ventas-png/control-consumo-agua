-- ─── RBAC Schema ─────────────────────────────────────────────────────────────
-- Normalized role-based access control: permissions catalog, roles (system +
-- per-company custom), role->permissions, user->roles, audit log.

-- Permission catalog (system-wide; seeded by migrations only)
CREATE TABLE IF NOT EXISTS public.permissions (
  key         text PRIMARY KEY,
  category    text NOT NULL,
  label       text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Roles: system roles (company_id NULL, is_system=true) and per-company custom roles
CREATE TABLE IF NOT EXISTS public.roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,
  color       text DEFAULT '#64748b',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.roles ADD CONSTRAINT roles_company_or_system_chk CHECK (
    (is_system = true AND company_id IS NULL)
    OR (is_system = false AND company_id IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.roles ADD CONSTRAINT roles_name_per_scope_uniq UNIQUE (company_id, name);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_roles_company ON public.roles(company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roles_system  ON public.roles(is_system) WHERE is_system = true;

-- Role -> permissions (allow or explicit deny)
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id        uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  effect         text NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow', 'deny')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_role_perms_perm ON public.role_permissions(permission_key);

-- User -> roles assignments
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id     uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_expiry ON public.user_roles(expires_at)
  WHERE expires_at IS NOT NULL;

-- Permission audit log
CREATE TABLE IF NOT EXISTS public.permission_audit_log (
  id              bigserial PRIMARY KEY,
  actor_id        uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  target_user_id  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  target_role_id  uuid REFERENCES public.roles(id) ON DELETE SET NULL,
  action          text NOT NULL CHECK (action IN (
    'assign_role', 'remove_role',
    'create_role', 'update_role', 'delete_role',
    'grant_permission', 'revoke_permission'
  )),
  details         jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_target_user ON public.permission_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_target_role ON public.permission_audit_log(target_role_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor       ON public.permission_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_occurred    ON public.permission_audit_log(occurred_at DESC);

-- ─── RLS on RBAC tables ──────────────────────────────────────────────────────
ALTER TABLE public.permissions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_audit_log ENABLE ROW LEVEL SECURITY;

-- permissions: read-only for authenticated users
DROP POLICY IF EXISTS "permissions_select" ON public.permissions;
CREATE POLICY "permissions_select" ON public.permissions FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- roles: system roles + own-company roles visible; managed by company_owner/admin
DROP POLICY IF EXISTS "roles_select" ON public.roles;
CREATE POLICY "roles_select" ON public.roles FOR SELECT
  USING (
    is_super_admin()
    OR is_system = true
    OR company_id = get_my_company_id()
  );

DROP POLICY IF EXISTS "roles_insert" ON public.roles;
CREATE POLICY "roles_insert" ON public.roles FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR (
      is_system = false
      AND company_id = get_my_company_id()
      AND current_user_role() IN ('company_owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "roles_update" ON public.roles;
CREATE POLICY "roles_update" ON public.roles FOR UPDATE
  USING (
    is_super_admin()
    OR (
      is_system = false
      AND company_id = get_my_company_id()
      AND current_user_role() IN ('company_owner', 'admin')
    )
  )
  WITH CHECK (
    is_super_admin()
    OR (
      is_system = false
      AND company_id = get_my_company_id()
      AND current_user_role() IN ('company_owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "roles_delete" ON public.roles;
CREATE POLICY "roles_delete" ON public.roles FOR DELETE
  USING (
    is_super_admin()
    OR (
      is_system = false
      AND company_id = get_my_company_id()
      AND current_user_role() IN ('company_owner', 'admin')
    )
  );

-- role_permissions: visibility/edit follows the parent role
DROP POLICY IF EXISTS "role_permissions_select" ON public.role_permissions;
CREATE POLICY "role_permissions_select" ON public.role_permissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_permissions.role_id
        AND (is_super_admin() OR r.is_system = true OR r.company_id = get_my_company_id())
    )
  );

DROP POLICY IF EXISTS "role_permissions_insert" ON public.role_permissions;
CREATE POLICY "role_permissions_insert" ON public.role_permissions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_permissions.role_id
        AND (
          is_super_admin()
          OR (
            r.is_system = false
            AND r.company_id = get_my_company_id()
            AND current_user_role() IN ('company_owner', 'admin')
          )
        )
    )
  );

DROP POLICY IF EXISTS "role_permissions_delete" ON public.role_permissions;
CREATE POLICY "role_permissions_delete" ON public.role_permissions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_permissions.role_id
        AND (
          is_super_admin()
          OR (
            r.is_system = false
            AND r.company_id = get_my_company_id()
            AND current_user_role() IN ('company_owner', 'admin')
          )
        )
    )
  );

-- user_roles: users see own; company managers see/edit their company's users
DROP POLICY IF EXISTS "user_roles_select" ON public.user_roles;
CREATE POLICY "user_roles_select" ON public.user_roles FOR SELECT
  USING (
    is_super_admin()
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = user_roles.user_id
        AND u.company_id = get_my_company_id()
        AND current_user_role() IN ('company_owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "user_roles_insert" ON public.user_roles;
CREATE POLICY "user_roles_insert" ON public.user_roles FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR (
      -- target user must belong to caller's company
      EXISTS (
        SELECT 1 FROM public.app_users u
        WHERE u.id = user_roles.user_id
          AND u.company_id = get_my_company_id()
          AND current_user_role() IN ('company_owner', 'admin')
      )
      -- role must be a system role or belong to caller's company (prevents cross-company grants)
      AND EXISTS (
        SELECT 1 FROM public.roles r
        WHERE r.id = user_roles.role_id
          AND (r.is_system = true OR r.company_id = get_my_company_id())
      )
      -- assigned_by must be the caller themselves (prevents audit log spoofing)
      AND (user_roles.assigned_by IS NULL OR user_roles.assigned_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS "user_roles_delete" ON public.user_roles;
CREATE POLICY "user_roles_delete" ON public.user_roles FOR DELETE
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = user_roles.user_id
        AND u.company_id = get_my_company_id()
        AND current_user_role() IN ('company_owner', 'admin')
    )
  );

-- audit log: read by company managers + super_admin; writes only via SECURITY DEFINER triggers
DROP POLICY IF EXISTS "audit_log_select" ON public.permission_audit_log;
CREATE POLICY "audit_log_select" ON public.permission_audit_log FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = permission_audit_log.target_user_id
        AND u.company_id = get_my_company_id()
        AND current_user_role() IN ('company_owner', 'admin')
    )
  );
