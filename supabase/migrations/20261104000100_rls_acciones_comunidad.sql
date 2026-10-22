-- ════════════════════════════════════════════════════════════════════════════
-- Comunidad: escribir exige la ACCIÓN del tab, también en la base
--
-- POR QUÉ
-- La pantalla decide cada escritura de estos tabs con su acción (canCreate /
-- canEdit / canDelete). Las policies de INSERT y UPDATE sólo pedían ver el tab
-- —quien sólo consulta podía crear y editar por la API— y las de DELETE sólo
-- dejaban a company_owner/admin, aunque la pantalla le ofreciera «Eliminar» a
-- quien tuviera la acción: la RLS borraba cero filas sin error.
--
-- Tabs: Actas, Acuerdos, Agenda (y su calendario), Asambleas (puntos y votos),
-- Asamblea digital, Buzón de sugerencias, Comunicados (y el tablón de
-- Comunidad), Encuestas, Eventos de la comunidad, Infracciones, Junta,
-- Programa de actividades, Recordatorios, Sanciones y Votaciones.
--
-- QUÉ HACE (generado por scripts/rls-acciones/generar.mjs desde
-- supabase/rls-acciones/comunidad.json; no editar a mano)
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

-- ── actas_reunion ───────────────────────────────────────────────────────────
--   INSERT actas.create
--   UPDATE actas.edit
--   DELETE actas.delete
DROP POLICY IF EXISTS actas_reunion_delete ON public.actas_reunion;
CREATE POLICY actas_reunion_delete ON public.actas_reunion
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('actas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS actas_reunion_insert ON public.actas_reunion;
CREATE POLICY actas_reunion_insert ON public.actas_reunion
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('actas', 'create')) ))));
DROP POLICY IF EXISTS actas_reunion_update ON public.actas_reunion;
CREATE POLICY actas_reunion_update ON public.actas_reunion
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('actas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('actas', 'edit')) ))));

-- ── agenda_operativa ────────────────────────────────────────────────────────
--   INSERT agenda.create
--   UPDATE agenda.edit
--   DELETE agenda.delete
DROP POLICY IF EXISTS agenda_operativa_delete ON public.agenda_operativa;
CREATE POLICY agenda_operativa_delete ON public.agenda_operativa
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('agenda', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS agenda_operativa_insert ON public.agenda_operativa;
CREATE POLICY agenda_operativa_insert ON public.agenda_operativa
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('agenda', 'create')) ))));
DROP POLICY IF EXISTS agenda_operativa_update ON public.agenda_operativa;
CREATE POLICY agenda_operativa_update ON public.agenda_operativa
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('agenda', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('agenda', 'edit')) ))));

-- ── anuncios_comunidad ──────────────────────────────────────────────────────
--   INSERT comunicados.create · comunidad.create
--   UPDATE comunicados.edit · comunidad.edit
--   DELETE comunicados.delete · comunidad.delete
--   El tablón de Comunidad publica, activa/desactiva y borra anuncios con sus propias acciones; Comunicados los publica en el portal.
DROP POLICY IF EXISTS anuncios_comunidad_delete ON public.anuncios_comunidad;
CREATE POLICY anuncios_comunidad_delete ON public.anuncios_comunidad
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('comunicados', 'delete') OR public.condominios_puede_actuar('comunidad', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS anuncios_comunidad_insert ON public.anuncios_comunidad;
CREATE POLICY anuncios_comunidad_insert ON public.anuncios_comunidad
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('comunicados', 'create') OR public.condominios_puede_actuar('comunidad', 'create')) ))));
DROP POLICY IF EXISTS anuncios_comunidad_update ON public.anuncios_comunidad;
CREATE POLICY anuncios_comunidad_update ON public.anuncios_comunidad
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('comunicados', 'edit') OR public.condominios_puede_actuar('comunidad', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('comunicados', 'edit') OR public.condominios_puede_actuar('comunidad', 'edit')) ))));

-- ── asambleas_digital ───────────────────────────────────────────────────────
--   INSERT asamblea_digital.create
--   UPDATE asamblea_digital.edit
--   DELETE asamblea_digital.delete
DROP POLICY IF EXISTS asambleas_digital_delete ON public.asambleas_digital;
CREATE POLICY asambleas_digital_delete ON public.asambleas_digital
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('asamblea_digital', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS asambleas_digital_insert ON public.asambleas_digital;
CREATE POLICY asambleas_digital_insert ON public.asambleas_digital
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('asamblea_digital', 'create')) ))));
DROP POLICY IF EXISTS asambleas_digital_update ON public.asambleas_digital;
CREATE POLICY asambleas_digital_update ON public.asambleas_digital
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('asamblea_digital', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('asamblea_digital', 'edit')) ))));

