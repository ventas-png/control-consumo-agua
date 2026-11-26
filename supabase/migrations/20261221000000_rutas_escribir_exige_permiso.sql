-- ════════════════════════════════════════════════════════════════════════════
-- Rutas de lectura: crear, editar y eliminar exigen agua.rutas.create / .edit /
-- .delete también en la base. Quien ejecuta la ruta sólo puede darla por
-- completada.
--
-- POR QUÉ
-- La pantalla de Rutas decide cada botón con el permiso del módulo
-- (canCreate/canEdit/canDelete('rutas') → agua.rutas.<acción>, ver
-- RutasSection.tsx). La base aplicaba otra regla, y en los dos sentidos:
--
--   · MÁS LAXA en INSERT y UPDATE. rutas_insert/rutas_update
--     (20260519000009) sólo comprobaban que la ruta fuera de la empresa del
--     usuario. Cualquier cuenta de la empresa —un visor, un operador sin
--     permiso de rutas— podía crear rutas o reescribir las existentes
--     (operador asignado, contadores, recurrencia) llamando a la API.
--
--   · MÁS ESTRICTA en DELETE. rutas_delete pedía el rol de PLATAFORMA admin o
--     company_owner. El «Admin Agua» se da de alta con rol de plataforma
--     `operator` y recibe agua.* por RBAC (EmpresaUsuariosSection.tsx), así que
--     no podía borrar rutas aunque su rol tuviera agua.rutas.delete. La pantalla
--     tenía que esconderle el botón: un DELETE rechazado por RLS borra cero
--     filas sin error y la tarjeta desaparecería sin borrarse.
--
-- QUÉ HACE
--   1 · rutas_insert  → agua.rutas.create, dentro de la empresa y en un proyecto
--                       al que el usuario tiene acceso (can_access_project, la
--                       misma puerta que rutas_select desde 20260815000000).
--   2 · rutas_update  → agua.rutas.edit con acceso al proyecto, o bien QUIEN
--                       EJECUTA LA RUTA: el operador asignado (asignado_a), o
--                       quien registra lecturas (agua.lecturas.create) en ese
--                       proyecto. Al terminar una ruta no recurrente,
--                       LecturasSection hace `UPDATE rutas SET completada = true`
--                       (markRutaCompletada) con la sesión del lector, que no
--                       suele tener agua.rutas.edit.
--   3 · Trigger trg_rutas_solo_completar: sin agua.rutas.edit, el UPDATE sólo
--       puede poner completada = true; cualquier otra columna aborta con 42501.
--       La policy no puede comparar la fila vieja con la nueva, el trigger sí.
--       Se hace así, y no con una RPC nueva, porque la app móvil empaqueta el
--       frontend: las versiones ya instaladas seguirán mandando ese UPDATE
--       directo y no deben dejar de cerrar rutas.
--   4 · rutas_delete  → agua.rutas.delete con acceso al proyecto, en lugar del
--       rol de plataforma.
--   5 · Guarda de postcondición: aborta si queda alguna policy permisiva de
--       escritura distinta de estas tres (se uniría con OR y volvería opcional
--       el permiso) o si falta el trigger.
--
--   super_admin conserva el acceso entre empresas. company_owner/admin siguen
--   pudiendo todo: user_has_permission los trata como exentos. Las escrituras de
--   sistema (service_role en route-reminders, pg_cron, sin auth.uid()) no pasan
--   por el trigger.
--
-- IMPACTO
-- Ningún dato cambia. Desde #1168 la pantalla ya muestra crear/editar/eliminar
-- según estos mismos permisos; esta migración hace que la base los aplique.
-- Quien gana: el rol con agua.rutas.delete que no es admin de plataforma (p. ej.
-- «Admin Agua», y la plantilla «Operador Agua», que trae delete) ahora puede
-- borrar. Quien pierde: quien no tiene agua.rutas.create/edit y escribía rutas
-- por la API (la pantalla ya no le ofrecía el botón).
--
-- REVERSIÓN (las policies de 20260519000009):
--   DROP TRIGGER IF EXISTS trg_rutas_solo_completar ON public.rutas;
--   DROP FUNCTION IF EXISTS public.rutas_solo_completar();
--   DROP POLICY IF EXISTS "rutas_insert" ON public.rutas;
--   CREATE POLICY "rutas_insert" ON public.rutas FOR INSERT TO authenticated
--     WITH CHECK (is_super_admin() OR company_id = (SELECT get_my_company_id()));
--   DROP POLICY IF EXISTS "rutas_update" ON public.rutas;
--   CREATE POLICY "rutas_update" ON public.rutas FOR UPDATE TO authenticated
--     USING (is_super_admin() OR company_id = (SELECT get_my_company_id()))
--     WITH CHECK (is_super_admin() OR company_id = (SELECT get_my_company_id()));
--   DROP POLICY IF EXISTS "rutas_delete" ON public.rutas;
--   CREATE POLICY "rutas_delete" ON public.rutas FOR DELETE TO authenticated
--     USING (is_super_admin() OR (company_id = (SELECT get_my_company_id())
--            AND current_user_role() = ANY (ARRAY['admin', 'company_owner'])));
--
-- IDEMPOTENTE: DROP … IF EXISTS antes de cada CREATE; CREATE OR REPLACE en la
-- función. Probado en supabase/tests/rutas_escribir_por_permiso/.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · INSERT: agua.rutas.create ───────────────────────────────────────────
-- company_id lo rellena trg_rutas_company_id (BEFORE INSERT), que corre antes
-- del WITH CHECK.
DROP POLICY IF EXISTS "rutas_insert" ON public.rutas;
CREATE POLICY "rutas_insert" ON public.rutas
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = (SELECT get_my_company_id())
      AND (SELECT public.user_has_permission('agua.rutas.create'))
      AND public.can_access_project(project_id)
    )
  );

