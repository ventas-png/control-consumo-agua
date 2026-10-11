-- ════════════════════════════════════════════════════════════════════════════
-- REVERSIÓN de supabase/migrations/20261026000600_seguridad_asignaciones_proyecto.sql
--
-- Devuelve public.user_project_assignments a como estaba en PRODUCCIÓN antes de la migración (exacto con la ACL de producción: anon y authenticated con
-- arwdDxt, más m en PostgreSQL 17; probado con 0 diferencias de huella, ACL incluida):
--   · las CUATRO políticas con su texto original (el de 20260417000013_consolidate_rls_policies_part2.sql, idéntico al leído en
--     producción el 2026-10-10: el texto de pg_get_expr coincide);
--   · sin los triggers trg_asignacion_empresa y trg_asignacion_propia;
--   · sin las funciones asignacion_puede_administrar(uuid, uuid), asignacion_validar_empresa() y asignacion_bloquear_propia();
--   · con los privilegios originales (anon: todos; authenticated: también TRUNCATE, TRIGGER y REFERENCES). El SELECT/INSERT/UPDATE/DELETE de
--     authenticated NO se toca (la migración tampoco lo tocó): se conserva el que hubiera, sea cual sea la base.
-- LÍMITE (R2-4): le devuelve a anon los siete privilegios, que es lo que anon TENÍA en producción. En una base construida sólo con migraciones (la ACL de Supabase
-- Preview: anon y authenticated sólo con TRUNCATE, REFERENCES y TRIGGER) eso es MÁS de lo que tenía: anon recupera SELECT, INSERT, UPDATE y DELETE que allí nunca tuvo.
-- No hay exposición (la RLS no le da nada a anon y la migración, al volver a aplicarse, se los quita), y la reversión sólo está pensada para producción; en una base de
-- Preview basta con reiniciar la rama. Se deja así a propósito para no meter lógica de privilegios por versión de PostgreSQL en un guion de emergencia.
-- No toca ninguna fila (comprueba que el conteo y la huella sean los mismos al terminar). IDEMPOTENTE: se puede correr dos veces.
--
-- ⚠ QUIEN REVIERTE REABRE EL HUECO: cualquier usuario autenticado vuelve a poder asignarse proyectos y un administrador acotado a
-- borrarse las suyas y quedar exento. Sólo se usa si la migración causa un problema en producción; el hueco se cierra de nuevo
-- volviendo a aplicar la migración (que es idempotente).
--
-- Cómo correrla: en el Editor SQL de Supabase, o  psql "$CONEXION" -v ON_ERROR_STOP=1 -f scripts/reversion-asignaciones-proyecto.sql
-- Después hay que RECAPTURAR scripts/schema-drift/huella-produccion.json si ya se había recapturado tras el despliegue.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  -- bloqueo ANTES de medir (como la migración): una escritura legítima no puede colarse entre la medición y el post-vuelo
  LOCK TABLE public.user_project_assignments IN ACCESS EXCLUSIVE MODE;
  PERFORM set_config('app.asg_rev_dml', concat_ws(',',
    CASE WHEN has_table_privilege('authenticated', 'public.user_project_assignments', 'SELECT') THEN 'SELECT' END,
    CASE WHEN has_table_privilege('authenticated', 'public.user_project_assignments', 'INSERT') THEN 'INSERT' END,
    CASE WHEN has_table_privilege('authenticated', 'public.user_project_assignments', 'UPDATE') THEN 'UPDATE' END,
    CASE WHEN has_table_privilege('authenticated', 'public.user_project_assignments', 'DELETE') THEN 'DELETE' END), true);
  PERFORM set_config('app.asg_rev_n', (SELECT count(*) FROM public.user_project_assignments)::text, true);
  PERFORM set_config('app.asg_rev_huella',
    (SELECT md5(COALESCE(string_agg(u.id::text || '|' || u.user_id::text || '|' || u.project_id::text || '|' || u.permission_type, E'\n' ORDER BY u.id), ''))
       FROM public.user_project_assignments u), true);
END
$pre$;

-- ── 1 · las cuatro políticas, con su texto original ─────────────────────────
-- Los nombres van CALIFICADOS (public.…): CREATE POLICY resuelve los nombres al crearla y con un search_path vacío (o sin public) «is_super_admin()» no existe (V3-04). El árbol que
-- queda guardado es el mismo —lo que se imprime con pg_get_expr depende del search_path de quien lo mira, no de cómo se escribió—, y la suite lo comprueba (md5 por política).
DROP POLICY IF EXISTS "user_project_assignments_select" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_select" ON public.user_project_assignments
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT id FROM public.projects WHERE company_id = public.get_my_company_id()))
    OR user_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "user_project_assignments_insert" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_insert" ON public.user_project_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT id FROM public.projects WHERE company_id = public.get_my_company_id()))
    OR user_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "user_project_assignments_update" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_update" ON public.user_project_assignments
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT id FROM public.projects WHERE company_id = public.get_my_company_id()))
    OR user_id = (SELECT auth.uid())
  )
  WITH CHECK (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT id FROM public.projects WHERE company_id = public.get_my_company_id()))
    OR user_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "user_project_assignments_delete" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_delete" ON public.user_project_assignments
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT id FROM public.projects WHERE company_id = public.get_my_company_id()))
    OR user_id = (SELECT auth.uid())
  );