-- ── comunicados_condominio ──────────────────────────────────────────────────
--   INSERT comunicados.create
--   UPDATE comunicados.edit
--   DELETE comunicados.delete
DROP POLICY IF EXISTS comunicados_condominio_delete ON public.comunicados_condominio;
CREATE POLICY comunicados_condominio_delete ON public.comunicados_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('comunicados', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS comunicados_condominio_insert ON public.comunicados_condominio;
CREATE POLICY comunicados_condominio_insert ON public.comunicados_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('comunicados', 'create')) ))));
DROP POLICY IF EXISTS comunicados_condominio_update ON public.comunicados_condominio;
CREATE POLICY comunicados_condominio_update ON public.comunicados_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('comunicados', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('comunicados', 'edit')) ))));

-- ── encuestas ───────────────────────────────────────────────────────────────
--   INSERT encuestas.create
--   UPDATE encuestas.edit
--   DELETE encuestas.delete
DROP POLICY IF EXISTS encuestas_delete ON public.encuestas;
CREATE POLICY encuestas_delete ON public.encuestas
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('encuestas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS encuestas_insert ON public.encuestas;
CREATE POLICY encuestas_insert ON public.encuestas
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('encuestas', 'create')) ))));
DROP POLICY IF EXISTS encuestas_update ON public.encuestas;
CREATE POLICY encuestas_update ON public.encuestas
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('encuestas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('encuestas', 'edit')) ))));

-- ── eventos_calendario ──────────────────────────────────────────────────────
--   INSERT agenda.create · calendario.create
--   UPDATE agenda.edit
--   DELETE agenda.delete · calendario.delete
--   Los eventos los crea y borra la pestaña Calendario, con sus propias acciones.
DROP POLICY IF EXISTS eventos_calendario_delete ON public.eventos_calendario;
CREATE POLICY eventos_calendario_delete ON public.eventos_calendario
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('agenda', 'delete') OR public.condominios_puede_actuar('calendario', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS eventos_calendario_insert ON public.eventos_calendario;
CREATE POLICY eventos_calendario_insert ON public.eventos_calendario
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('agenda', 'create') OR public.condominios_puede_actuar('calendario', 'create')) ))));
DROP POLICY IF EXISTS eventos_calendario_update ON public.eventos_calendario;
CREATE POLICY eventos_calendario_update ON public.eventos_calendario
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('agenda', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('agenda', 'edit')) ))));

-- ── eventos_comunidad ───────────────────────────────────────────────────────
--   INSERT eventos_comunidad.create
--   UPDATE eventos_comunidad.edit
--   DELETE eventos_comunidad.delete
DROP POLICY IF EXISTS eventos_comunidad_delete ON public.eventos_comunidad;
CREATE POLICY eventos_comunidad_delete ON public.eventos_comunidad
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('eventos_comunidad', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS eventos_comunidad_insert ON public.eventos_comunidad;
CREATE POLICY eventos_comunidad_insert ON public.eventos_comunidad
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('eventos_comunidad', 'create')) ))));
DROP POLICY IF EXISTS eventos_comunidad_update ON public.eventos_comunidad;
CREATE POLICY eventos_comunidad_update ON public.eventos_comunidad
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('eventos_comunidad', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('eventos_comunidad', 'edit')) ))));

-- ── infracciones_condominio ─────────────────────────────────────────────────
--   INSERT infracciones.create
--   UPDATE infracciones.edit · gestion_conflictos.edit
--   DELETE infracciones.delete
--   Gestión de conflictos avanza el estado de la infracción con canEdit('gestion_conflictos').
DROP POLICY IF EXISTS infracciones_condominio_delete ON public.infracciones_condominio;
CREATE POLICY infracciones_condominio_delete ON public.infracciones_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('infracciones', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS infracciones_condominio_insert ON public.infracciones_condominio;
CREATE POLICY infracciones_condominio_insert ON public.infracciones_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('infracciones', 'create')) ))));
DROP POLICY IF EXISTS infracciones_condominio_update ON public.infracciones_condominio;
CREATE POLICY infracciones_condominio_update ON public.infracciones_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('infracciones', 'edit') OR public.condominios_puede_actuar('gestion_conflictos', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('infracciones', 'edit') OR public.condominios_puede_actuar('gestion_conflictos', 'edit')) ))));

