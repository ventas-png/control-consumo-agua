-- ════════════════════════════════════════════════════════════════════════════
-- Borrar en cinco pestañas de condominios exige, en la base, el permiso de borrar
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ PASABA
-- La UI ya condiciona «Eliminar» a `canDelete` en Mantenimiento, Incidentes,
-- Asambleas, Checklist de áreas y Permisos de obra: `condominios.tab.<tab>.delete`,
-- o el par legado `platform.condominios.view` + `.delete`, siempre con la
-- visibilidad del tab (`canActInCondominiosTab`, src/lib/permissions.ts). La base
-- decía otra cosa, en las dos direcciones:
--
--   · tickets_mantenimiento (tab `mantenimiento`). La pestaña borra con
--     `softDelete()`, que es un UPDATE de `deleted_at`/`deleted_by`. La policy de
--     UPDATE que dejó el generador (`rbac_install_company_policies`,
--     20260518000010) sólo pide `condominios.tab.mantenimiento`, que es VER el
--     tab. Un rol de consulta podía marcar un ticket como borrado llamando a la
--     API sin pasar por el botón. Y también deshacer el borrado de otro.
--
--   · incidentes_seguridad, asambleas, checklist_areas, permisos_obra_unidad. Se
--     borran con DELETE físico, y la policy de DELETE del generador sólo deja a
--     super_admin o a company_owner/admin de la empresa. Un rol que NO es admin y
--     al que se le concedió `.delete` ve el botón, pero la RLS borra 0 filas sin
--     error y la pantalla refresca con la fila todavía ahí.
--
-- QUÉ HACE
--   1. Las cuatro policies de DELETE pasan a la regla de la UI:
--        is_super_admin()
--        OR (misma empresa AND condominios_puede_actuar('<tab>', 'delete'))
--      `condominios_puede_actuar` (20260916221839) es la réplica en la base de
--      `canActInCondominiosTab`: visibilidad del tab Y (acción por tab O par
--      legado). company_owner/admin siguen pudiendo porque `user_has_permission`
--      ya los trata como exentos, así que nadie que podía borrar deja de poder.
--   2. La policy de UPDATE de tickets_mantenimiento conserva su regla de siempre
--      (visibilidad del tab, misma empresa) y suma una: si la fila de ANTES
--      (USING) o la de DESPUÉS (WITH CHECK) tiene `deleted_at`, hace falta
--      `condominios_puede_actuar('mantenimiento', 'delete')`. Así:
--        · marcar `deleted_at` (el borrado lógico) exige `.delete`;
--        · tocar una fila ya borrada —incluido restaurarla desde la Papelera,
--          que pone `deleted_at = NULL`— también: deshacer un borrado es
--          decidir sobre el borrado;
--        · editar un ticket vivo sigue igual que antes.
--
-- POR QUÉ UNA POLICY Y NO UNA RPC PARA EL TICKET
-- Una RPC SECURITY DEFINER que mire `.delete` serviría de camino legítimo, pero
-- no cierra nada sola: la policy de UPDATE seguiría dejando a un rol de consulta
-- escribir `deleted_at` directo por la API. Para cerrar eso hay que tocar la
-- policy (o poner un trigger), y una vez tocada, la RPC ya no decide nada que la
-- policy no decida. Una sola regla, en un solo sitio. `softDelete()` y la
-- Papelera siguen funcionando tal cual.
--
-- LO QUE NO CAMBIA
--   · SELECT, INSERT, y el DELETE físico de tickets_mantenimiento: la pestaña no
--     hace DELETE físico de tickets, lo hace la purga programada como
--     `postgres`, que no pasa por RLS.
--   · El alcance sigue siendo por `company_id` y no por proyecto, igual que las
--     otras policies de estas tablas (ver la nota de 20260906000100).
--   · La UPDATE de las cuatro tablas de borrado físico (sigue pidiendo sólo
--     visibilidad del tab). Eso es el hueco general de «editar» en las tablas
--     del generador y no es de este cambio.
--
-- OJO CON EL GENERADOR
-- Re-ejecutar `rbac_install_company_policies` sobre estas cinco tablas volvería
-- a dejar las policies de antes: borra por regex los nombres `<tabla>_<op>`.
-- No hay que hacerlo (la nota de 20260906000100 lo explica); si alguna vez se
-- hace, la autoverificación del final de este archivo es la que hay que volver
-- a correr.
--
-- CÓMO SE COMPRUEBA
-- supabase/tests/borrar_por_permiso_condominios/run.sh aplica la cadena entera
-- de migraciones, mide los accesos ANTES (y exige ver los dos huecos), aplica
-- ésta dos veces, mide DESPUÉS, y corre mutantes de esta migración: sin cada
-- regla, las pruebas tienen que fallar.
--
-- IDEMPOTENTE: sí. DROP POLICY IF EXISTS antes de cada CREATE.
-- FAIL-CLOSED: la sección 3 aborta la migración si algo quedó a medias.
--
-- REVERSA (las policies de 20260518000010, tal como estaban):
--   DROP POLICY IF EXISTS "<tabla>_delete" ON public.<tabla>;   -- las cuatro
--   CREATE POLICY "<tabla>_delete" ON public.<tabla> FOR DELETE TO authenticated
--     USING (is_super_admin()
--            OR (current_user_role() = ANY (ARRAY['company_owner','admin'])
--                AND company_id = get_my_company_id()));
--   DROP POLICY IF EXISTS "tickets_mantenimiento_update" ON public.tickets_mantenimiento;
--   CREATE POLICY "tickets_mantenimiento_update" ON public.tickets_mantenimiento
--     FOR UPDATE TO authenticated
--     USING      (is_super_admin() OR (company_id = get_my_company_id()
--                 AND user_has_permission('condominios.tab.mantenimiento')))
--     WITH CHECK (is_super_admin() OR (company_id = get_my_company_id()
--                 AND user_has_permission('condominios.tab.mantenimiento')));
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · DELETE físico: misma regla que `canDelete` en la UI
-- ════════════════════════════════════════════════════════════════════════════
-- El id del tab NO siempre es el nombre de la tabla: incidentes_seguridad es el
-- tab `incidentes` y permisos_obra_unidad es `permisos_obra` (tabRegistry.tsx).

