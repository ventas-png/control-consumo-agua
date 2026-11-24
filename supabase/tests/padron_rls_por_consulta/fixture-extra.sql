-- Lo que 20261213000000_padron_rls_una_vez_por_consulta necesita además del
-- fixture de registrar_lectura (tenancy, padrón de agua):
--   · los helpers de RLS en su forma de PRODUCCIÓN (copias literales): los
--     `has_*_access`, `user_has_project_access` (que también mira el proyecto
--     del perfil), `user_is_project_exempt`, `can_access_project`,
--     `sesion_de_api`, `get_my_cliente_id`, `mis_unidades_ids`
--   · `contadores_select` y `unidades_select` en la forma de producción
--     ANTERIOR, que es contra la que se compara
--   · personas que ejercen cada rama, incluidas las que distinguen la regla
--     vieja de una reescritura descuidada (ver «Personas»)
--   · `ht.visibles()` y la foto `ht.antes`

-- ── Columnas que el fixture base no trae ────────────────────────────────────
ALTER TABLE public.app_users ADD COLUMN project_id uuid REFERENCES public.projects(id);
ALTER TABLE public.app_users ADD COLUMN cliente_id uuid REFERENCES public.clientes(id);
ALTER TABLE public.unidades  ADD COLUMN company_id uuid REFERENCES public.companies(id);
UPDATE public.unidades u SET company_id = p.company_id FROM public.projects p WHERE p.id = u.project_id;
ALTER TABLE public.contadores ALTER COLUMN project_id DROP NOT NULL;

CREATE TABLE public.unidad_residentes (
  unidad_id  uuid NOT NULL REFERENCES public.unidades(id),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  activo     boolean NOT NULL DEFAULT true
);

-- ── Helpers · COPIAS LITERALES de producción ────────────────────────────────
CREATE OR REPLACE FUNCTION public.sesion_de_api()
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$
  SELECT COALESCE(current_setting('role', true), 'none') IN ('anon', 'authenticated')
      OR auth.uid() IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION public.get_my_cliente_id()
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT cliente_id FROM public.app_users WHERE id = auth.uid() LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.has_super_admin_access()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(current_user_role() = 'super_admin',
                  CASE WHEN public.sesion_de_api() THEN false END)
$function$;

CREATE OR REPLACE FUNCTION public.has_company_owner_company_access(p_company_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    current_user_role() = 'company_owner'
    AND get_my_company_id() = p_company_id
$function$;

CREATE OR REPLACE FUNCTION public.has_admin_project_access(p_project_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    current_user_role() = 'admin' AND (
      EXISTS (
        SELECT 1 FROM public.app_users
        WHERE id = auth.uid() AND project_id = p_project_id
      )
      OR EXISTS (
        SELECT 1 FROM public.app_users u
        JOIN public.user_project_assignments upa ON upa.user_id = u.id
        WHERE u.id = auth.uid() AND upa.project_id = p_project_id
      )
    )
$function$;

CREATE OR REPLACE FUNCTION public.has_operator_project_access(p_project_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    current_user_role() IN ('operator','operador') AND EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id = auth.uid() AND project_id = p_project_id
    )
$function$;

CREATE OR REPLACE FUNCTION public.has_viewer_project_access(p_project_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    current_user_role() IN ('viewer','visor') AND EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id = auth.uid() AND project_id = p_project_id
    )
$function$;

CREATE OR REPLACE FUNCTION public.user_has_project_access(p_project_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND project_id = p_project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id = auth.uid() AND project_id = p_project_id
    )
$function$;

CREATE OR REPLACE FUNCTION public.user_is_project_exempt()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT COALESCE(
    public.current_user_role() = ANY (ARRAY['super_admin', 'superadmin', 'company_owner'])
    OR (
      public.current_user_role() = 'admin'
      AND NOT EXISTS (
        SELECT 1 FROM public.user_project_assignments upa
        WHERE upa.user_id = (SELECT auth.uid())
      )
    ),
    CASE WHEN public.sesion_de_api() THEN false END)
$function$;

CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT COALESCE(
    p_project_id IS NULL
    OR public.user_is_project_exempt()
    OR public.user_has_project_access(p_project_id),
    CASE WHEN public.sesion_de_api() THEN false END)
$function$;

CREATE OR REPLACE FUNCTION public.mis_unidades_ids()
 RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT u.id FROM public.unidades u
  WHERE u.activo = true AND u.cliente_id = public.get_my_cliente_id()
  UNION
  SELECT ur.unidad_id FROM public.unidad_residentes ur
    JOIN public.unidades u2 ON u2.id = ur.unidad_id
  WHERE ur.activo = true AND u2.activo = true AND ur.cliente_id = public.get_my_cliente_id()
$function$;

-- ── Las policies de lectura ANTERIORES (texto de producción) ────────────────
ALTER TABLE public.contadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unidades   ENABLE ROW LEVEL SECURITY;

CREATE POLICY contadores_select ON public.contadores FOR SELECT TO authenticated
  USING (has_super_admin_access() OR ((has_company_owner_company_access(company_id) OR has_admin_project_access(project_id) OR has_operator_project_access(project_id) OR has_viewer_project_access(project_id) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT user_has_permission('agua.contadores.view'::text) AS user_has_permission))) AND can_access_project(project_id)) OR ((current_user_role() = 'cliente'::text) AND (activo = true) AND (EXISTS ( SELECT 1
   FROM unidades u
  WHERE ((u.id = contadores.unidad_id) AND (u.cliente_id = get_my_cliente_id()))))));

