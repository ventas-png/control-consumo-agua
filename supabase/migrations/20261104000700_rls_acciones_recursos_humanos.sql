-- ════════════════════════════════════════════════════════════════════════════
-- Recursos humanos: escribir exige la ACCIÓN del tab, también en la base
--
-- POR QUÉ
-- La pantalla decide cada escritura de estos tabs con su acción (canCreate /
-- canEdit / canDelete). Las policies de INSERT y UPDATE sólo pedían ver el tab
-- —quien sólo consulta podía crear y editar por la API—, las de DELETE sólo
-- dejaban a company_owner/admin (o, en los catálogos de limpieza y de
-- plantillas, a quien sólo viera el tab), aunque la pantalla ofreciera
-- «Eliminar» a quien tuviera la acción.
--
-- Tabs: Ausencias (y días no laborables), Capacitación, Personal, Plantillas de
-- cargo (actividades y sus recursos), Presencia, Programación de limpieza
-- (rutinas, recorridos y ejecuciones), Revisión de tareas, Tareas, Tareas por
-- turno (y sus insumos) y Turnos (reglas, jornadas y cupos de pausa).
--
-- No cambia bloques_turno: 20260916221839 ya lo autoriza por acción (borrar un
-- bloque es editar el turno). La DELETE de ejecuciones_limpieza sigue siendo
-- sólo de super_admin: no lleva permiso que sustituir.
--
-- QUÉ HACE (generado por scripts/rls-acciones/generar.mjs desde
-- supabase/rls-acciones/recursos_humanos.json; no editar a mano)
-- En cada policy de escritura de las tablas de abajo se sustituyen SÓLO los
-- átomos de permiso —user_has_permission('condominios.tab.<tab>') y
-- current_user_role() = ANY (company_owner, admin)— por la acción del tab que
-- la pantalla exige para ese comando (condominios_puede_actuar, réplica de
-- canActInCondominiosTab). Empresa, EXISTS al padre, ramas del residente y
-- cualquier otra condición quedan idénticas. company_owner/admin siguen
-- pasando (exentos en user_has_permission); super_admin, como antes.
--
-- IMPACTO: ningún dato cambia. Quien sólo VE un tab deja de crear, editar o
-- borrar por la API; quien tiene la acción (o el par legado) hace en la base lo
-- que ya le ofrecía la pantalla. Las RPC SECURITY DEFINER y service_role no
-- pasan por RLS.
--
-- REVERSIÓN: node scripts/rls-acciones/generar.mjs <sección> --revertir
-- emite las policies tal como estaban.
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS antes de cada CREATE.
-- ════════════════════════════════════════════════════════════════════════════

-- ── asignaciones_turno ──────────────────────────────────────────────────────
--   INSERT turnos.create
--   UPDATE turnos.edit
--   DELETE turnos.delete
DROP POLICY IF EXISTS asignaciones_turno_delete ON public.asignaciones_turno;
CREATE POLICY asignaciones_turno_delete ON public.asignaciones_turno
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('turnos', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS asignaciones_turno_insert ON public.asignaciones_turno;
CREATE POLICY asignaciones_turno_insert ON public.asignaciones_turno
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('turnos', 'create')) ))));
DROP POLICY IF EXISTS asignaciones_turno_update ON public.asignaciones_turno;
CREATE POLICY asignaciones_turno_update ON public.asignaciones_turno
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('turnos', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('turnos', 'edit')) ))));

-- ── ausencias_personal ──────────────────────────────────────────────────────
--   INSERT ausencias.create
--   UPDATE ausencias.edit
--   DELETE ausencias.delete
DROP POLICY IF EXISTS ausencias_personal_delete ON public.ausencias_personal;
CREATE POLICY ausencias_personal_delete ON public.ausencias_personal
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('ausencias', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS ausencias_personal_insert ON public.ausencias_personal;
CREATE POLICY ausencias_personal_insert ON public.ausencias_personal
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('ausencias', 'create')) ))));
DROP POLICY IF EXISTS ausencias_personal_update ON public.ausencias_personal;
CREATE POLICY ausencias_personal_update ON public.ausencias_personal
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('ausencias', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('ausencias', 'edit')) ))));