-- ── 2 · UPDATE: agua.rutas.edit, o quien ejecuta la ruta ────────────────────
-- El asignado no necesita acceso al proyecto: rutas_select ya le muestra su
-- ruta por ser el asignado, y es quien la cierra.
DROP POLICY IF EXISTS "rutas_update" ON public.rutas;
CREATE POLICY "rutas_update" ON public.rutas
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = (SELECT get_my_company_id())
      AND (
        ((SELECT public.user_has_permission('agua.rutas.edit')) AND public.can_access_project(project_id))
        OR asignado_a = (SELECT auth.uid())
        OR ((SELECT public.user_has_permission('agua.lecturas.create')) AND public.can_access_project(project_id))
      )
    )
  )
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = (SELECT get_my_company_id())
      AND (
        ((SELECT public.user_has_permission('agua.rutas.edit')) AND public.can_access_project(project_id))
        OR asignado_a = (SELECT auth.uid())
        OR ((SELECT public.user_has_permission('agua.lecturas.create')) AND public.can_access_project(project_id))
      )
    )
  );

-- ── 3 · Sin agua.rutas.edit, sólo se puede completar ────────────────────────
-- Corre antes que trg_sellar_cierre / trg_sellar_creado_por (los BEFORE
-- triggers van por orden alfabético), pero igual se excluyen de la comparación
-- las columnas que esos dos sellan, para no depender del orden.
CREATE OR REPLACE FUNCTION public.rutas_solo_completar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Escritura de sistema (service_role, pg_cron, migraciones): no hay usuario.
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_super_admin() OR public.user_has_permission('agua.rutas.edit') THEN
    RETURN NEW;
  END IF;

  -- La policy sólo deja llegar aquí, sin «Editar», a quien ejecuta la ruta.
  IF NEW.completada IS TRUE
     AND (to_jsonb(NEW) - ARRAY['completada', 'completada_por', 'creado_por'])
       = (to_jsonb(OLD) - ARRAY['completada', 'completada_por', 'creado_por'])
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'No tienes permiso para editar rutas: solo puedes marcar la ruta como completada'
    USING ERRCODE = '42501';
END;
$$;

COMMENT ON FUNCTION public.rutas_solo_completar() IS
  'BEFORE UPDATE de rutas: sin agua.rutas.edit (ni super_admin), sólo se puede poner completada = true. Las escrituras sin auth.uid() (sistema) pasan.';

DROP TRIGGER IF EXISTS trg_rutas_solo_completar ON public.rutas;
CREATE TRIGGER trg_rutas_solo_completar
  BEFORE UPDATE ON public.rutas
  FOR EACH ROW EXECUTE FUNCTION public.rutas_solo_completar();

-- ── 4 · DELETE: agua.rutas.delete ───────────────────────────────────────────
DROP POLICY IF EXISTS "rutas_delete" ON public.rutas;
CREATE POLICY "rutas_delete" ON public.rutas
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = (SELECT get_my_company_id())
      AND (SELECT public.user_has_permission('agua.rutas.delete'))
      AND public.can_access_project(project_id)
    )
  );

-- ── 5 · Guarda de postcondición ──────────────────────────────────────────────
-- Un DROP que no encuentra la policy no es error, y una permisiva de escritura
-- creada a mano (p. ej. un company_rw_rutas FOR ALL) se uniría con OR y
-- volvería opcional el permiso. Se mira lo que QUEDA.
DO $$
DECLARE
  v_cmd   text;
  v_clave text;
  v_n     int;
  v_expr  text;
BEGIN
  FOR v_cmd, v_clave IN
    SELECT * FROM (VALUES ('INSERT', 'agua.rutas.create'),
                          ('UPDATE', 'agua.rutas.edit'),
                          ('DELETE', 'agua.rutas.delete')) AS e(cmd, clave)
  LOOP
    SELECT count(*), max(coalesce(with_check, '') || ' ' || coalesce(qual, ''))
      INTO v_n, v_expr
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'rutas'
       AND cmd IN (v_cmd, 'ALL') AND permissive = 'PERMISSIVE';
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'rutas por permiso: quedan % policies permisivas de % en rutas (se esperaba 1)', v_n, v_cmd;
    END IF;
    IF position(format('user_has_permission(''%s''::text)', v_clave) IN v_expr) = 0
       OR v_expr LIKE '%current_user_role%' THEN
      RAISE EXCEPTION 'rutas por permiso: la policy de % no exige %: %', v_cmd, v_clave, v_expr;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.rutas'::regclass AND tgname = 'trg_rutas_solo_completar'
       AND tgfoid = 'public.rutas_solo_completar()'::regprocedure AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'rutas por permiso: falta el trigger trg_rutas_solo_completar';
  END IF;
END $$;