CREATE POLICY unidades_select ON public.unidades FOR SELECT TO authenticated
  USING (has_super_admin_access() OR ((has_company_owner_company_access(company_id) OR has_admin_project_access(project_id) OR has_operator_project_access(project_id) OR has_viewer_project_access(project_id) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT user_has_permission('platform.unidades.view'::text) AS user_has_permission))) AND can_access_project(project_id)) OR ((current_user_role() = 'cliente'::text) AND (id IN ( SELECT mis_unidades_ids() AS mis_unidades_ids))));

-- ── Personas ────────────────────────────────────────────────────────────────
-- Del fixture: Ada (dueña de ACME) · Lucía y Beto (viewer, asignados a Uno) ·
--   Nadia (dueña de la vecina) · Curro (viewer de ACME, sin nada).
-- Nuevas:
--   Sol   · super admin
--   Abel  · admin de ACME sin asignaciones (exento: ve toda su empresa)
--   Alma  · admin de ACME con proyecto SÓLO en su perfil (Dos): sigue exenta
--   Aldo  · admin de ACME asignado a Uno (ya no exento: sólo Uno)
--   Olga  · operadora de ACME asignada a Dos
--   Otto  · operador de ACME con Dos SÓLO en su perfil: `has_operator_…` exige
--           la asignación, así que NO ve nada aunque el proyecto esté a su alcance
--   Omar  · operador con Uno sólo en su perfil, permiso de ver UNIDADES (no
--           contadores) y un cliente en su perfil: ve las unidades de Uno y
--           ningún contador —la rama del residente no es para él—
--   Vera  · viewer de ACME con los dos permisos y SIN proyecto: sólo lo que no
--           tiene proyecto
--   Vico  · viewer de ACME asignado al proyecto de la VECINA: la regla vigente
--           le deja verlo (no mira la empresa del proyecto)
--   Pepa  · residente, Familia Pérez (Casa 1)
--   Lola  · residente, Familia López (Casa 2) e inquilina de la Casa 1
-- Curro pasa a tener un cliente en su perfil (los Pérez): sigue sin ver nada.
INSERT INTO auth.users (id)
SELECT ('e0000000-0000-0000-0000-0000000000' || s)::uuid
  FROM unnest(ARRAY['a0','a1','a2','a3','b1','b2','b3','a5','a6','c1','c2']) s;