-- ── capacitacion_personal_cond ──────────────────────────────────────────────
--   INSERT capacitacion_personal.create
--   UPDATE capacitacion_personal.edit
--   DELETE capacitacion_personal.delete
DROP POLICY IF EXISTS capacitacion_personal_cond_delete ON public.capacitacion_personal_cond;
CREATE POLICY capacitacion_personal_cond_delete ON public.capacitacion_personal_cond
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('capacitacion_personal', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS capacitacion_personal_cond_insert ON public.capacitacion_personal_cond;
CREATE POLICY capacitacion_personal_cond_insert ON public.capacitacion_personal_cond
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('capacitacion_personal', 'create')) ))));
DROP POLICY IF EXISTS capacitacion_personal_cond_update ON public.capacitacion_personal_cond;
CREATE POLICY capacitacion_personal_cond_update ON public.capacitacion_personal_cond
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('capacitacion_personal', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('capacitacion_personal', 'edit')) ))));

-- ── dias_no_laborables ──────────────────────────────────────────────────────
--   INSERT ausencias.create
--   UPDATE ausencias.edit
--   DELETE ausencias.delete
DROP POLICY IF EXISTS dias_no_laborables_delete ON public.dias_no_laborables;
CREATE POLICY dias_no_laborables_delete ON public.dias_no_laborables
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('ausencias', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS dias_no_laborables_insert ON public.dias_no_laborables;
CREATE POLICY dias_no_laborables_insert ON public.dias_no_laborables
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('ausencias', 'create')) ))));
DROP POLICY IF EXISTS dias_no_laborables_update ON public.dias_no_laborables;
CREATE POLICY dias_no_laborables_update ON public.dias_no_laborables
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('ausencias', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('ausencias', 'edit')) ))));

-- ── ejecuciones_limpieza ────────────────────────────────────────────────────
--   INSERT prog_limpieza.create
--   UPDATE prog_limpieza.edit · revision_tareas.edit
--   DELETE prog_limpieza.delete
--   «Atender» una novedad baja su bandera de mantenimiento (atenderNovedad) desde Programación de limpieza y desde Revisión de tareas, con canEdit.
DROP POLICY IF EXISTS ejecuciones_limpieza_insert ON public.ejecuciones_limpieza;
CREATE POLICY ejecuciones_limpieza_insert ON public.ejecuciones_limpieza
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'create')) ))));
DROP POLICY IF EXISTS ejecuciones_limpieza_update ON public.ejecuciones_limpieza;
CREATE POLICY ejecuciones_limpieza_update ON public.ejecuciones_limpieza
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'edit') OR public.condominios_puede_actuar('revision_tareas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'edit') OR public.condominios_puede_actuar('revision_tareas', 'edit')) ))));

-- ── personal_condominio ─────────────────────────────────────────────────────
--   INSERT personal.create
--   UPDATE personal.edit
--   DELETE personal.delete
DROP POLICY IF EXISTS personal_condominio_delete ON public.personal_condominio;
CREATE POLICY personal_condominio_delete ON public.personal_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('personal', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS personal_condominio_insert ON public.personal_condominio;
CREATE POLICY personal_condominio_insert ON public.personal_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('personal', 'create')) ))));
DROP POLICY IF EXISTS personal_condominio_update ON public.personal_condominio;
CREATE POLICY personal_condominio_update ON public.personal_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('personal', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('personal', 'edit')) ))));

-- ── plantilla_cupos_pausa ───────────────────────────────────────────────────
--   INSERT turnos.create · turnos.edit
--   UPDATE turnos.edit
--   DELETE turnos.delete · turnos.edit
--   Guardar una jornada —nueva con canCreate, existente con canEdit— reemplaza sus cupos de pausa
--   (turnos_guardar_jornada, SECURITY INVOKER: corre con la RLS de quien guarda). Sigue exigiendo
--   además turnos_puede_administrar_jornada.
DROP POLICY IF EXISTS plantilla_cupos_pausa_delete ON public.plantilla_cupos_pausa;
CREATE POLICY plantilla_cupos_pausa_delete ON public.plantilla_cupos_pausa
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('turnos', 'delete') OR public.condominios_puede_actuar('turnos', 'edit')) ) AND turnos_puede_administrar_jornada(plantilla_horario_id))));
DROP POLICY IF EXISTS plantilla_cupos_pausa_insert ON public.plantilla_cupos_pausa;
CREATE POLICY plantilla_cupos_pausa_insert ON public.plantilla_cupos_pausa
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('turnos', 'create') OR public.condominios_puede_actuar('turnos', 'edit')) ) AND turnos_puede_administrar_jornada(plantilla_horario_id))));
DROP POLICY IF EXISTS plantilla_cupos_pausa_update ON public.plantilla_cupos_pausa;
CREATE POLICY plantilla_cupos_pausa_update ON public.plantilla_cupos_pausa
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('turnos', 'edit')) ) AND turnos_puede_administrar_jornada(plantilla_horario_id))))
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('turnos', 'edit')) ) AND turnos_puede_administrar_jornada(plantilla_horario_id))));

