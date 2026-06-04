-- ============================================================================
-- user_invitations — T3/plat:P3: onboarding por invitación
-- ============================================================================
-- Un admin/owner de un tenant invita a un usuario por correo. La invitación
-- lleva un rol preasignado y un token aleatorio con expiración. El invitado
-- abre /aceptar-invitacion?token=..., fija su contraseña, y la edge function
-- accept-invitation crea su auth user + app_users vinculado al company_id con
-- el rol preasignado, marcando la invitación como 'accepted'.
--
-- Modelo de rol:
--   - `role` es text (NOT enum) para reflejar `app_users.role`, que es la fuente
--     de verdad usada por create-user / signup-company. El rol RBAC de
--     `user_roles` se deriva del `role` vía el mismo PLATFORM_ROLE_ID map que
--     create-user (no se guarda role_id aquí — se mantiene una sola fuente).
--
-- Seguridad:
--   - RLS: admin/company_owner del tenant gestionan SOLO las invitaciones de su
--     propia company; super_admin ve/gestiona todo.
--   - El flujo de aceptación NO usa RLS de anon: accept-invitation valida el
--     token server-side con service_role (sessionless). No se otorga ningún
--     acceso a `anon` sobre esta tabla — el token nunca se consulta vía PostgREST
--     público.
--   - `token` es único; se genera en la edge function con crypto seguro.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_invitations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email       text        NOT NULL,
  -- Rol preasignado. Espejo de app_users.role (text). Restringido a los roles
  -- no privilegiados que un admin/owner puede otorgar — nunca super_admin ni
  -- company_owner por esta vía.
  role        text        NOT NULL DEFAULT 'viewer',
  -- Token aleatorio seguro (generado en invite-user). Único para lookup O(1).
  token       text        NOT NULL,
  invited_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  status      text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  -- El auth user creado al aceptar (NULL hasta entonces).
  accepted_user_id uuid   REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_invitations_role_chk
    CHECK (role IN ('admin', 'operator', 'operador', 'viewer', 'visor', 'collector')),
  CONSTRAINT user_invitations_email_chk
    CHECK (position('@' in email) > 1)
);

-- Lookup por token (aceptación): único + índice implícito.
CREATE UNIQUE INDEX IF NOT EXISTS user_invitations_token_key
  ON public.user_invitations(token);

-- Listados del tenant: "mis invitaciones por estado".
CREATE INDEX IF NOT EXISTS idx_user_invitations_company_status
  ON public.user_invitations(company_id, status);

-- Evita dos invitaciones PENDING al mismo correo en la misma company (re-invitar
-- es revocar la previa o reusar la fila). Parcial: solo aplica a pending.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_invitations_pending_email
  ON public.user_invitations(company_id, lower(email))
  WHERE status = 'pending';

-- updated_at automático.
CREATE OR REPLACE FUNCTION public.set_user_invitations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_invitations_updated_at ON public.user_invitations;
CREATE TRIGGER trg_user_invitations_updated_at
  BEFORE UPDATE ON public.user_invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_user_invitations_updated_at();

ALTER TABLE public.user_invitations ENABLE ROW LEVEL SECURITY;

-- SELECT: admin/owner ven las invitaciones de su company; super_admin ve todo.
DROP POLICY IF EXISTS "user_invitations_select" ON public.user_invitations;
CREATE POLICY "user_invitations_select" ON public.user_invitations
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() IN ('company_owner', 'admin')
    )
  );

-- INSERT: admin/owner crean invitaciones para SU company. (La edge function
-- usa service_role y valida el rol del llamador; esta policy cubre además el
-- camino directo desde el cliente autenticado si llegara a usarse.)
DROP POLICY IF EXISTS "user_invitations_insert" ON public.user_invitations;
CREATE POLICY "user_invitations_insert" ON public.user_invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() IN ('company_owner', 'admin')
    )
  );

-- UPDATE: admin/owner gestionan (revocar / re-emitir) las de su company.
DROP POLICY IF EXISTS "user_invitations_update" ON public.user_invitations;
CREATE POLICY "user_invitations_update" ON public.user_invitations
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() IN ('company_owner', 'admin')
    )
  )
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() IN ('company_owner', 'admin')
    )
  );

-- DELETE: admin/owner borran las de su company (cleanup de revocadas/expiradas).
DROP POLICY IF EXISTS "user_invitations_delete" ON public.user_invitations;
CREATE POLICY "user_invitations_delete" ON public.user_invitations
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() IN ('company_owner', 'admin')
    )
  );

-- Nota: NO se otorga ningún GRANT a `anon`. El token jamás se resuelve vía
-- PostgREST público — accept-invitation lo valida con service_role.

COMMENT ON TABLE public.user_invitations IS
  'Invitaciones de usuario por correo con rol preasignado (T3/plat:P3). Token validado server-side por accept-invitation; gestión per-tenant por admin/owner vía RLS.';
COMMENT ON COLUMN public.user_invitations.role IS
  'Rol preasignado (espejo de app_users.role). El rol RBAC se deriva en accept-invitation igual que en create-user.';
COMMENT ON COLUMN public.user_invitations.token IS
  'Token aleatorio seguro generado en invite-user. Único. No expuesto a anon.';
