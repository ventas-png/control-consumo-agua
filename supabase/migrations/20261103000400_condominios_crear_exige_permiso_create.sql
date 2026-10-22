-- ════════════════════════════════════════════════════════════════════════════
-- Crear en Mantenimiento, Incidentes, Asambleas, Checklist de áreas y Permisos
-- de obra exige la acción «Crear» del tab, también en la base.
--
-- POR QUÉ
-- En la pantalla, el alta de esos cinco tabs (+ Nuevo ticket, 🚨 Registrar,
-- Convocar, + Nuevo checklist, + Nuevo permiso) va detrás de `canCreate`
-- (condominios.tab.<tab>.create, con el fallback legado
-- platform.condominios.view + .create). La policy de INSERT sólo pedía la
-- VISIBILIDAD del tab (`condominios.tab.<tab>`): quien sólo podía consultar no
-- veía el botón, pero podía crear filas en su empresa llamando a la API.
--
-- QUÉ HACE
--   1 · Las policies de INSERT de incidentes_seguridad, asambleas,
--       checklist_areas y permisos_obra_unidad pasan a
--       `condominios_puede_actuar('<tab>', 'create')` dentro de la empresa.
--       company_owner/admin siguen pudiendo (exentos en user_has_permission);
--       super_admin conserva el acceso entre empresas.
--   2 · `tickets_mantenimiento_insert` tiene además la rama del RESIDENTE, que
--       reporta mantenimiento desde el portal para sus unidades
--       (20260822010000). Esa rama se copia LITERAL; sólo la del staff pasa de
--       visibilidad a `condominios_puede_actuar('mantenimiento', 'create')`.
--   3 · Guarda de postcondición.
--
-- IMPACTO
-- Ningún dato cambia. Quien hoy crea en la pantalla tiene la acción «Crear»
-- (o el par legado) y sigue creando; quien sólo tenía visibilidad deja de poder
-- crear por la API. El residente sigue reportando tickets de sus unidades. Las
-- RPC SECURITY DEFINER y el service_role no pasan por RLS y no cambian.
--
-- REVERSIÓN
-- Volver a crear las cinco policies de INSERT con la clave de visibilidad:
--   WITH CHECK (is_super_admin() OR (company_id = get_my_company_id()
--               AND user_has_permission('condominios.tab.<tab>')))
-- (en tickets, más `OR (unidad_id IN (SELECT public.mis_unidades_ids()))`).
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS antes de cada CREATE.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · INSERT: la acción «Crear» del tab, dentro de la empresa ──────────────
DROP POLICY IF EXISTS incidentes_seguridad_insert ON public.incidentes_seguridad;
CREATE POLICY incidentes_seguridad_insert ON public.incidentes_seguridad
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('incidentes', 'create')))
  );

DROP POLICY IF EXISTS asambleas_insert ON public.asambleas;
CREATE POLICY asambleas_insert ON public.asambleas
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('asambleas', 'create')))
  );

DROP POLICY IF EXISTS checklist_areas_insert ON public.checklist_areas;
CREATE POLICY checklist_areas_insert ON public.checklist_areas
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('checklist_areas', 'create')))
  );

DROP POLICY IF EXISTS permisos_obra_unidad_insert ON public.permisos_obra_unidad;
CREATE POLICY permisos_obra_unidad_insert ON public.permisos_obra_unidad
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('permisos_obra', 'create')))
  );

-- ── 2 · Tickets: el staff con «Crear»; el residente, como hasta hoy ──────────
DROP POLICY IF EXISTS tickets_mantenimiento_insert ON public.tickets_mantenimiento;
CREATE POLICY tickets_mantenimiento_insert ON public.tickets_mantenimiento
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('mantenimiento', 'create')))
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  );

-- ── 3 · Guarda de postcondición ──────────────────────────────────────────────
-- Una permisiva de INSERT de más se uniría con OR y volvería opcional el
-- permiso. Se mira lo que QUEDA.
DO $$
DECLARE
  v_esperado constant jsonb := jsonb_build_object(
    'incidentes_seguridad',  'incidentes',
    'asambleas',             'asambleas',
    'checklist_areas',       'checklist_areas',
    'permisos_obra_unidad',  'permisos_obra',
    'tickets_mantenimiento', 'mantenimiento'
  );
  v_tabla text;
  v_tab   text;
  v_n     int;
  v_check text;
BEGIN
  FOR v_tabla, v_tab IN SELECT key, value FROM jsonb_each_text(v_esperado) LOOP
    SELECT count(*), max(with_check) INTO v_n, v_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = v_tabla
      AND cmd IN ('INSERT', 'ALL') AND permissive = 'PERMISSIVE';
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'alta por permiso: % conserva % policies permisivas de INSERT (se esperaba 1)', v_tabla, v_n;
    END IF;
    IF position(format('condominios_puede_actuar(''%s''::text, ''create''::text)', v_tab) IN coalesce(v_check, '')) = 0
       OR v_check LIKE '%user_has_permission(%' THEN
      RAISE EXCEPTION 'alta por permiso: la policy de INSERT de % no exige condominios_puede_actuar(%, create): %', v_tabla, v_tab, v_check;
    END IF;
  END LOOP;

  SELECT with_check INTO v_check
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'tickets_mantenimiento' AND cmd = 'INSERT';
  IF position('mis_unidades_ids()' IN v_check) = 0 THEN
    RAISE EXCEPTION 'alta por permiso: tickets_mantenimiento_insert perdió la rama del residente';
  END IF;
END $$;