-- ── plantilla_tarea_herramientas ────────────────────────────────────────────
--   INSERT plantillas_cargo.create · plantillas_cargo.edit
--   UPDATE plantillas_cargo.edit
--   DELETE plantillas_cargo.delete · plantillas_cargo.edit
--   Agregar o quitar una herramienta de una actividad —una a una o en bloque
--   (plantillas_recursos_en_bloque, SECURITY INVOKER)— es editar la actividad: se ofrece con canEdit.
--   Importar actividades (canCreate) las trae con sus recursos.
DROP POLICY IF EXISTS plantilla_tarea_herramientas_delete ON public.plantilla_tarea_herramientas;
CREATE POLICY plantilla_tarea_herramientas_delete ON public.plantilla_tarea_herramientas
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_cargo', 'delete') OR public.condominios_puede_actuar('plantillas_cargo', 'edit')) ))));
DROP POLICY IF EXISTS plantilla_tarea_herramientas_insert ON public.plantilla_tarea_herramientas;
CREATE POLICY plantilla_tarea_herramientas_insert ON public.plantilla_tarea_herramientas
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_cargo', 'create') OR public.condominios_puede_actuar('plantillas_cargo', 'edit')) ))));
DROP POLICY IF EXISTS plantilla_tarea_herramientas_update ON public.plantilla_tarea_herramientas;
CREATE POLICY plantilla_tarea_herramientas_update ON public.plantilla_tarea_herramientas
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_cargo', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_cargo', 'edit')) ))));

-- ── plantilla_tarea_suministros ─────────────────────────────────────────────
--   INSERT plantillas_cargo.create · plantillas_cargo.edit
--   UPDATE plantillas_cargo.edit
--   DELETE plantillas_cargo.delete · plantillas_cargo.edit
--   Agregar o quitar un insumo de una actividad —uno a uno o en bloque
--   (plantillas_recursos_en_bloque, SECURITY INVOKER)— es editar la actividad: se ofrece con canEdit.
--   Importar actividades (canCreate) las trae con sus recursos.
DROP POLICY IF EXISTS plantilla_tarea_suministros_delete ON public.plantilla_tarea_suministros;
CREATE POLICY plantilla_tarea_suministros_delete ON public.plantilla_tarea_suministros
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_cargo', 'delete') OR public.condominios_puede_actuar('plantillas_cargo', 'edit')) ))));
DROP POLICY IF EXISTS plantilla_tarea_suministros_insert ON public.plantilla_tarea_suministros;
CREATE POLICY plantilla_tarea_suministros_insert ON public.plantilla_tarea_suministros
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_cargo', 'create') OR public.condominios_puede_actuar('plantillas_cargo', 'edit')) ))));
DROP POLICY IF EXISTS plantilla_tarea_suministros_update ON public.plantilla_tarea_suministros;
CREATE POLICY plantilla_tarea_suministros_update ON public.plantilla_tarea_suministros
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_cargo', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_cargo', 'edit')) ))));

-- ── plantillas_horario ──────────────────────────────────────────────────────
--   INSERT turnos.create
--   UPDATE turnos.edit
--   DELETE turnos.delete
DROP POLICY IF EXISTS plantillas_horario_delete ON public.plantillas_horario;
CREATE POLICY plantillas_horario_delete ON public.plantillas_horario
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('turnos', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS plantillas_horario_insert ON public.plantillas_horario;
CREATE POLICY plantillas_horario_insert ON public.plantillas_horario
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('turnos', 'create')) ))));
DROP POLICY IF EXISTS plantillas_horario_update ON public.plantillas_horario;
CREATE POLICY plantillas_horario_update ON public.plantillas_horario
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('turnos', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('turnos', 'edit')) ))));

