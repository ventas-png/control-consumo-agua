-- ════════════════════════════════════════════════════════════════════════════
-- Editar en Mantenimiento, Incidentes, Asambleas, Checklist de áreas y Permisos
-- de obra exige la acción «Editar» del tab, también en la base.
--
-- POR QUÉ
-- En la pantalla, toda modificación de esos cinco tabs (editar, cambiar de
-- estado, marcar ítems, redactar el acta, rechazar) va detrás de `canEdit`
-- (condominios.tab.<tab>.edit, con el fallback legado platform.condominios.view
-- + .edit). La policy de UPDATE que instala `rbac_install_company_policies`
-- sólo pedía la VISIBILIDAD del tab (`condominios.tab.<tab>`): quien sólo
-- podía consultar no veía ningún botón, pero podía modificar cualquier fila de
-- su empresa llamando a la API directamente.
--
-- QUÉ HACE
--   1 · Las policies de UPDATE de incidentes_seguridad, asambleas,
--       checklist_areas y permisos_obra_unidad pasan a
--       `condominios_puede_actuar('<tab>', 'edit')` dentro de la empresa, en
--       USING (qué filas se tocan) y en WITH CHECK (cómo quedan: no se mudan a
--       otra empresa). company_owner/admin siguen pudiendo (exentos en
--       user_has_permission); super_admin conserva el acceso entre empresas.
--   2 · `tickets_mantenimiento` tiene DOS pantallas que lo editan: el tab
--       Mantenimiento (canEdit('mantenimiento'), también al cambiar el estado
--       desde la conversación) y el Kanban (canEdit('kanban_tickets')). Y su
--       UPDATE es además la vía de la baja lógica, que desde 20261103000200
--       exige «Eliminar» y NO «Editar» —en la pantalla quien sólo puede
--       eliminar ve el 🗑—. Por eso aquí no se toca la policy permisiva sino
--       que se suma otra RESTRICTIVA: que un ticket quede VIVO tras un UPDATE
--       (deleted_at NULL en la fila nueva) exige editar en Mantenimiento o en
--       el Kanban. Dar de baja (deleted_at puesto) lo sigue gobernando sólo
--       tickets_mantenimiento_baja_exige_eliminar; restaurar exige las dos.
--   3 · Guarda de postcondición.
--
-- IMPACTO
-- Ningún dato cambia. Quien hoy edita en la pantalla tiene la acción «Editar»
-- (o el par legado) y sigue editando; quien sólo tenía visibilidad deja de poder
-- modificar por la API. Las RPC SECURITY DEFINER y el service_role no pasan por
-- RLS y no cambian. Si un día se agrega una policy de UPDATE para residentes
-- en tickets, la restrictiva de la sección 2 también la limita: habrá que
-- contemplarla ahí.
--
-- REVERSIÓN
-- Volver a crear las cuatro policies de UPDATE con
--   USING / WITH CHECK (is_super_admin() OR (company_id = get_my_company_id()
--          AND user_has_permission('condominios.tab.<tab>')))
-- y `DROP POLICY tickets_mantenimiento_vivo_exige_editar ON public.tickets_mantenimiento;`.
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS antes de cada CREATE.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · UPDATE: la acción «Editar» del tab, dentro de la empresa ─────────────
DROP POLICY IF EXISTS incidentes_seguridad_update ON public.incidentes_seguridad;
CREATE POLICY incidentes_seguridad_update ON public.incidentes_seguridad
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('incidentes', 'edit')))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('incidentes', 'edit')))
  );

DROP POLICY IF EXISTS asambleas_update ON public.asambleas;
CREATE POLICY asambleas_update ON public.asambleas
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('asambleas', 'edit')))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('asambleas', 'edit')))
  );

DROP POLICY IF EXISTS checklist_areas_update ON public.checklist_areas;
CREATE POLICY checklist_areas_update ON public.checklist_areas
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('checklist_areas', 'edit')))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('checklist_areas', 'edit')))
  );

DROP POLICY IF EXISTS permisos_obra_unidad_update ON public.permisos_obra_unidad;
CREATE POLICY permisos_obra_unidad_update ON public.permisos_obra_unidad
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('permisos_obra', 'edit')))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('permisos_obra', 'edit')))
  );

-- ── 2 · Tickets: dejar un ticket VIVO exige editar (Mantenimiento o Kanban) ──
-- RESTRICTIVA, como la de la baja: no abre nada, sólo exige, y no la puentea
-- una permisiva que se agregue después. USING (true): qué filas se pueden
-- tocar ya lo deciden la permisiva (empresa + visibilidad) y la de la baja.
-- El nombre no termina en _update a propósito: `rbac_install_company_policies`
-- arrasa las que sí.
DROP POLICY IF EXISTS tickets_mantenimiento_vivo_exige_editar ON public.tickets_mantenimiento;
CREATE POLICY tickets_mantenimiento_vivo_exige_editar ON public.tickets_mantenimiento
  AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (
    deleted_at IS NOT NULL
    OR (SELECT public.condominios_puede_actuar('mantenimiento', 'edit'))
    OR (SELECT public.condominios_puede_actuar('kanban_tickets', 'edit'))
  );

-- ── 3 · Guarda de postcondición ──────────────────────────────────────────────
-- Una permisiva de UPDATE de más se uniría con OR y volvería opcional el
-- permiso. Se mira lo que QUEDA.
DO $$
DECLARE
  v_esperado constant jsonb := jsonb_build_object(
    'incidentes_seguridad', 'incidentes',
    'asambleas',            'asambleas',
    'checklist_areas',      'checklist_areas',
    'permisos_obra_unidad', 'permisos_obra'
  );
  v_tabla text;
  v_tab   text;
  v_n     int;
  v_qual  text;
  v_check text;
  v_regla text;
BEGIN
  FOR v_tabla, v_tab IN SELECT key, value FROM jsonb_each_text(v_esperado) LOOP
    SELECT count(*), max(qual), max(with_check) INTO v_n, v_qual, v_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = v_tabla
      AND cmd IN ('UPDATE', 'ALL') AND permissive = 'PERMISSIVE';
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'edición por permiso: % conserva % policies permisivas de UPDATE (se esperaba 1)', v_tabla, v_n;
    END IF;
    v_regla := format('condominios_puede_actuar(''%s''::text, ''edit''::text)', v_tab);
    IF position(v_regla IN v_qual) = 0 OR position(v_regla IN coalesce(v_check, '')) = 0
       OR v_qual LIKE '%user_has_permission(%' OR v_check LIKE '%user_has_permission(%' THEN
      RAISE EXCEPTION 'edición por permiso: la policy de UPDATE de % no exige condominios_puede_actuar(%, edit) en USING y WITH CHECK', v_tabla, v_tab;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_n
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'tickets_mantenimiento'
    AND policyname = 'tickets_mantenimiento_vivo_exige_editar'
    AND permissive = 'RESTRICTIVE' AND cmd = 'UPDATE'
    AND position('condominios_puede_actuar(''mantenimiento''::text, ''edit''::text)' IN with_check) > 0
    AND position('condominios_puede_actuar(''kanban_tickets''::text, ''edit''::text)' IN with_check) > 0;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'edición por permiso: falta la policy restrictiva de edición en tickets_mantenimiento';
  END IF;
END $$;