DROP POLICY IF EXISTS "incidentes_seguridad_delete" ON public.incidentes_seguridad;
CREATE POLICY "incidentes_seguridad_delete" ON public.incidentes_seguridad
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('incidentes', 'delete')))
  );

DROP POLICY IF EXISTS "asambleas_delete" ON public.asambleas;
CREATE POLICY "asambleas_delete" ON public.asambleas
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('asambleas', 'delete')))
  );

DROP POLICY IF EXISTS "checklist_areas_delete" ON public.checklist_areas;
CREATE POLICY "checklist_areas_delete" ON public.checklist_areas
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('checklist_areas', 'delete')))
  );

DROP POLICY IF EXISTS "permisos_obra_unidad_delete" ON public.permisos_obra_unidad;
CREATE POLICY "permisos_obra_unidad_delete" ON public.permisos_obra_unidad
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('permisos_obra', 'delete')))
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · Borrado lógico de tickets: `deleted_at` sólo lo mueve quien puede borrar
-- ════════════════════════════════════════════════════════════════════════════
-- USING mira la fila de antes y WITH CHECK la de después. Con la condición en
-- los dos lados:
--   vivo  → vivo     visibilidad, como siempre (editar, cambiar estado)
--   vivo  → borrado  WITH CHECK pide `.delete`          (eliminar)
--   borr. → vivo     USING pide `.delete`               (restaurar)
--   borr. → borrado  los dos piden `.delete`            (tocar lo borrado)
-- Un rol sin `.delete` que intente el borrado recibe el error 42501 de la RLS
-- («new row violates row-level security policy»), no un 0 silencioso.
DROP POLICY IF EXISTS "tickets_mantenimiento_update" ON public.tickets_mantenimiento;
CREATE POLICY "tickets_mantenimiento_update" ON public.tickets_mantenimiento
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.mantenimiento'))
        AND (deleted_at IS NULL
             OR (SELECT public.condominios_puede_actuar('mantenimiento', 'delete'))))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.mantenimiento'))
        AND (deleted_at IS NULL
             OR (SELECT public.condominios_puede_actuar('mantenimiento', 'delete'))))
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · Autoverificación (fail-closed)
-- ════════════════════════════════════════════════════════════════════════════
-- Si algo de lo de arriba quedó a medias, esta migración NO se da por aplicada.
DO $$
DECLARE
  v_t       record;
  v_n       int;
  v_nombres text;
  v_expr    text;
