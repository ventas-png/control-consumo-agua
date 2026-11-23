-- Lo que 20261212000000_lecturas_rls_una_vez_por_consulta necesita además del
-- fixture de registrar_lectura (tenancy, padrón de agua, helpers de RLS):
--   · MFA: `companies.mfa_required`, `auth.jwt()` y `mfa_requirement_met()`
--     (copia de 20260717020000) con su policy restrictiva sobre `registros`
--   · el residente: `app_users.cliente_id` y `get_my_cliente_id()`
--   · `company_clientes` (las filas sin proyecto se acotan por el cliente)
--   · `registros_select` en la forma de PRODUCCIÓN anterior (20260815000000),
--     que es contra la que se compara: la migración no debe cambiar quién ve qué
--   · `bitacora_acciones` reducida, con su policy de lectura anterior
--   · `ht.visibles()`: lo que ve cada persona, para la foto de antes y después

-- ── MFA ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.companies ADD COLUMN mfa_required boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('aal', COALESCE(NULLIF(current_setting('app.aal', true), ''), 'aal1'))
$$;

-- COPIA LITERAL de 20260717020000_mfa_enforcement_rls.sql
CREATE OR REPLACE FUNCTION public.mfa_requirement_met()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM public.app_users u
      JOIN public.companies c ON c.id = u.company_id
      WHERE u.id = auth.uid()
        AND c.mfa_required = true
    )
    OR COALESCE(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

CREATE POLICY mfa_gate_aal2 ON public.registros AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.mfa_requirement_met()) WITH CHECK (public.mfa_requirement_met());

-- ── Residente y clientes de la empresa ──────────────────────────────────────
ALTER TABLE public.app_users ADD COLUMN cliente_id uuid REFERENCES public.clientes(id);
CREATE OR REPLACE FUNCTION public.get_my_cliente_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.cliente_id FROM public.app_users u WHERE u.id = auth.uid() LIMIT 1
$$;

CREATE TABLE public.company_clientes (
  company_id uuid NOT NULL REFERENCES public.companies(id),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id)
);

-- ── registros_select · COPIA LITERAL de 20260815000000 ──────────────────────
DROP POLICY IF EXISTS "registros_select" ON public.registros;
CREATE POLICY "registros_select" ON public.registros
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (
      (
        (SELECT public.user_has_permission('agua.tabla.view'))
        OR (SELECT public.user_has_permission('agua.lecturas.view'))
        OR (SELECT public.user_has_permission('agua.dashboard.view'))
        OR (SELECT public.user_has_permission('agua.cobros.view'))
        OR (SELECT public.user_has_permission('agua.mapa.view'))
      )
      AND (SELECT get_my_company_id()) IS NOT NULL
      AND (
        project_id IN (
          SELECT p.id FROM public.projects p
          WHERE p.company_id = (SELECT get_my_company_id())
        )
        OR (project_id IS NULL AND cliente_id IN (
          SELECT cc.cliente_id FROM public.company_clientes cc
          WHERE cc.company_id = (SELECT get_my_company_id())
        ))
      )
      AND public.can_access_project(project_id)
    )
    OR (current_user_role() = 'cliente' AND cliente_id = (SELECT get_my_cliente_id()))
    OR (current_user_role() = 'cliente' AND contador_id IN (
      SELECT c.id FROM public.contadores c
      JOIN public.unidades u ON u.id = c.unidad_id
      WHERE u.cliente_id = (SELECT get_my_cliente_id()) AND c.activo = true AND u.activo = true
    ))
  );

