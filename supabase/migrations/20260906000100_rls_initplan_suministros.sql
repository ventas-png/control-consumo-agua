-- ════════════════════════════════════════════════════════════════════════════
-- Las políticas de suministros dejan de resolver el permiso fila por fila
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ PASA HOY
-- `public.user_has_permission()` es `LANGUAGE sql STABLE SECURITY DEFINER`
-- (20260518000008). Dentro de una policy, una llamada así —sin argumentos que
-- dependan de la fila— el planificador la evalúa UNA VEZ como InitPlan sólo si
-- va envuelta en `(SELECT …)`. Sin el envoltorio la evalúa POR FILA.
--
-- En `movimientos_suministro` eso se paga en cada listado del almacén, y la
-- tabla sólo crece: cada entrada, cada salida y cada ajuste dejan una fila.
--
-- DE DÓNDE VIENE
-- No es un descuido de ocho políticas sueltas: esas ocho no están escritas en
-- ningún lado. Las genera `rbac_install_company_policies()` (20260518000010),
-- que arma el predicado con `format()` y lo aplica sobre 123 tablas del módulo
-- condominios. El envoltorio SÍ es la convención de la casa —17 migraciones lo
-- usan, y `20260905000100` lo aplica en las policies de `tareas_bloque`— pero
-- la fase masiva de condominios quedó afuera.
--
-- QUÉ HACE ESTA MIGRACIÓN
--   1. Corrige la PLANTILLA del generador, para que cualquier uso futuro nazca
--      bien. Misma firma, misma lógica de detección, mismo todo: cambian sólo
--      los cuatro helpers sin argumentos por fila, que pasan a ir envueltos.
--   2. Re-declara las ocho políticas de `suministros_condominio` y
--      `movimientos_suministro` con esa forma. Se escriben explícitas, en vez
--      de volver a llamar al generador, para que se lean y se diffeen aquí.
--
-- LA SEMÁNTICA NO CAMBIA. Mismo `is_super_admin() OR (company_id = … AND …)`,
-- mismo `condominios.tab.suministros`, mismos roles en el DELETE. Siguen
-- acotadas por `company_id` y no por `project_id`: es el patrón de estas
-- tablas y ampliarlo sería otra discusión, no un cambio de rendimiento.
--
-- LO QUE NO HACE, Y POR QUÉ
-- No vuelve a correr el generador sobre las 123 tablas. Borra y recrea por
-- regex (`_(select|insert|update|delete|sel|ins|upd|del)$`), así que arrasaría
-- con toda política que una migración posterior haya especializado —
-- `tareas_bloque`, `programacion_limpieza`, `ejecuciones_limpieza`. Un barrido
-- completo necesita una lista de exclusión construida contra el catálogo vivo;
-- es un PR propio y con otro perfil de riesgo, no un renglón de éste.
--
-- CÓMO SE COMPRUEBA QUE NO SE ABRIÓ NI SE CERRÓ NADA
-- supabase/tests/rls_initplan_suministros/run.sh mide los mismos seis accesos
-- ANTES y DESPUÉS de aplicar esta migración, contra las políticas de
-- producción de verdad (el generador viejo, copiado literal). El riesgo real de
-- esta clase de cambio es teclear mal un permiso, y eso sólo se ve corriéndolo.
--
-- IDEMPOTENTE: sí — CREATE OR REPLACE y DROP POLICY IF EXISTS.
--
-- REVERSA: reaplicar 20260518000010 (o llamar al generador ya corregido) sobre
-- las dos tablas. La forma vieja no hace falta recuperarla: era más lenta con
-- el mismo resultado.