-- ── junta_directiva ─────────────────────────────────────────────────────────
--   INSERT junta.create
--   UPDATE junta.edit
--   DELETE junta.delete
DROP POLICY IF EXISTS junta_directiva_delete ON public.junta_directiva;
CREATE POLICY junta_directiva_delete ON public.junta_directiva
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('junta', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS junta_directiva_insert ON public.junta_directiva;
CREATE POLICY junta_directiva_insert ON public.junta_directiva
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('junta', 'create')) ))));
DROP POLICY IF EXISTS junta_directiva_update ON public.junta_directiva;
CREATE POLICY junta_directiva_update ON public.junta_directiva
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('junta', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('junta', 'edit')) ))));

-- ── programa_actividades ────────────────────────────────────────────────────
--   INSERT programa_actividades.create
--   UPDATE programa_actividades.edit
--   DELETE programa_actividades.delete
DROP POLICY IF EXISTS programa_actividades_delete ON public.programa_actividades;
CREATE POLICY programa_actividades_delete ON public.programa_actividades
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('programa_actividades', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS programa_actividades_insert ON public.programa_actividades;
CREATE POLICY programa_actividades_insert ON public.programa_actividades
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('programa_actividades', 'create')) ))));
DROP POLICY IF EXISTS programa_actividades_update ON public.programa_actividades;
CREATE POLICY programa_actividades_update ON public.programa_actividades
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('programa_actividades', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('programa_actividades', 'edit')) ))));

-- ── puntos_asamblea ─────────────────────────────────────────────────────────
--   INSERT asambleas.create · asambleas.edit
--   UPDATE asambleas.edit
--   DELETE asambleas.delete
--   «+ Punto» se ofrece con canEdit('asambleas'): agregar un punto a la agenda es editar la asamblea.
DROP POLICY IF EXISTS puntos_asamblea_delete ON public.puntos_asamblea;
CREATE POLICY puntos_asamblea_delete ON public.puntos_asamblea
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM asambleas a
  WHERE ((a.id = puntos_asamblea.asamblea_id) AND (a.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('asambleas', 'delete')) ))))));
DROP POLICY IF EXISTS puntos_asamblea_insert ON public.puntos_asamblea;
CREATE POLICY puntos_asamblea_insert ON public.puntos_asamblea
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM asambleas a
  WHERE ((a.id = puntos_asamblea.asamblea_id) AND (a.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('asambleas', 'create') OR public.condominios_puede_actuar('asambleas', 'edit')) ))))));
DROP POLICY IF EXISTS puntos_asamblea_update ON public.puntos_asamblea;
CREATE POLICY puntos_asamblea_update ON public.puntos_asamblea
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM asambleas a
  WHERE ((a.id = puntos_asamblea.asamblea_id) AND (a.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('asambleas', 'edit')) ))))))
  WITH CHECK ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM asambleas a
  WHERE ((a.id = puntos_asamblea.asamblea_id) AND (a.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('asambleas', 'edit')) ))))));

-- ── recordatorios_condominio ────────────────────────────────────────────────
--   INSERT recordatorios.create
--   UPDATE recordatorios.edit
--   DELETE recordatorios.delete
DROP POLICY IF EXISTS recordatorios_condominio_delete ON public.recordatorios_condominio;
CREATE POLICY recordatorios_condominio_delete ON public.recordatorios_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('recordatorios', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS recordatorios_condominio_insert ON public.recordatorios_condominio;
CREATE POLICY recordatorios_condominio_insert ON public.recordatorios_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('recordatorios', 'create')) ))));
DROP POLICY IF EXISTS recordatorios_condominio_update ON public.recordatorios_condominio;
CREATE POLICY recordatorios_condominio_update ON public.recordatorios_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('recordatorios', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('recordatorios', 'edit')) ))));

