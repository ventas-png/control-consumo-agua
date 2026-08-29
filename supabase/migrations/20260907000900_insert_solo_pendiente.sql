-- ════════════════════════════════════════════════════════════════════════════
-- La tarea nace pendiente: el INSERT deja de ser la puerta de atrás del cierre
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL AGUJERO QUE CIERRA (seguimiento de 20260907000400 / #806)
-- El gate de evidencia gatea LA TRANSICIÓN a 'completada' en UPDATE — su
-- propia cabecera lo dice: «se gatea la transición, no la fila». Correcto para
-- el histórico… y exactamente el hueco del alta: una fila INSERTADA ya en
-- 'completada' (o 'con_observacion'/'omitida') nunca hace esa transición y
-- nunca pasa por el gate. Un cliente autenticado con permiso de alta podía
-- crear la tarea PRE-CERRADA — con `completada_en` inventada, `completado_por`
-- atribuido a otra persona (sellar_cierre solo sella en UPDATE), la anulación
-- pre-firmada o `motivo_sin_evidencia` pre-cargado para armar el bypass del
-- cierre siguiente. La policy de INSERT de 20260907000100 solo miraba empresa
-- y permiso, no el CONTENIDO de la fila.
--
-- QUÉ HACE
-- Re-declara `tareas_bloque_insert` conservando el gate de empresa y permisos
-- EXACTO de 20260907000100 (mismos tres tabs, misma forma envuelta del guard
-- de #799) y añadiendo, en la rama de empresa, el contrato del alta:
--
--   · estado = 'pendiente'                        — la tarea NACE pendiente
--   · completada_en / completado_por  IS NULL     — sin cierre ni actor
--   · anulada_en / anulada_por / motivo_anulacion IS NULL — sin anulación
--   · motivo_sin_evidencia            IS NULL     — sin el sello de excepción
--                                                   pre-cargado (es la salida
--                                                   DECLARADA de 20260907000400:
--                                                   se declara al cerrar, no
--                                                   se deja lista al nacer)
--
-- La evidencia en sí (foto_urls, evidencia_texto, checklist_completado) NO se
-- restringe: son columnas que el flujo normal escribe por UPDATE en cualquier
-- momento previo al cierre — restringirlas al nacer no quitaría nada que un
-- UPDATE inmediato no devuelva.
--
-- POR QUÉ NO HAY «FUNCIÓN ESTRECHA» PARA OTROS ESTADOS
-- Se revisaron las TRES rutas de alta y ninguna necesita nacer en otro estado:
--   · TareasPersonalTab (agregarTareaDesde / agregarDesdePlantillas) inserta
--     SIN `estado` — aplica el DEFAULT 'pendiente';
--   · materializar_rutinas_turno (20260907000300) escribe 'pendiente'
--     LITERAL, y además es SECURITY DEFINER: corre como el dueño de la tabla
--     y la RLS no la alcanza — endurecer la policy no la toca;
--   · los seeds de E2E escriben con service_role, que tampoco pasa por RLS.
-- Un camino interno futuro que necesite otra cosa se escribe entonces como
-- función SECURITY DEFINER estrecha y con pruebas — NO ensanchando esta policy.
--
-- LO QUE NO HACE: no toca el gate de UPDATE de 20260907000400 (la transición
-- sigue exigiendo evidencia o su excepción declarada) y no re-valida filas
-- históricas: una edición no relacionada de una tarea vieja sigue fluyendo.
--
-- VIGILANCIA: migraciones-vs-produccion estrena POLICIES_CRITICAS — la
-- EXPRESIÓN real del WITH CHECK (pg_get_expr) se exige contra producción, no
-- solo el nombre de la policy (la lección de 20260907000700 con el CHECK).
-- El postdeploy de solo lectura vive en
-- supabase/tests/insert_solo_pendiente/postdeploy.sql.
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS → CREATE POLICY.
--
-- REVERSA: recrear `tareas_bloque_insert` con el cuerpo de 20260907000100
-- (que es el que acepta filas pre-cerradas).

DROP POLICY IF EXISTS "tareas_bloque_insert" ON public.tareas_bloque;
CREATE POLICY "tareas_bloque_insert" ON public.tareas_bloque
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin()) OR (
      estado = 'pendiente'
      AND completada_en IS NULL
      AND completado_por IS NULL
      AND anulada_en IS NULL
      AND anulada_por IS NULL
      AND motivo_anulacion IS NULL
      AND motivo_sin_evidencia IS NULL
      AND EXISTS (
        SELECT 1 FROM public.bloques_turno b
        WHERE b.id = tareas_bloque.bloque_id
          AND b.company_id = (SELECT public.get_my_company_id())
          AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
               OR public.user_has_permission('condominios.tab.turnos')
               OR public.user_has_permission('condominios.tab.prog_limpieza'))
      )
    )
  );
