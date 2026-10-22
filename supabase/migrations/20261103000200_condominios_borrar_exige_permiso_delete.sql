-- ════════════════════════════════════════════════════════════════════════════
-- Borrar en Mantenimiento, Incidentes, Asambleas, Checklist de áreas y Permisos
-- de obra exige la acción «Eliminar» del tab, también en la base.
--
-- POR QUÉ
-- La pantalla ya condiciona el botón Eliminar de esos cinco tabs a
-- `canDelete` (condominios.tab.<tab>.delete, con el fallback legado
-- platform.condominios.view + .delete). La base aplicaba otra regla, y en los
-- dos sentidos:
--
--   · MÁS ESTRICTA en las cuatro tablas de borrado físico. La policy de DELETE
--     que instala `rbac_install_company_policies` sólo deja borrar a
--     super_admin y a company_owner/admin de la empresa. Un rol granular al
--     que se le concedió «Eliminar» ve el botón, lo pulsa y la RLS borra cero
--     filas sin error: la pantalla lo da por hecho y la fila sigue ahí.
--
--   · MÁS LAXA en `tickets_mantenimiento`, que se borra de forma LÓGICA
--     (softDelete marca deleted_at/deleted_by con un UPDATE). La policy de
--     UPDATE sólo pide la VISIBILIDAD del tab (`condominios.tab.mantenimiento`),
--     así que quien sólo puede consultar tickets podía darlos de baja llamando
--     a la API directamente.
--
-- QUÉ HACE
--   1 · Las policies de DELETE de incidentes_seguridad, asambleas,
--       checklist_areas y permisos_obra_unidad pasan a
--       `condominios_puede_actuar('<tab>', 'delete')` dentro de la empresa
--       —la réplica exacta de `canActInCondominiosTab` (20260916221839)—.
--       company_owner/admin siguen pudiendo: user_has_permission los trata
--       como exentos. super_admin conserva el acceso entre empresas.
--   2 · `tickets_mantenimiento` gana una policy RESTRICTIVA de UPDATE: dejar
--       (WITH CHECK) o encontrar (USING) una fila con deleted_at puesto exige
--       la acción «Eliminar» del tab. Se suma con AND a la policy de UPDATE
--       existente, así que editar un ticket vivo no cambia; darlo de baja o
--       restaurarlo, sí. El DELETE físico de tickets no se toca: sigue siendo
--       sólo de company_owner/admin, porque la tabla se borra de forma lógica
--       a propósito (20260528000001).
--   3 · Guarda de postcondición: aborta si alguna tabla queda con una policy
--       de borrado distinta de la esperada (una permisiva de más se uniría con
--       OR y volvería opcional el permiso).
--
-- IMPACTO
-- Ningún dato cambia. Quien hoy tiene el permiso de borrar ya ve el botón;
-- desde esta migración el borrado además se aplica. Los roles creados antes de
-- la granularidad por tab (20260703000000) recibieron .delete derivado de
-- .edit, así que conservan exactamente lo que la pantalla ya les ofrecía.
--
-- REVERSIÓN
-- Volver a crear las cuatro policies de DELETE con la regla de rol
--   USING (is_super_admin() OR (current_user_role() = ANY (ARRAY['company_owner','admin'])
--          AND company_id = get_my_company_id()))
-- y `DROP POLICY tickets_mantenimiento_baja_exige_eliminar ON public.tickets_mantenimiento;`.
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS antes de cada CREATE.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · DELETE físico: la acción «Eliminar» del tab, dentro de la empresa ────
DROP POLICY IF EXISTS incidentes_seguridad_delete ON public.incidentes_seguridad;
CREATE POLICY incidentes_seguridad_delete ON public.incidentes_seguridad
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('incidentes', 'delete')))
  );

DROP POLICY IF EXISTS asambleas_delete ON public.asambleas;
CREATE POLICY asambleas_delete ON public.asambleas
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('asambleas', 'delete')))
  );

DROP POLICY IF EXISTS checklist_areas_delete ON public.checklist_areas;
CREATE POLICY checklist_areas_delete ON public.checklist_areas
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('checklist_areas', 'delete')))
  );

DROP POLICY IF EXISTS permisos_obra_unidad_delete ON public.permisos_obra_unidad;
CREATE POLICY permisos_obra_unidad_delete ON public.permisos_obra_unidad
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('permisos_obra', 'delete')))
  );

-- ── 2 · Baja lógica de tickets: la misma acción, vía UPDATE ──────────────────
-- RESTRICTIVA: no abre nada, sólo exige. USING mira la fila como está (una ya
-- dada de baja sólo la toca quien puede borrar: restaurarla deshace un
-- borrado); WITH CHECK mira cómo queda (marcar deleted_at es borrar). Con
-- deleted_at NULL en los dos lados —editar un ticket vivo— la condición es
-- verdadera y manda la policy de UPDATE de siempre. El nombre no termina en
-- _update a propósito: `rbac_install_company_policies` arrasa las que sí.
DROP POLICY IF EXISTS tickets_mantenimiento_baja_exige_eliminar ON public.tickets_mantenimiento;
CREATE POLICY tickets_mantenimiento_baja_exige_eliminar ON public.tickets_mantenimiento
  AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    OR (SELECT public.condominios_puede_actuar('mantenimiento', 'delete'))
  )
  WITH CHECK (
    deleted_at IS NULL
    OR (SELECT public.condominios_puede_actuar('mantenimiento', 'delete'))
  );

-- ── 3 · Guarda de postcondición ──────────────────────────────────────────────
-- Un DROP que no encuentra la policy no es error, y una permisiva de borrado
-- creada a mano se uniría con OR a la de arriba. Se mira lo que QUEDA.
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
BEGIN
  FOR v_tabla, v_tab IN SELECT key, value FROM jsonb_each_text(v_esperado) LOOP
    SELECT count(*), max(qual) INTO v_n, v_qual
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = v_tabla
      AND cmd IN ('DELETE', 'ALL') AND permissive = 'PERMISSIVE';
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'borrado por permiso: % conserva % policies permisivas de borrado (se esperaba 1)', v_tabla, v_n;
    END IF;
    IF position(format('condominios_puede_actuar(''%s''::text, ''delete''::text)', v_tab) IN v_qual) = 0
       OR v_qual LIKE '%current_user_role%' THEN
      RAISE EXCEPTION 'borrado por permiso: la policy de DELETE de % no exige condominios_puede_actuar(%, delete): %', v_tabla, v_tab, v_qual;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_n
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'tickets_mantenimiento'
    AND policyname = 'tickets_mantenimiento_baja_exige_eliminar'
    AND permissive = 'RESTRICTIVE' AND cmd = 'UPDATE'
    AND position('condominios_puede_actuar(''mantenimiento''::text, ''delete''::text)' IN qual) > 0
    AND position('condominios_puede_actuar(''mantenimiento''::text, ''delete''::text)' IN with_check) > 0;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'borrado por permiso: falta la policy restrictiva de baja lógica en tickets_mantenimiento';
  END IF;
END $$;