-- ─── 1 · El generador, con el envoltorio en la plantilla ────────────────────
-- Copia literal de 20260518000010:13-112. Lo único distinto son los cinco
-- bloques del predicado.
CREATE OR REPLACE FUNCTION public.rbac_install_company_policies(
  tbl text,
  perm_key text
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  pol record;
  existing_ops text[];
  had_select boolean := false;
  had_insert boolean := false;
  had_update boolean := false;
  had_delete boolean := false;
BEGIN
  -- Detect which operations had policies BEFORE we drop them. This preserves
  -- existing immutability patterns (e.g., audit-style tables with no UPDATE).
  -- Matches both canonical (_select|insert|update|delete) and truncated
  -- (_sel|ins|upd|del) suffixes used by older migrations.
  SELECT array_agg(DISTINCT cmd) INTO existing_ops
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = tbl
    AND policyname ~ '_(select|insert|update|delete|sel|ins|upd|del)$'
    AND policyname NOT ILIKE '%cliente%';

  IF existing_ops IS NOT NULL THEN
    had_select := 'SELECT' = ANY(existing_ops) OR 'ALL' = ANY(existing_ops);
    had_insert := 'INSERT' = ANY(existing_ops) OR 'ALL' = ANY(existing_ops);
    had_update := 'UPDATE' = ANY(existing_ops) OR 'ALL' = ANY(existing_ops);
    had_delete := 'DELETE' = ANY(existing_ops) OR 'ALL' = ANY(existing_ops);
  ELSE
    -- No prior CRUD policies → assume the table was fully open or new;
    -- install all four operations.
    had_select := true; had_insert := true; had_update := true; had_delete := true;
  END IF;

  -- Drop existing CRUD policies (skip cliente-specific ones). Same regex as
  -- the detection above so we drop every legacy policy that "covered" CRUD.
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = tbl
      AND policyname ~ '_(select|insert|update|delete|sel|ins|upd|del)$'
      AND policyname NOT ILIKE '%cliente%'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, tbl);
  END LOOP;

  IF had_select THEN
    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I
        FOR SELECT TO authenticated
        USING (
          (SELECT public.is_super_admin())
          OR (company_id = (SELECT public.get_my_company_id())
              AND (SELECT public.user_has_permission(%L)))
        )
    $pol$, tbl || '_select', tbl, perm_key);
  END IF;

  IF had_insert THEN
    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (
          (SELECT public.is_super_admin())
          OR (company_id = (SELECT public.get_my_company_id())
              AND (SELECT public.user_has_permission(%L)))
        )
    $pol$, tbl || '_insert', tbl, perm_key);
  END IF;

  IF had_update THEN
    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I
        FOR UPDATE TO authenticated
        USING (
          (SELECT public.is_super_admin())
          OR (company_id = (SELECT public.get_my_company_id())
              AND (SELECT public.user_has_permission(%L)))
        )
        WITH CHECK (
          (SELECT public.is_super_admin())
          OR (company_id = (SELECT public.get_my_company_id())
              AND (SELECT public.user_has_permission(%L)))
        )
    $pol$, tbl || '_update', tbl, perm_key, perm_key);
  END IF;

  IF had_delete THEN
    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I
        FOR DELETE TO authenticated
        USING (
          (SELECT public.is_super_admin())
          OR ((SELECT public.current_user_role()) = ANY(ARRAY['company_owner','admin'])
              AND company_id = (SELECT public.get_my_company_id()))
        )
    $pol$, tbl || '_delete', tbl);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.rbac_install_company_policies(text, text) IS
  'Instala el juego estándar de 4 políticas RBAC sobre una tabla acotada por company_id, preservando qué operaciones tenían política antes. Los helpers sin argumentos por fila van envueltos en (SELECT …) para que el planificador los resuelva una vez como InitPlan y no fila por fila.';

-- ─── 2 · Las ocho políticas de suministros, re-declaradas ───────────────────
-- Explícitas y no por llamada al generador: así el predicado se lee en el
-- archivo, el diff muestra exactamente qué cambió, y el guard de
-- src/__tests__/rlsInitplan.test.ts las puede inspeccionar.
--
-- Los nombres son los que dejó el generador en 20260518000010 (`<tabla>_<op>`),
-- no los de 20260420000021, que aquella migración ya había retirado.

-- ── suministros_condominio ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "suministros_condominio_select" ON public.suministros_condominio;
CREATE POLICY "suministros_condominio_select" ON public.suministros_condominio
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.suministros')))
  );

DROP POLICY IF EXISTS "suministros_condominio_insert" ON public.suministros_condominio;
CREATE POLICY "suministros_condominio_insert" ON public.suministros_condominio
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.suministros')))
  );

DROP POLICY IF EXISTS "suministros_condominio_update" ON public.suministros_condominio;
CREATE POLICY "suministros_condominio_update" ON public.suministros_condominio
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.suministros')))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.suministros')))
  );

DROP POLICY IF EXISTS "suministros_condominio_delete" ON public.suministros_condominio;
CREATE POLICY "suministros_condominio_delete" ON public.suministros_condominio
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR ((SELECT public.current_user_role()) = ANY(ARRAY['company_owner','admin'])
        AND company_id = (SELECT public.get_my_company_id()))
  );

-- ── movimientos_suministro ──────────────────────────────────────────────────
-- La que más se nota: es la tabla que crece con cada movimiento del almacén.
DROP POLICY IF EXISTS "movimientos_suministro_select" ON public.movimientos_suministro;
CREATE POLICY "movimientos_suministro_select" ON public.movimientos_suministro
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.suministros')))
  );

DROP POLICY IF EXISTS "movimientos_suministro_insert" ON public.movimientos_suministro;
CREATE POLICY "movimientos_suministro_insert" ON public.movimientos_suministro
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.suministros')))
  );

DROP POLICY IF EXISTS "movimientos_suministro_update" ON public.movimientos_suministro;
CREATE POLICY "movimientos_suministro_update" ON public.movimientos_suministro
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.suministros')))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.suministros')))
  );

DROP POLICY IF EXISTS "movimientos_suministro_delete" ON public.movimientos_suministro;
CREATE POLICY "movimientos_suministro_delete" ON public.movimientos_suministro
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR ((SELECT public.current_user_role()) = ANY(ARRAY['company_owner','admin'])
        AND company_id = (SELECT public.get_my_company_id()))
  );