INSERT INTO public.app_users (id, company_id, role, project_id, cliente_id) VALUES
  ('e0000000-0000-0000-0000-0000000000a0', NULL, 'super_admin', NULL, NULL),
  ('e0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'admin',    NULL, NULL),
  ('e0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-00000000000a', 'admin',    '11111111-0000-0000-0000-000000000002', NULL),
  ('e0000000-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-00000000000a', 'admin',    NULL, NULL),
  ('e0000000-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'operator', NULL, NULL),
  ('e0000000-0000-0000-0000-0000000000b2', 'aaaaaaaa-0000-0000-0000-00000000000a', 'operador', '11111111-0000-0000-0000-000000000002', NULL),
  ('e0000000-0000-0000-0000-0000000000b3', 'aaaaaaaa-0000-0000-0000-00000000000a', 'operator', '11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-0000000000a5', 'aaaaaaaa-0000-0000-0000-00000000000a', 'viewer',   NULL, NULL),
  ('e0000000-0000-0000-0000-0000000000a6', 'aaaaaaaa-0000-0000-0000-00000000000a', 'visor',    NULL, NULL),
  ('e0000000-0000-0000-0000-0000000000c1', NULL, 'cliente', NULL, 'c1000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-0000000000c2', NULL, 'cliente', NULL, 'c1000000-0000-0000-0000-000000000002');
UPDATE public.app_users SET cliente_id = 'c1000000-0000-0000-0000-000000000001'
 WHERE id = 'e0000000-0000-0000-0000-000000000004';

INSERT INTO public.user_project_assignments (user_id, project_id) VALUES
  ('e0000000-0000-0000-0000-0000000000a3', '11111111-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-0000000000b1', '11111111-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-0000000000a6', '22222222-0000-0000-0000-000000000001');

INSERT INTO public.test_permisos (user_id, permiso) VALUES
  ('e0000000-0000-0000-0000-0000000000b3', 'platform.unidades.view'),
  ('e0000000-0000-0000-0000-0000000000a5', 'agua.contadores.view'),
  ('e0000000-0000-0000-0000-0000000000a5', 'platform.unidades.view');

-- ── Padrón extra ────────────────────────────────────────────────────────────
-- Unidades: «Casa 1» y «Casa 2» (Uno), «Casa ajena» (de la vecina) ya existen.
INSERT INTO public.unidades (id, project_id, company_id, cliente_id, nombre) VALUES
  ('d1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a', NULL, 'Casa Dos'),
  ('d1000000-0000-0000-0000-000000000004', NULL, 'aaaaaaaa-0000-0000-0000-00000000000a', NULL, 'Sin proyecto'),
  -- de ACME según su empresa, pero en el proyecto de la vecina
  ('d1000000-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', NULL, 'Cruzada');
INSERT INTO public.unidad_residentes (unidad_id, cliente_id) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002');

-- Contadores: M-1…M-4 y M-0 (de baja) en Uno, M-5 en Dos, M-9 de la vecina.
INSERT INTO public.contadores (id, project_id, company_id, unidad_id, numero_serie) VALUES
  ('c0000000-0000-0000-0000-00000000000a', NULL, 'aaaaaaaa-0000-0000-0000-00000000000a', NULL, 'M-N'),
  ('c0000000-0000-0000-0000-00000000000b', '22222222-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', NULL, 'M-X');

-- ── La foto ─────────────────────────────────────────────────────────────────
-- Lo que ve una persona en una tabla, COMO authenticated: la etiqueta de cada
-- fila (número de serie / nombre), ordenada. «-» si no ve nada.
CREATE SCHEMA ht;
CREATE FUNCTION ht.visibles(p_tabla text, p_uid uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text; v_col text := CASE p_tabla WHEN 'contadores' THEN 'numero_serie' ELSE 'nombre' END;
BEGIN
  PERFORM set_config('app.uid', p_uid::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE format('SELECT COALESCE(string_agg(%I, '', '' ORDER BY %I COLLATE "C"), ''-'') FROM public.%I', v_col, v_col, p_tabla) INTO v;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('app.uid', '', true);
  RETURN v;
END $$;

CREATE TABLE ht.personas (nombre text PRIMARY KEY, uid uuid NOT NULL);
INSERT INTO ht.personas VALUES
  ('Ada',   'e0000000-0000-0000-0000-00000000000d'),
  ('Lucía', 'e0000000-0000-0000-0000-000000000001'),
  ('Beto',  'e0000000-0000-0000-0000-000000000002'),
  ('Nadia', 'e0000000-0000-0000-0000-000000000003'),
  ('Curro', 'e0000000-0000-0000-0000-000000000004'),
  ('Sol',   'e0000000-0000-0000-0000-0000000000a0'),
  ('Abel',  'e0000000-0000-0000-0000-0000000000a1'),
  ('Alma',  'e0000000-0000-0000-0000-0000000000a2'),
  ('Aldo',  'e0000000-0000-0000-0000-0000000000a3'),
  ('Olga',  'e0000000-0000-0000-0000-0000000000b1'),
  ('Otto',  'e0000000-0000-0000-0000-0000000000b2'),
  ('Omar',  'e0000000-0000-0000-0000-0000000000b3'),
  ('Vera',  'e0000000-0000-0000-0000-0000000000a5'),
  ('Vico',  'e0000000-0000-0000-0000-0000000000a6'),
  ('Pepa',  'e0000000-0000-0000-0000-0000000000c1'),
  ('Lola',  'e0000000-0000-0000-0000-0000000000c2');

-- ANTES de la migración, con las policies anteriores todavía puestas.
CREATE TABLE ht.antes AS
  SELECT p.nombre,
         ht.visibles('contadores', p.uid) AS contadores,
         ht.visibles('unidades', p.uid)   AS unidades
    FROM ht.personas p;