-- ── plantillas_tarea_cargo ──────────────────────────────────────────────────
--   INSERT plantillas_cargo.create
--   UPDATE plantillas_cargo.edit
--   DELETE plantillas_cargo.delete
DROP POLICY IF EXISTS plantillas_tarea_cargo_delete ON public.plantillas_tarea_cargo;
CREATE POLICY plantillas_tarea_cargo_delete ON public.plantillas_tarea_cargo
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('plantillas_cargo', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS plantillas_tarea_cargo_insert ON public.plantillas_tarea_cargo;
CREATE POLICY plantillas_tarea_cargo_insert ON public.plantillas_tarea_cargo
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_cargo', 'create')) ))));
DROP POLICY IF EXISTS plantillas_tarea_cargo_update ON public.plantillas_tarea_cargo;
CREATE POLICY plantillas_tarea_cargo_update ON public.plantillas_tarea_cargo
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_cargo', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_cargo', 'edit')) ))));

-- ── presencia_personal ──────────────────────────────────────────────────────
--   INSERT presencia.create
--   UPDATE presencia.edit
--   DELETE presencia.delete
DROP POLICY IF EXISTS presencia_personal_delete ON public.presencia_personal;
CREATE POLICY presencia_personal_delete ON public.presencia_personal
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('presencia', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS presencia_personal_insert ON public.presencia_personal;
CREATE POLICY presencia_personal_insert ON public.presencia_personal
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('presencia', 'create')) ))));
DROP POLICY IF EXISTS presencia_personal_update ON public.presencia_personal;
CREATE POLICY presencia_personal_update ON public.presencia_personal
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('presencia', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('presencia', 'edit')) ))));

-- ── programacion_limpieza ───────────────────────────────────────────────────
--   INSERT prog_limpieza.create
--   UPDATE prog_limpieza.edit
--   DELETE prog_limpieza.delete
DROP POLICY IF EXISTS programacion_limpieza_delete ON public.programacion_limpieza;
CREATE POLICY programacion_limpieza_delete ON public.programacion_limpieza
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('prog_limpieza', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS programacion_limpieza_insert ON public.programacion_limpieza;
CREATE POLICY programacion_limpieza_insert ON public.programacion_limpieza
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'create')) ))));
DROP POLICY IF EXISTS programacion_limpieza_update ON public.programacion_limpieza;
CREATE POLICY programacion_limpieza_update ON public.programacion_limpieza
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'edit')) ))));

-- ── revisiones_tarea ────────────────────────────────────────────────────────
--   INSERT revision_tareas.create · revision_tareas.edit
--   UPDATE revision_tareas.edit
--   DELETE revision_tareas.delete
--   «Revisar» una tarea se ofrece con canEdit('revision_tareas'): la primera revisión crea la fila.
DROP POLICY IF EXISTS revisiones_tarea_delete ON public.revisiones_tarea;
CREATE POLICY revisiones_tarea_delete ON public.revisiones_tarea
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR (EXISTS ( SELECT 1
   FROM bloques_turno b
  WHERE ((b.id = revisiones_tarea.bloque_id) AND (b.company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('revision_tareas', 'delete')) ))))));
DROP POLICY IF EXISTS revisiones_tarea_insert ON public.revisiones_tarea;
CREATE POLICY revisiones_tarea_insert ON public.revisiones_tarea
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR (EXISTS ( SELECT 1
   FROM bloques_turno b
  WHERE ((b.id = revisiones_tarea.bloque_id) AND (b.company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('revision_tareas', 'create') OR public.condominios_puede_actuar('revision_tareas', 'edit')) ))))));
DROP POLICY IF EXISTS revisiones_tarea_update ON public.revisiones_tarea;
CREATE POLICY revisiones_tarea_update ON public.revisiones_tarea
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR (EXISTS ( SELECT 1
   FROM bloques_turno b
  WHERE ((b.id = revisiones_tarea.bloque_id) AND (b.company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('revision_tareas', 'edit')) ))))))
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR (EXISTS ( SELECT 1
   FROM bloques_turno b
  WHERE ((b.id = revisiones_tarea.bloque_id) AND (b.company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('revision_tareas', 'edit')) ))))));