-- ── 2 · triggers y funciones (primero los triggers: dependen de las funciones) ──
DROP TRIGGER IF EXISTS trg_asignacion_propia  ON public.user_project_assignments;
DROP TRIGGER IF EXISTS trg_asignacion_empresa ON public.user_project_assignments;
DROP FUNCTION IF EXISTS public.asignacion_bloquear_propia();
DROP FUNCTION IF EXISTS public.asignacion_validar_empresa();
DROP FUNCTION IF EXISTS public.asignacion_puede_administrar(uuid, uuid);

-- ── 3 · privilegios originales ──────────────────────────────────────────────
GRANT ALL ON TABLE public.user_project_assignments TO anon;
GRANT TRUNCATE, TRIGGER, REFERENCES ON TABLE public.user_project_assignments TO authenticated;

-- ── Post-vuelo ──────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_huella text;
  -- «auth.uid()» tal como lo imprime pg_get_expr: calificado, salvo que el esquema auth esté en el search_path de la sesión (entonces sale «uid()»). Se
  -- aceptan las dos formas; antes sólo «auth.uid» y la reversión abortaba con «las políticas no quedaron como las originales» si auth estaba en el search_path.
  v_re_uid constant text := E'\\m(auth\\.)?uid\\(\\)';
BEGIN
  SELECT md5(COALESCE(string_agg(u.id::text || '|' || u.user_id::text || '|' || u.project_id::text || '|' || u.permission_type, E'\n' ORDER BY u.id), ''))
    INTO v_huella FROM public.user_project_assignments u;
  IF (SELECT count(*) FROM public.user_project_assignments)::text IS DISTINCT FROM current_setting('app.asg_rev_n', true)
     OR v_huella IS DISTINCT FROM current_setting('app.asg_rev_huella', true) THEN
    RAISE EXCEPTION 'reversion_asignaciones_proyecto: las filas CAMBIARON (no debía tocarlas)';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass) <> 4
     OR (SELECT count(*) FROM pg_policy p WHERE p.polrelid = 'public.user_project_assignments'::regclass
           AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ v_re_uid) <> 4 THEN
    RAISE EXCEPTION 'reversion_asignaciones_proyecto: las políticas no quedaron como las originales';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.user_project_assignments'::regclass AND NOT t.tgisinternal)
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN
                ('asignacion_puede_administrar', 'asignacion_validar_empresa', 'asignacion_bloquear_propia')) THEN
    RAISE EXCEPTION 'reversion_asignaciones_proyecto: quedan triggers o funciones de la migración';
  END IF;
  -- anon recupera los 7; authenticated recupera TRUNCATE, TRIGGER y REFERENCES, y su SELECT/INSERT/UPDATE/DELETE queda EXACTAMENTE como estaba
  -- (relativo: exigirlo como absoluto abortaría en una base donde authenticated nunca lo tuvo, p. ej. Supabase Preview)
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x
              WHERE NOT has_table_privilege('anon', 'public.user_project_assignments', x))
     OR NOT has_table_privilege('authenticated', 'public.user_project_assignments', 'TRUNCATE')
     OR NOT has_table_privilege('authenticated', 'public.user_project_assignments', 'REFERENCES')
     OR NOT has_table_privilege('authenticated', 'public.user_project_assignments', 'TRIGGER')
     OR concat_ws(',',
          CASE WHEN has_table_privilege('authenticated', 'public.user_project_assignments', 'SELECT') THEN 'SELECT' END,
          CASE WHEN has_table_privilege('authenticated', 'public.user_project_assignments', 'INSERT') THEN 'INSERT' END,
          CASE WHEN has_table_privilege('authenticated', 'public.user_project_assignments', 'UPDATE') THEN 'UPDATE' END,
          CASE WHEN has_table_privilege('authenticated', 'public.user_project_assignments', 'DELETE') THEN 'DELETE' END)
        IS DISTINCT FROM current_setting('app.asg_rev_dml', true) THEN
    RAISE EXCEPTION 'reversion_asignaciones_proyecto: los privilegios no quedaron como los originales (ACL %)',
      (SELECT c.relacl::text FROM pg_class c WHERE c.oid = 'public.user_project_assignments'::regclass);
  END IF;
  RAISE NOTICE 'reversion_asignaciones_proyecto: hecha. 4 políticas originales, sin triggers ni funciones, privilegios originales, filas intactas.';
END
$post$;

COMMIT;