-- ── registro_asistentes_evento ──────────────────────────────────────────────
--   INSERT eventos_comunidad.create
--   UPDATE eventos_comunidad.edit · eventos_comunidad.create
--   DELETE eventos_comunidad.delete
--   «Agregar asistente» (canCreate) es un upsert por (evento, unidad): anotar de nuevo una unidad actualiza su fila.
DROP POLICY IF EXISTS registro_asistentes_evento_delete ON public.registro_asistentes_evento;
CREATE POLICY registro_asistentes_evento_delete ON public.registro_asistentes_evento
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('eventos_comunidad', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS registro_asistentes_evento_insert ON public.registro_asistentes_evento;
CREATE POLICY registro_asistentes_evento_insert ON public.registro_asistentes_evento
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('eventos_comunidad', 'create')) ))));
DROP POLICY IF EXISTS registro_asistentes_evento_update ON public.registro_asistentes_evento;
CREATE POLICY registro_asistentes_evento_update ON public.registro_asistentes_evento
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('eventos_comunidad', 'edit') OR public.condominios_puede_actuar('eventos_comunidad', 'create')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('eventos_comunidad', 'edit') OR public.condominios_puede_actuar('eventos_comunidad', 'create')) ))));

-- ── respuestas_encuesta ─────────────────────────────────────────────────────
--   INSERT encuestas.create
--   UPDATE encuestas.edit
--   DELETE encuestas.delete
DROP POLICY IF EXISTS respuestas_encuesta_delete ON public.respuestas_encuesta;
CREATE POLICY respuestas_encuesta_delete ON public.respuestas_encuesta
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('encuestas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS respuestas_encuesta_insert ON public.respuestas_encuesta;
CREATE POLICY respuestas_encuesta_insert ON public.respuestas_encuesta
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('encuestas', 'create')) ))));
DROP POLICY IF EXISTS respuestas_encuesta_update ON public.respuestas_encuesta;
CREATE POLICY respuestas_encuesta_update ON public.respuestas_encuesta
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('encuestas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('encuestas', 'edit')) ))));

-- ── sanciones_condominio ────────────────────────────────────────────────────
--   INSERT sanciones.create
--   UPDATE sanciones.edit
--   DELETE sanciones.delete
DROP POLICY IF EXISTS sanciones_condominio_delete ON public.sanciones_condominio;
CREATE POLICY sanciones_condominio_delete ON public.sanciones_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('sanciones', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS sanciones_condominio_insert ON public.sanciones_condominio;
CREATE POLICY sanciones_condominio_insert ON public.sanciones_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('sanciones', 'create')) ))));
DROP POLICY IF EXISTS sanciones_condominio_update ON public.sanciones_condominio;
CREATE POLICY sanciones_condominio_update ON public.sanciones_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('sanciones', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('sanciones', 'edit')) ))));

-- ── seguimiento_acuerdos ────────────────────────────────────────────────────
--   INSERT acuerdos.create
--   UPDATE acuerdos.edit
--   DELETE acuerdos.delete
DROP POLICY IF EXISTS seguimiento_acuerdos_delete ON public.seguimiento_acuerdos;
CREATE POLICY seguimiento_acuerdos_delete ON public.seguimiento_acuerdos
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('acuerdos', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS seguimiento_acuerdos_insert ON public.seguimiento_acuerdos;
CREATE POLICY seguimiento_acuerdos_insert ON public.seguimiento_acuerdos
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('acuerdos', 'create')) ))));
DROP POLICY IF EXISTS seguimiento_acuerdos_update ON public.seguimiento_acuerdos;
CREATE POLICY seguimiento_acuerdos_update ON public.seguimiento_acuerdos
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('acuerdos', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('acuerdos', 'edit')) ))));

-- ── sugerencias_condominio ──────────────────────────────────────────────────
--   INSERT buzon_sugerencias.create
--   UPDATE buzon_sugerencias.edit · gestion_conflictos.edit
--   DELETE buzon_sugerencias.delete
--   Gestión de conflictos responde y archiva sugerencias con canEdit('gestion_conflictos').
DROP POLICY IF EXISTS sugerencias_condominio_delete ON public.sugerencias_condominio;
CREATE POLICY sugerencias_condominio_delete ON public.sugerencias_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('buzon_sugerencias', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS sugerencias_condominio_insert ON public.sugerencias_condominio;
CREATE POLICY sugerencias_condominio_insert ON public.sugerencias_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('buzon_sugerencias', 'create')) ))));
DROP POLICY IF EXISTS sugerencias_condominio_update ON public.sugerencias_condominio;
CREATE POLICY sugerencias_condominio_update ON public.sugerencias_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('buzon_sugerencias', 'edit') OR public.condominios_puede_actuar('gestion_conflictos', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('buzon_sugerencias', 'edit') OR public.condominios_puede_actuar('gestion_conflictos', 'edit')) ))));