-- ── bitácora de acciones (forma de producción de su policy de lectura) ──────
CREATE TABLE public.bitacora_acciones (
  id         uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  project_id uuid,
  accion     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bitacora_acciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY bitacora_acciones_select ON public.bitacora_acciones
  FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.bitacora_acciones')));

-- ── Personas extra ──────────────────────────────────────────────────────────
-- Sol   · super admin, sin empresa
-- Vera  · de ACME, puede ver lecturas y la bitácora, SIN proyecto asignado
-- Pepa  · residente, Familia Pérez (Casa 1: M-1, M-3, M-4 y el inactivo M-0)
-- Lola  · residente, Familia López (Casa 2: M-2)
-- Curro (del fixture) pasa a tener un cliente en su perfil: es personal sin
-- permisos, y la rama del residente NO debe abrirle nada.
INSERT INTO auth.users (id) VALUES
  ('e0000000-0000-0000-0000-0000000000a0'), ('e0000000-0000-0000-0000-0000000000a5'),
  ('e0000000-0000-0000-0000-0000000000c1'), ('e0000000-0000-0000-0000-0000000000c2');
INSERT INTO public.app_users (id, company_id, role, cliente_id) VALUES
  ('e0000000-0000-0000-0000-0000000000a0', NULL, 'super_admin', NULL),
  ('e0000000-0000-0000-0000-0000000000a5', 'aaaaaaaa-0000-0000-0000-00000000000a', 'viewer', NULL),
  ('e0000000-0000-0000-0000-0000000000c1', NULL, 'cliente', 'c1000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-0000000000c2', NULL, 'cliente', 'c1000000-0000-0000-0000-000000000002');
UPDATE public.app_users SET cliente_id = 'c1000000-0000-0000-0000-000000000001'
 WHERE id = 'e0000000-0000-0000-0000-000000000004';
INSERT INTO public.test_permisos (user_id, permiso) VALUES
  ('e0000000-0000-0000-0000-0000000000a5', 'agua.cobros.view'),
  ('e0000000-0000-0000-0000-0000000000a5', 'condominios.tab.bitacora_acciones');

-- La empresa vecina exige MFA.
UPDATE public.companies SET mfa_required = true WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000b';

-- Los Pérez son clientes de ACME; los López, de la vecina.
INSERT INTO public.company_clientes (company_id, cliente_id) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000002');

-- ── Lecturas ────────────────────────────────────────────────────────────────
INSERT INTO public.registros (id, cliente_id, contador_id, project_id, fecha, lectura_actual, consumo) VALUES
  -- R1 · Condominio Uno, M-1, de los Pérez
  ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '2026-03-01 12:00-06', 110, 10),
  -- R2 · Condominio Dos, M-5
  ('a0000000-0000-0000-0000-000000000002', NULL, 'c0000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000002', '2026-03-01 12:00-06', 5, 5),
  -- R3 · de la empresa vecina, M-9
  ('a0000000-0000-0000-0000-000000000003', NULL, 'c0000000-0000-0000-0000-000000000009', '22222222-0000-0000-0000-000000000001', '2026-03-01 12:00-06', 7, 7),
  -- R4 · SIN proyecto, de los Pérez (clientes de ACME)
  ('a0000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000001', NULL, NULL, '2026-02-01 12:00-06', 1, 1),
  -- R5 · SIN proyecto, de los López (clientes de la vecina)
  ('a0000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000002', NULL, NULL, '2026-02-01 12:00-06', 2, 2),
  -- R6 · Condominio Uno, M-2 (Casa 2, de los López), sin cliente sellado
  ('a0000000-0000-0000-0000-000000000006', NULL, 'c0000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '2026-03-01 12:00-06', 3, 3),
  -- R7 · Condominio Uno, M-0 (Casa 1, contador DADO DE BAJA), sin cliente sellado
  ('a0000000-0000-0000-0000-000000000007', NULL, 'c0000000-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000001', '2026-01-01 12:00-06', 4, 4);

INSERT INTO public.bitacora_acciones (id, company_id, project_id, accion) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', 'de ACME'),
  ('b0000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-00000000000b', NULL, 'de la vecina');

-- ── La foto ─────────────────────────────────────────────────────────────────
-- Lo que ve una persona (con su nivel de MFA) en una tabla, COMO authenticated:
-- los últimos caracteres de cada id, ordenados. «-» si no ve nada.
CREATE SCHEMA ht;
CREATE FUNCTION ht.visibles(p_tabla text, p_uid uuid, p_aal text DEFAULT 'aal1') RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('app.uid', p_uid::text, true), set_config('app.aal', p_aal, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE format('SELECT COALESCE(string_agg(right(id::text, 1), '''' ORDER BY id), ''-'') FROM public.%I', p_tabla) INTO v;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('app.uid', '', true), set_config('app.aal', '', true);
  RETURN v;
END $$;

CREATE TABLE ht.personas (nombre text PRIMARY KEY, uid uuid NOT NULL, aal text NOT NULL);
INSERT INTO ht.personas VALUES
  ('Ada',        'e0000000-0000-0000-0000-00000000000d', 'aal1'),
  ('Lucía',      'e0000000-0000-0000-0000-000000000001', 'aal1'),
  ('Beto',       'e0000000-0000-0000-0000-000000000002', 'aal1'),
  ('Nadia aal1', 'e0000000-0000-0000-0000-000000000003', 'aal1'),
  ('Nadia aal2', 'e0000000-0000-0000-0000-000000000003', 'aal2'),
  ('Curro',      'e0000000-0000-0000-0000-000000000004', 'aal1'),
  ('Sol',        'e0000000-0000-0000-0000-0000000000a0', 'aal1'),
  ('Vera',       'e0000000-0000-0000-0000-0000000000a5', 'aal1'),
  ('Pepa',       'e0000000-0000-0000-0000-0000000000c1', 'aal1'),
  ('Lola',       'e0000000-0000-0000-0000-0000000000c2', 'aal1');

-- ANTES de la migración: se toma al final de este fixture, con las policies
-- anteriores todavía puestas.
CREATE TABLE ht.antes AS
  SELECT p.nombre,
         ht.visibles('registros', p.uid, p.aal)         AS registros,
         ht.visibles('bitacora_acciones', p.uid, p.aal) AS bitacora
    FROM ht.personas p;