-- ── rutina_actividades ──────────────────────────────────────────────────────
--   INSERT prog_limpieza.create · prog_limpieza.edit
--   UPDATE prog_limpieza.edit
--   DELETE prog_limpieza.delete · prog_limpieza.edit
--   Guardar el recorrido de una rutina —nueva con canCreate, existente con canEdit— reconcilia sus actividades (guardar_recorrido_rutina, SECURITY INVOKER).
DROP POLICY IF EXISTS rutina_actividades_delete ON public.rutina_actividades;
CREATE POLICY rutina_actividades_delete ON public.rutina_actividades
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'delete') OR public.condominios_puede_actuar('prog_limpieza', 'edit')) ))));
DROP POLICY IF EXISTS rutina_actividades_insert ON public.rutina_actividades;
CREATE POLICY rutina_actividades_insert ON public.rutina_actividades
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'create') OR public.condominios_puede_actuar('prog_limpieza', 'edit')) ))));
DROP POLICY IF EXISTS rutina_actividades_update ON public.rutina_actividades;
CREATE POLICY rutina_actividades_update ON public.rutina_actividades
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'edit')) ))))
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'edit')) ))));

-- ── rutina_areas ────────────────────────────────────────────────────────────
--   INSERT prog_limpieza.create · prog_limpieza.edit
--   UPDATE prog_limpieza.edit
--   DELETE prog_limpieza.delete · prog_limpieza.edit
--   Guardar el recorrido de una rutina —nueva con canCreate, existente con canEdit— reconcilia sus áreas (guardar_recorrido_rutina, SECURITY INVOKER).
DROP POLICY IF EXISTS rutina_areas_delete ON public.rutina_areas;
CREATE POLICY rutina_areas_delete ON public.rutina_areas
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'delete') OR public.condominios_puede_actuar('prog_limpieza', 'edit')) ))));
DROP POLICY IF EXISTS rutina_areas_insert ON public.rutina_areas;
CREATE POLICY rutina_areas_insert ON public.rutina_areas
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'create') OR public.condominios_puede_actuar('prog_limpieza', 'edit')) ))));
DROP POLICY IF EXISTS rutina_areas_update ON public.rutina_areas;
CREATE POLICY rutina_areas_update ON public.rutina_areas
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'edit')) ))))
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'edit')) ))));

-- ── rutinas_limpieza ────────────────────────────────────────────────────────
--   INSERT prog_limpieza.create
--   UPDATE prog_limpieza.edit
--   DELETE prog_limpieza.delete
DROP POLICY IF EXISTS rutinas_limpieza_delete ON public.rutinas_limpieza;
CREATE POLICY rutinas_limpieza_delete ON public.rutinas_limpieza
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'delete')) ))));
DROP POLICY IF EXISTS rutinas_limpieza_insert ON public.rutinas_limpieza;
CREATE POLICY rutinas_limpieza_insert ON public.rutinas_limpieza
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'create')) ))));
DROP POLICY IF EXISTS rutinas_limpieza_update ON public.rutinas_limpieza;
CREATE POLICY rutinas_limpieza_update ON public.rutinas_limpieza
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'edit')) ))))
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('prog_limpieza', 'edit')) ))));

-- ── tarea_bloque_suministros ────────────────────────────────────────────────
--   INSERT tareas_personal.create
--   UPDATE tareas_personal.edit
--   DELETE sin policy: nadie (no se crea)
--   Ninguna pantalla la escribe directamente: la llenan y la consumen funciones SECURITY DEFINER
--   (tarea_copiar_insumos_plantilla, cerrar_tarea_y_consumir_insumos). Ver Turnos, Limpieza o
--   Revisión ya no basta para escribirla por la API.
DROP POLICY IF EXISTS tarea_bloque_suministros_insert ON public.tarea_bloque_suministros;
CREATE POLICY tarea_bloque_suministros_insert ON public.tarea_bloque_suministros
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (( SELECT (public.condominios_puede_actuar('tareas_personal', 'create')) ) OR ( SELECT (public.condominios_puede_actuar('tareas_personal', 'create')) ) OR ( SELECT (public.condominios_puede_actuar('tareas_personal', 'create')) ))))));
DROP POLICY IF EXISTS tarea_bloque_suministros_update ON public.tarea_bloque_suministros;
CREATE POLICY tarea_bloque_suministros_update ON public.tarea_bloque_suministros
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (( SELECT (public.condominios_puede_actuar('tareas_personal', 'edit')) ) OR ( SELECT (public.condominios_puede_actuar('tareas_personal', 'edit')) ) OR ( SELECT (public.condominios_puede_actuar('tareas_personal', 'edit')) ) OR ( SELECT (public.condominios_puede_actuar('tareas_personal', 'edit')) ))))))
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (( SELECT (public.condominios_puede_actuar('tareas_personal', 'edit')) ) OR ( SELECT (public.condominios_puede_actuar('tareas_personal', 'edit')) ) OR ( SELECT (public.condominios_puede_actuar('tareas_personal', 'edit')) ) OR ( SELECT (public.condominios_puede_actuar('tareas_personal', 'edit')) ))))));