-- ── votaciones ──────────────────────────────────────────────────────────────
--   INSERT votaciones.create
--   UPDATE votaciones.edit
--   DELETE votaciones.delete
DROP POLICY IF EXISTS votaciones_delete ON public.votaciones;
CREATE POLICY votaciones_delete ON public.votaciones
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('votaciones', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS votaciones_insert ON public.votaciones;
CREATE POLICY votaciones_insert ON public.votaciones
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('votaciones', 'create')) ))));
DROP POLICY IF EXISTS votaciones_update ON public.votaciones;
CREATE POLICY votaciones_update ON public.votaciones
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('votaciones', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('votaciones', 'edit')) ))));

-- ── votos ───────────────────────────────────────────────────────────────────
--   INSERT votaciones.create
--   UPDATE sin policy: nadie (no se crea)
--   DELETE votaciones.delete
DROP POLICY IF EXISTS votos_delete ON public.votos;
CREATE POLICY votos_delete ON public.votos
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('votaciones', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS votos_insert ON public.votos;
CREATE POLICY votos_insert ON public.votos
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('votaciones', 'create')) ))));

-- ── votos_asamblea ──────────────────────────────────────────────────────────
--   INSERT votaciones.create · asambleas.edit
--   UPDATE votaciones.edit · asambleas.edit
--   DELETE votaciones.delete
--   Asambleas registra el voto de cada unidad (upsert por punto y unidad) con canEdit('asambleas').
DROP POLICY IF EXISTS votos_asamblea_delete ON public.votos_asamblea;
CREATE POLICY votos_asamblea_delete ON public.votos_asamblea
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM (puntos_asamblea p
     JOIN asambleas a ON ((a.id = p.asamblea_id)))
  WHERE ((p.id = votos_asamblea.punto_id) AND (a.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('votaciones', 'delete')) ))))));
DROP POLICY IF EXISTS votos_asamblea_insert ON public.votos_asamblea;
CREATE POLICY votos_asamblea_insert ON public.votos_asamblea
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM (puntos_asamblea p
     JOIN asambleas a ON ((a.id = p.asamblea_id)))
  WHERE ((p.id = votos_asamblea.punto_id) AND (a.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('votaciones', 'create') OR public.condominios_puede_actuar('asambleas', 'edit')) ))))));
DROP POLICY IF EXISTS votos_asamblea_update ON public.votos_asamblea;
CREATE POLICY votos_asamblea_update ON public.votos_asamblea
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM (puntos_asamblea p
     JOIN asambleas a ON ((a.id = p.asamblea_id)))
  WHERE ((p.id = votos_asamblea.punto_id) AND (a.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('votaciones', 'edit') OR public.condominios_puede_actuar('asambleas', 'edit')) ))))))
  WITH CHECK ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM (puntos_asamblea p
     JOIN asambleas a ON ((a.id = p.asamblea_id)))
  WHERE ((p.id = votos_asamblea.punto_id) AND (a.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('votaciones', 'edit') OR public.condominios_puede_actuar('asambleas', 'edit')) )))))
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
    ('actas_reunion', 3, 3),
    ('agenda_operativa', 3, 3),
    ('anuncios_comunidad', 3, 3),
    ('asambleas_digital', 3, 4),
    ('comunicados_condominio', 3, 3),
    ('encuestas', 3, 3),
    ('eventos_calendario', 3, 3),
    ('eventos_comunidad', 3, 3),
    ('infracciones_condominio', 3, 3),
    ('junta_directiva', 3, 3),
    ('programa_actividades', 3, 3),
    ('puntos_asamblea', 3, 4),
    ('recordatorios_condominio', 3, 3),
    ('registro_asistentes_evento', 3, 3),
    ('respuestas_encuesta', 3, 3),
    ('sanciones_condominio', 3, 3),
    ('seguimiento_acuerdos', 3, 3),
    ('sugerencias_condominio', 3, 3),
    ('votaciones', 3, 3),
    ('votos', 2, 2),
    ('votos_asamblea', 3, 4)
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
