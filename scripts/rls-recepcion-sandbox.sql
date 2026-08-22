-- ════════════════════════════════════════════════════════════════════════════
-- Sandbox de RLS para el motor único de recepción (20260829000600)
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ ES. Un banco de pruebas CONDUCTUAL de las policies de
-- `paquetes_recibidos`: monta el andamiaje mínimo (auth.uid, app_users, los
-- helpers de RBAC) en una base desechable, aplica LAS POLICIES REALES —el
-- runner las extrae del propio archivo de migración, no de una copia— y
-- comprueba, ejecutando DELETE/SELECT/UPDATE/INSERT como cada usuario, quién
-- puede qué.
--
-- POR QUÉ EXISTE. El harness de Supabase (src/test/rls) necesita GoTrue, anon
-- key y usuarios sembrados; sin esos secretos queda verde SIN CORRER, y una
-- policy que no se ejecuta nunca es una hipótesis. Esto sí se ejecuta: Postgres
-- de verdad, RLS de verdad, con las policies tal como se van a desplegar.
--
-- LO QUE NO ES. No cubre la RLS del resto del sistema ni el flujo de auth real;
-- el andamiaje reproduce los helpers, no los importa. Es la prueba de que
-- ESTAS policies hacen lo que dicen, no un reemplazo del harness completo.
--
-- Uso:  scripts/rls-recepcion-sandbox.sh   (levanta Postgres, extrae, corre)
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- ── Andamiaje: lo mínimo de lo que dependen las policies ────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

-- auth.uid() del sandbox: lee el "sub" del JWT como hace Supabase.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.app_users (
  id         uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  role       text NOT NULL,
  full_name  text
);

-- RBAC granular: roles de empresa con permisos explícitos.
CREATE TABLE public.user_roles (
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  expires_at timestamptz
);
CREATE TABLE public.role_permissions (
  role_id uuid NOT NULL,
  permission_key text NOT NULL,
  effect text NOT NULL DEFAULT 'allow'
);

CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.app_users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.app_users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT role FROM public.app_users WHERE id = auth.uid())
                  IN ('super_admin', 'superadmin'), false)
$$;

-- COPIA FIEL de 20260518000008, incluida la rama que hace redundante cualquier
-- gate de permiso puesto detrás de un filtro de rol: para company_owner/admin
-- este helper dice true SIEMPRE, sea cual sea la clave que se le pregunte.
CREATE OR REPLACE FUNCTION public.user_has_permission(perm_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT role FROM public.app_users WHERE id = auth.uid())
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN (SELECT role FROM me) IN ('super_admin','superadmin','company_owner','admin') THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = auth.uid() AND rp.permission_key = perm_key
        AND rp.effect = 'deny' AND (ur.expires_at IS NULL OR ur.expires_at > now())
    ) THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = auth.uid() AND rp.permission_key = perm_key
        AND rp.effect = 'allow' AND (ur.expires_at IS NULL OR ur.expires_at > now())
    )
  END
$$;

-- Unidades del residente (rama del portal en la policy de SELECT).
CREATE TABLE public.unidades (
  id uuid PRIMARY KEY, company_id uuid NOT NULL, project_id uuid NOT NULL,
  cliente_id uuid, activo boolean NOT NULL DEFAULT true
);
CREATE OR REPLACE FUNCTION public.mis_unidades_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id FROM public.unidades u
   WHERE u.activo AND u.cliente_id IS NOT NULL
     AND u.cliente_id = (SELECT id FROM public.app_users WHERE id = auth.uid())
$$;

-- La tabla del motor, con las columnas que tocan las policies.
CREATE TABLE public.paquetes_recibidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  unidad_id uuid,
  clase text NOT NULL DEFAULT 'paquete',
  destinatario_tipo text NOT NULL DEFAULT 'unidad',
  tipo text NOT NULL DEFAULT 'paquete',
  estado text NOT NULL DEFAULT 'pendiente',
  descripcion text NOT NULL,
  direccion text NOT NULL DEFAULT 'entrante'
);
ALTER TABLE public.paquetes_recibidos ENABLE ROW LEVEL SECURITY;

CREATE ROLE authenticated;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paquetes_recibidos TO authenticated;
GRANT SELECT ON public.app_users, public.unidades TO authenticated;

-- ── Utilidad de aserción ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assert_eq(actual bigint, esperado bigint, mensaje text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION 'FALLO: % (esperado %, obtenido %)', mensaje, esperado, actual;
  END IF;
  RAISE NOTICE '  ok  %', mensaje;
END $$;

CREATE OR REPLACE FUNCTION public.assert_true(cond boolean, mensaje text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FALLO: %', mensaje; END IF;
  RAISE NOTICE '  ok  %', mensaje;
END $$;

GRANT EXECUTE ON FUNCTION public.assert_eq(bigint, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_true(boolean, text) TO authenticated;

-- ── Datos: UNA empresa con cuatro personas + una empresa ajena ──────────────
-- Los cuatro comparten company_id A PROPÓSITO: si el aislamiento se cayera por
-- empresa en vez de por rol/clase, estas pruebas no lo notarían. La empresa
-- ajena está solo para el control de tenant.
\set emp   '''11111111-1111-1111-1111-111111111111'''
\set otra  '''22222222-2222-2222-2222-222222222222'''
\set proy  '''33333333-3333-3333-3333-333333333333'''

\set owner '''a0000000-0000-0000-0000-000000000001'''
\set admin '''a0000000-0000-0000-0000-000000000002'''
\set gpaq  '''a0000000-0000-0000-0000-000000000003'''
\set gcorr '''a0000000-0000-0000-0000-000000000004'''
\set super '''a0000000-0000-0000-0000-000000000005'''
\set ajeno '''a0000000-0000-0000-0000-000000000006'''

INSERT INTO public.app_users (id, company_id, role, full_name) VALUES
  (:owner, :emp,  'company_owner', 'Dueña'),
  (:admin, :emp,  'admin',         'Administrador'),
  (:gpaq,  :emp,  'operator',      'Guardia (solo paquetería)'),
  (:gcorr, :emp,  'operator',      'Recepción (solo correspondencia)'),
  (:super, :otra, 'super_admin',   'Soporte'),
  (:ajeno, :otra, 'admin',         'Admin de otra empresa');

\set rolpaq  '''b0000000-0000-0000-0000-000000000001'''
\set rolcorr '''b0000000-0000-0000-0000-000000000002'''
INSERT INTO public.user_roles (user_id, role_id) VALUES (:gpaq, :rolpaq), (:gcorr, :rolcorr);
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  (:rolpaq,  'condominios.tab.paqueteria',     'allow'),
  (:rolcorr, 'condominios.tab.correspondencia','allow');

\set pieza_paq  '''c0000000-0000-0000-0000-000000000001'''
\set pieza_corr '''c0000000-0000-0000-0000-000000000002'''
\set unidad     '''d0000000-0000-0000-0000-000000000001'''

INSERT INTO public.unidades (id, company_id, project_id, cliente_id) VALUES (:unidad, :emp, :proy, NULL);
INSERT INTO public.paquetes_recibidos (id, company_id, project_id, unidad_id, clase, destinatario_tipo, tipo, descripcion) VALUES
  (:pieza_paq,  :emp, :proy, :unidad, 'paquete',         'unidad',         'paquete', 'Caja Amazon'),
  (:pieza_corr, :emp, :proy, NULL,    'correspondencia', 'administracion', 'notificacion_legal', 'Citación municipal');