-- ── tareas_bloque ───────────────────────────────────────────────────────────
--   INSERT tareas_personal.create
--   UPDATE tareas_personal.edit · prog_limpieza.edit · revision_tareas.edit
--   DELETE tareas_personal.delete
--   La ruta del día de Limpieza ejecuta las tareas con la misma pantalla (canEdit('prog_limpieza')), y
--   «Atender» una novedad baja su bandera desde Limpieza y desde Revisión de tareas, con canEdit.
--   Turnos no escribe tareas: ver Turnos ya no basta.
DROP POLICY IF EXISTS tareas_bloque_delete ON public.tareas_bloque;
CREATE POLICY tareas_bloque_delete ON public.tareas_bloque
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR ((completada_en IS NULL) AND (EXISTS ( SELECT 1
   FROM bloques_turno b
  WHERE ((b.id = tareas_bloque.bloque_id) AND (b.company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('tareas_personal', 'delete')) )))))));
DROP POLICY IF EXISTS tareas_bloque_insert ON public.tareas_bloque;
CREATE POLICY tareas_bloque_insert ON public.tareas_bloque
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((estado = 'pendiente'::text) AND (completada_en IS NULL) AND (completado_por IS NULL) AND (anulada_en IS NULL) AND (anulada_por IS NULL) AND (motivo_anulacion IS NULL) AND (motivo_sin_evidencia IS NULL) AND (( SELECT is_super_admin() AS is_super_admin) OR (EXISTS ( SELECT 1
   FROM bloques_turno b
  WHERE ((b.id = tareas_bloque.bloque_id) AND (b.company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (( SELECT (public.condominios_puede_actuar('tareas_personal', 'create')) ) OR ( SELECT (public.condominios_puede_actuar('tareas_personal', 'create')) ) OR ( SELECT (public.condominios_puede_actuar('tareas_personal', 'create')) )))))))));
DROP POLICY IF EXISTS tareas_bloque_update ON public.tareas_bloque;
CREATE POLICY tareas_bloque_update ON public.tareas_bloque
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR (EXISTS ( SELECT 1
   FROM bloques_turno b
  WHERE ((b.id = tareas_bloque.bloque_id) AND (b.company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (( SELECT (public.condominios_puede_actuar('tareas_personal', 'edit') OR public.condominios_puede_actuar('prog_limpieza', 'edit') OR public.condominios_puede_actuar('revision_tareas', 'edit')) ) OR ( SELECT (public.condominios_puede_actuar('tareas_personal', 'edit') OR public.condominios_puede_actuar('prog_limpieza', 'edit') OR public.condominios_puede_actuar('revision_tareas', 'edit')) ) OR ( SELECT (public.condominios_puede_actuar('tareas_personal', 'edit') OR public.condominios_puede_actuar('prog_limpieza', 'edit') OR public.condominios_puede_actuar('revision_tareas', 'edit')) ) OR ( SELECT (public.condominios_puede_actuar('tareas_personal', 'edit') OR public.condominios_puede_actuar('prog_limpieza', 'edit') OR public.condominios_puede_actuar('revision_tareas', 'edit')) ))))))))
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR (EXISTS ( SELECT 1
   FROM bloques_turno b
  WHERE ((b.id = tareas_bloque.bloque_id) AND (b.company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (( SELECT (public.condominios_puede_actuar('tareas_personal', 'edit') OR public.condominios_puede_actuar('prog_limpieza', 'edit') OR public.condominios_puede_actuar('revision_tareas', 'edit')) ) OR ( SELECT (public.condominios_puede_actuar('tareas_personal', 'edit') OR public.condominios_puede_actuar('prog_limpieza', 'edit') OR public.condominios_puede_actuar('revision_tareas', 'edit')) ) OR ( SELECT (public.condominios_puede_actuar('tareas_personal', 'edit') OR public.condominios_puede_actuar('prog_limpieza', 'edit') OR public.condominios_puede_actuar('revision_tareas', 'edit')) ) OR ( SELECT (public.condominios_puede_actuar('tareas_personal', 'edit') OR public.condominios_puede_actuar('prog_limpieza', 'edit') OR public.condominios_puede_actuar('revision_tareas', 'edit')) ))))))));