BEGIN
  -- 3.0 · El helper del que dependen las cinco policies existe.
  IF to_regprocedure('public.condominios_puede_actuar(text, text)') IS NULL THEN
    RAISE EXCEPTION 'falta public.condominios_puede_actuar(text, text) (20260916221839)';
  END IF;

  FOR v_t IN
    SELECT * FROM (VALUES
      ('public.incidentes_seguridad'::regclass, 'incidentes'),
      ('public.asambleas'::regclass,            'asambleas'),
      ('public.checklist_areas'::regclass,      'checklist_areas'),
      ('public.permisos_obra_unidad'::regclass, 'permisos_obra')
    ) AS t(tabla, tab)
  LOOP
    -- 3.1 · UNA sola policy permisiva autoriza DELETE. Dos se combinarían con
    --       OR y mandaría la más laxa.
    SELECT count(*), string_agg(polname, ', ') INTO v_n, v_nombres
    FROM pg_policy
    WHERE polrelid = v_t.tabla AND polcmd IN ('d', '*') AND polpermissive;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '% debe tener EXACTAMENTE una policy permisiva de DELETE; hay % (%)',
        v_t.tabla, v_n, coalesce(v_nombres, '—');
    END IF;

    -- 3.2 · Y esa policy pide la acción `delete` del tab correcto, con la
    --       empresa, y ya no decide por el rol legado.
    SELECT pg_get_expr(polqual, polrelid) INTO v_expr
    FROM pg_policy
    WHERE polrelid = v_t.tabla AND polcmd IN ('d', '*') AND polpermissive;
    IF v_expr NOT LIKE format('%%condominios_puede_actuar(%L::text, %L::text)%%', v_t.tab, 'delete')
       OR v_expr NOT LIKE '%get_my_company_id()%'
       OR v_expr LIKE '%current_user_role()%' THEN
      RAISE EXCEPTION 'la policy de DELETE de % no es la de esta migración: %', v_t.tabla, v_expr;
    END IF;
  END LOOP;

  -- 3.3 · tickets_mantenimiento: UNA sola policy permisiva de UPDATE, y sus dos
  --       lados condicionan `deleted_at` a la acción `delete`.
  SELECT count(*), string_agg(polname, ', ') INTO v_n, v_nombres
  FROM pg_policy
  WHERE polrelid = 'public.tickets_mantenimiento'::regclass
    AND polcmd IN ('w', '*') AND polpermissive;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'tickets_mantenimiento debe tener EXACTAMENTE una policy permisiva de UPDATE; hay % (%)',
      v_n, coalesce(v_nombres, '—');
  END IF;

  FOR v_expr IN
    SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
     WHERE polrelid = 'public.tickets_mantenimiento'::regclass AND polcmd IN ('w', '*') AND polpermissive
    UNION ALL
    SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy
     WHERE polrelid = 'public.tickets_mantenimiento'::regclass AND polcmd IN ('w', '*') AND polpermissive
  LOOP
    IF v_expr IS NULL
       OR v_expr NOT LIKE '%deleted_at IS NULL%'
       OR v_expr NOT LIKE '%condominios_puede_actuar(''mantenimiento''::text, ''delete''::text)%'
       OR v_expr NOT LIKE '%user_has_permission(''condominios.tab.mantenimiento''::text)%' THEN
      RAISE EXCEPTION 'tickets_mantenimiento_update no condiciona deleted_at a .delete en sus dos lados: %', v_expr;
    END IF;
  END LOOP;
END
$$;