-- ── tareas_condominio ───────────────────────────────────────────────────────
--   INSERT tareas_cond.create
--   UPDATE tareas_cond.edit
--   DELETE tareas_cond.delete
DROP POLICY IF EXISTS tareas_condominio_delete ON public.tareas_condominio;
CREATE POLICY tareas_condominio_delete ON public.tareas_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('tareas_cond', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS tareas_condominio_insert ON public.tareas_condominio;
CREATE POLICY tareas_condominio_insert ON public.tareas_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('tareas_cond', 'create')) ))));
DROP POLICY IF EXISTS tareas_condominio_update ON public.tareas_condominio;
CREATE POLICY tareas_condominio_update ON public.tareas_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('tareas_cond', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('tareas_cond', 'edit')) )))
);

-- ── Guarda de postcondición ────────────────────────────────────────────────────
-- Ninguna policy de escritura de estas tablas conserva la visibilidad del tab
-- ni el rol como permiso, y todas las reescritas exigen una acción. Una
-- policy permisiva de más se uniría con OR y volvería opcional la acción: el
-- número de policies de escritura por tabla tiene que ser el de antes.
DO $$
DECLARE
  v_t text; v_n int; v_total int; v_esperado int; v_esperado_total int; v_mal text;
BEGIN
  FOR v_t, v_esperado, v_esperado_total IN SELECT * FROM (VALUES
    ('asignaciones_turno', 3, 3),
    ('ausencias_personal', 3, 3),
    ('capacitacion_personal_cond', 3, 3),
    ('dias_no_laborables', 3, 3),
    ('ejecuciones_limpieza', 2, 3),
    ('personal_condominio', 3, 3),
    ('plantilla_cupos_pausa', 3, 3),
    ('plantilla_tarea_herramientas', 3, 3),
    ('plantilla_tarea_suministros', 3, 3),
    ('plantillas_horario', 3, 3),
    ('plantillas_tarea_cargo', 3, 3),
    ('presencia_personal', 3, 3),
    ('programacion_limpieza', 3, 3),
    ('revisiones_tarea', 3, 3),
    ('rutina_actividades', 3, 3),
    ('rutina_areas', 3, 3),
    ('rutinas_limpieza', 3, 3),
    ('tarea_bloque_suministros', 2, 2),
    ('tareas_bloque', 3, 3),
    ('tareas_condominio', 3, 3)
  ) AS e(tabla, n, total) LOOP
    SELECT count(*) FILTER (WHERE coalesce(qual, '') || coalesce(with_check, '') ~ 'condominios_puede_actuar'),
           count(*),
           string_agg(policyname, ', ') FILTER (WHERE coalesce(qual, '') || coalesce(with_check, '') ~ $r$user_has_permission\(\s*('condominios\.tab\.|CASE)|ARRAY\['company_owner'::text, 'admin'::text\]$r$)
      INTO v_n, v_total, v_mal
    FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t AND cmd <> 'SELECT';
    IF v_mal IS NOT NULL THEN
      RAISE EXCEPTION 'acciones por permiso: % conserva visibilidad o rol como permiso de escritura en: %', v_t, v_mal;
    END IF;
    IF v_n <> v_esperado THEN
      RAISE EXCEPTION 'acciones por permiso: % tiene % policies de escritura por acción (se esperaban %)', v_t, v_n, v_esperado;
    END IF;
    IF v_total <> v_esperado_total THEN
      RAISE EXCEPTION 'acciones por permiso: % tiene % policies de escritura (se esperaban %): una de más se uniría con OR', v_t, v_total, v_esperado_total;
    END IF;
  END LOOP;
END $$;
