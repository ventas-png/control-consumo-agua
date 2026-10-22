-- ════════════════════════════════════════════════════════════════════════════
-- Instalaciones: escribir exige la ACCIÓN del tab, también en la base
--
-- POR QUÉ
-- La pantalla decide cada escritura de estos tabs con su acción (canCreate /
-- canEdit / canDelete). Las policies de INSERT y UPDATE sólo pedían ver el tab
-- —quien sólo consulta podía crear y editar por la API— y las de DELETE sólo
-- dejaban a company_owner/admin, aunque la pantalla ofreciera «Eliminar» a
-- quien tuviera la acción. El UPDATE de reservas de amenidades ni siquiera
-- pedía ver el tab: bastaba ser de la empresa.
--
-- Tabs: Amenidades (con sus bloqueos y reservas), Bodegas, Consumo de energía,
-- Cámaras, Generador, Piscina, Sistema contra incendio, Equipos comunes,
-- Estacionamiento de visitas, Elevadores, Gas, Llaves, Cisternas, Jardinería,
-- Medidores por unidad y Parqueos.
--
-- QUÉ HACE (generado por scripts/rls-acciones/generar.mjs desde
-- supabase/rls-acciones/instalaciones.json; no editar a mano)
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

-- ── amenidades ──────────────────────────────────────────────────────────────
--   INSERT amenidades.create
--   UPDATE amenidades.edit
--   DELETE amenidades.delete
DROP POLICY IF EXISTS amenidades_delete ON public.amenidades;
CREATE POLICY amenidades_delete ON public.amenidades
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('amenidades', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS amenidades_insert ON public.amenidades;
CREATE POLICY amenidades_insert ON public.amenidades
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('amenidades', 'create')) ))));
DROP POLICY IF EXISTS amenidades_update ON public.amenidades;
CREATE POLICY amenidades_update ON public.amenidades
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('amenidades', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('amenidades', 'edit')) ))));

-- ── amenidades_bloqueos ─────────────────────────────────────────────────────
--   INSERT amenidades.create · amenidades.edit
--   UPDATE amenidades.edit
--   DELETE amenidades.delete
--   «+ Bloqueo» se ofrece con canEdit('amenidades'): bloquear una amenidad es editar su disponibilidad.
DROP POLICY IF EXISTS amenidades_bloqueos_delete ON public.amenidades_bloqueos;
CREATE POLICY amenidades_bloqueos_delete ON public.amenidades_bloqueos
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('amenidades', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS amenidades_bloqueos_insert ON public.amenidades_bloqueos;
CREATE POLICY amenidades_bloqueos_insert ON public.amenidades_bloqueos
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('amenidades', 'create') OR public.condominios_puede_actuar('amenidades', 'edit')) ))));
DROP POLICY IF EXISTS amenidades_bloqueos_update ON public.amenidades_bloqueos;
CREATE POLICY amenidades_bloqueos_update ON public.amenidades_bloqueos
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('amenidades', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('amenidades', 'edit')) ))));

-- ── bodegas_condominio ──────────────────────────────────────────────────────
--   INSERT bodegas.create
--   UPDATE bodegas.edit
--   DELETE bodegas.delete
DROP POLICY IF EXISTS bodegas_condominio_delete ON public.bodegas_condominio;
CREATE POLICY bodegas_condominio_delete ON public.bodegas_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('bodegas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS bodegas_condominio_insert ON public.bodegas_condominio;
CREATE POLICY bodegas_condominio_insert ON public.bodegas_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('bodegas', 'create')) ))));
DROP POLICY IF EXISTS bodegas_condominio_update ON public.bodegas_condominio;
CREATE POLICY bodegas_condominio_update ON public.bodegas_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('bodegas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('bodegas', 'edit')) ))));

-- ── consumo_energia_areas ───────────────────────────────────────────────────
--   INSERT consumo_energia.create
--   UPDATE consumo_energia.edit
--   DELETE consumo_energia.delete
DROP POLICY IF EXISTS consumo_energia_areas_delete ON public.consumo_energia_areas;
CREATE POLICY consumo_energia_areas_delete ON public.consumo_energia_areas
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('consumo_energia', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS consumo_energia_areas_insert ON public.consumo_energia_areas;
CREATE POLICY consumo_energia_areas_insert ON public.consumo_energia_areas
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('consumo_energia', 'create')) ))));
DROP POLICY IF EXISTS consumo_energia_areas_update ON public.consumo_energia_areas;
CREATE POLICY consumo_energia_areas_update ON public.consumo_energia_areas
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('consumo_energia', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('consumo_energia', 'edit')) ))));

-- ── control_camaras_seguridad ───────────────────────────────────────────────
--   INSERT camaras.create
--   UPDATE camaras.edit
--   DELETE camaras.delete
DROP POLICY IF EXISTS control_camaras_seguridad_delete ON public.control_camaras_seguridad;
CREATE POLICY control_camaras_seguridad_delete ON public.control_camaras_seguridad
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('camaras', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS control_camaras_seguridad_insert ON public.control_camaras_seguridad;
CREATE POLICY control_camaras_seguridad_insert ON public.control_camaras_seguridad
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('camaras', 'create')) ))));
DROP POLICY IF EXISTS control_camaras_seguridad_update ON public.control_camaras_seguridad;
CREATE POLICY control_camaras_seguridad_update ON public.control_camaras_seguridad
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('camaras', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('camaras', 'edit')) ))));

-- ── control_generador ───────────────────────────────────────────────────────
--   INSERT generador.create
--   UPDATE generador.edit
--   DELETE generador.delete
DROP POLICY IF EXISTS control_generador_delete ON public.control_generador;
CREATE POLICY control_generador_delete ON public.control_generador
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('generador', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS control_generador_insert ON public.control_generador;
CREATE POLICY control_generador_insert ON public.control_generador
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('generador', 'create')) ))));
DROP POLICY IF EXISTS control_generador_update ON public.control_generador;
CREATE POLICY control_generador_update ON public.control_generador
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('generador', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('generador', 'edit')) ))));

-- ── control_piscina ─────────────────────────────────────────────────────────
--   INSERT control_piscina.create
--   UPDATE control_piscina.edit
--   DELETE control_piscina.delete
DROP POLICY IF EXISTS control_piscina_delete ON public.control_piscina;
CREATE POLICY control_piscina_delete ON public.control_piscina
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('control_piscina', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS control_piscina_insert ON public.control_piscina;
CREATE POLICY control_piscina_insert ON public.control_piscina
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('control_piscina', 'create')) ))));
DROP POLICY IF EXISTS control_piscina_update ON public.control_piscina;
CREATE POLICY control_piscina_update ON public.control_piscina
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('control_piscina', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('control_piscina', 'edit')) ))));

-- ── control_sistema_incendio ────────────────────────────────────────────────
--   INSERT incendio.create
--   UPDATE incendio.edit
--   DELETE incendio.delete
DROP POLICY IF EXISTS control_sistema_incendio_delete ON public.control_sistema_incendio;
CREATE POLICY control_sistema_incendio_delete ON public.control_sistema_incendio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('incendio', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS control_sistema_incendio_insert ON public.control_sistema_incendio;
CREATE POLICY control_sistema_incendio_insert ON public.control_sistema_incendio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('incendio', 'create')) ))));
DROP POLICY IF EXISTS control_sistema_incendio_update ON public.control_sistema_incendio;
CREATE POLICY control_sistema_incendio_update ON public.control_sistema_incendio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('incendio', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('incendio', 'edit')) ))));

-- ── equipos_comunes ─────────────────────────────────────────────────────────
--   INSERT equipos.create
--   UPDATE equipos.edit
--   DELETE equipos.delete
DROP POLICY IF EXISTS equipos_comunes_delete ON public.equipos_comunes;
CREATE POLICY equipos_comunes_delete ON public.equipos_comunes
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('equipos', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS equipos_comunes_insert ON public.equipos_comunes;
CREATE POLICY equipos_comunes_insert ON public.equipos_comunes
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('equipos', 'create')) ))));
DROP POLICY IF EXISTS equipos_comunes_update ON public.equipos_comunes;
CREATE POLICY equipos_comunes_update ON public.equipos_comunes
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('equipos', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('equipos', 'edit')) ))));

-- ── estacionamiento_visita ──────────────────────────────────────────────────
--   INSERT estac_visita.create
--   UPDATE estac_visita.edit
--   DELETE estac_visita.delete
DROP POLICY IF EXISTS estacionamiento_visita_delete ON public.estacionamiento_visita;
CREATE POLICY estacionamiento_visita_delete ON public.estacionamiento_visita
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('estac_visita', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS estacionamiento_visita_insert ON public.estacionamiento_visita;
CREATE POLICY estacionamiento_visita_insert ON public.estacionamiento_visita
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('estac_visita', 'create')) ))));
DROP POLICY IF EXISTS estacionamiento_visita_update ON public.estacionamiento_visita;
CREATE POLICY estacionamiento_visita_update ON public.estacionamiento_visita
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('estac_visita', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('estac_visita', 'edit')) ))));

-- ── incidencias_elevador ────────────────────────────────────────────────────
--   INSERT elevadores.create
--   UPDATE elevadores.edit
--   DELETE elevadores.delete
DROP POLICY IF EXISTS incidencias_elevador_delete ON public.incidencias_elevador;
CREATE POLICY incidencias_elevador_delete ON public.incidencias_elevador
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('elevadores', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS incidencias_elevador_insert ON public.incidencias_elevador;
CREATE POLICY incidencias_elevador_insert ON public.incidencias_elevador
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('elevadores', 'create')) ))));
DROP POLICY IF EXISTS incidencias_elevador_update ON public.incidencias_elevador;
CREATE POLICY incidencias_elevador_update ON public.incidencias_elevador
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('elevadores', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('elevadores', 'edit')) ))));

-- ── lecturas_medidor_gas ────────────────────────────────────────────────────
--   INSERT gas.create
--   UPDATE gas.edit
--   DELETE gas.delete
DROP POLICY IF EXISTS lecturas_medidor_gas_delete ON public.lecturas_medidor_gas;
CREATE POLICY lecturas_medidor_gas_delete ON public.lecturas_medidor_gas
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('gas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS lecturas_medidor_gas_insert ON public.lecturas_medidor_gas;
CREATE POLICY lecturas_medidor_gas_insert ON public.lecturas_medidor_gas
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('gas', 'create')) ))));
DROP POLICY IF EXISTS lecturas_medidor_gas_update ON public.lecturas_medidor_gas;
CREATE POLICY lecturas_medidor_gas_update ON public.lecturas_medidor_gas
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('gas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('gas', 'edit')) ))));

-- ── llaves_condominio ───────────────────────────────────────────────────────
--   INSERT llaves.create
--   UPDATE llaves.edit
--   DELETE llaves.delete
DROP POLICY IF EXISTS llaves_condominio_delete ON public.llaves_condominio;
CREATE POLICY llaves_condominio_delete ON public.llaves_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('llaves', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS llaves_condominio_insert ON public.llaves_condominio;
CREATE POLICY llaves_condominio_insert ON public.llaves_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('llaves', 'create')) ))));
DROP POLICY IF EXISTS llaves_condominio_update ON public.llaves_condominio;
CREATE POLICY llaves_condominio_update ON public.llaves_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('llaves', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('llaves', 'edit')) ))));

-- ── mantenimiento_cisterna ──────────────────────────────────────────────────
--   INSERT cisternas.create
--   UPDATE cisternas.edit
--   DELETE cisternas.delete
DROP POLICY IF EXISTS mantenimiento_cisterna_delete ON public.mantenimiento_cisterna;
CREATE POLICY mantenimiento_cisterna_delete ON public.mantenimiento_cisterna
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('cisternas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS mantenimiento_cisterna_insert ON public.mantenimiento_cisterna;
CREATE POLICY mantenimiento_cisterna_insert ON public.mantenimiento_cisterna
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cisternas', 'create')) ))));
DROP POLICY IF EXISTS mantenimiento_cisterna_update ON public.mantenimiento_cisterna;
CREATE POLICY mantenimiento_cisterna_update ON public.mantenimiento_cisterna
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cisternas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cisternas', 'edit')) ))));

-- ── mantenimiento_jardineria ────────────────────────────────────────────────
--   INSERT jardineria.create
--   UPDATE jardineria.edit
--   DELETE jardineria.delete
DROP POLICY IF EXISTS mantenimiento_jardineria_delete ON public.mantenimiento_jardineria;
CREATE POLICY mantenimiento_jardineria_delete ON public.mantenimiento_jardineria
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('jardineria', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS mantenimiento_jardineria_insert ON public.mantenimiento_jardineria;
CREATE POLICY mantenimiento_jardineria_insert ON public.mantenimiento_jardineria
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('jardineria', 'create')) ))));
DROP POLICY IF EXISTS mantenimiento_jardineria_update ON public.mantenimiento_jardineria;
CREATE POLICY mantenimiento_jardineria_update ON public.mantenimiento_jardineria
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('jardineria', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('jardineria', 'edit')) ))));

-- ── medidores_unidad ────────────────────────────────────────────────────────
--   INSERT medidores_unidad.create
--   UPDATE medidores_unidad.edit
--   DELETE medidores_unidad.delete
DROP POLICY IF EXISTS medidores_unidad_delete ON public.medidores_unidad;
CREATE POLICY medidores_unidad_delete ON public.medidores_unidad
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('medidores_unidad', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS medidores_unidad_insert ON public.medidores_unidad;
CREATE POLICY medidores_unidad_insert ON public.medidores_unidad
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('medidores_unidad', 'create')) ))));
DROP POLICY IF EXISTS medidores_unidad_update ON public.medidores_unidad;
CREATE POLICY medidores_unidad_update ON public.medidores_unidad
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('medidores_unidad', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('medidores_unidad', 'edit')) ))));

-- ── parqueos_condominio ─────────────────────────────────────────────────────
--   INSERT parqueos.create
--   UPDATE parqueos.edit
--   DELETE parqueos.delete
DROP POLICY IF EXISTS parqueos_condominio_delete ON public.parqueos_condominio;
CREATE POLICY parqueos_condominio_delete ON public.parqueos_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('parqueos', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS parqueos_condominio_insert ON public.parqueos_condominio;
CREATE POLICY parqueos_condominio_insert ON public.parqueos_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('parqueos', 'create')) ))));
DROP POLICY IF EXISTS parqueos_condominio_update ON public.parqueos_condominio;
CREATE POLICY parqueos_condominio_update ON public.parqueos_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('parqueos', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('parqueos', 'edit')) ))));

-- ── reservas_amenidades ─────────────────────────────────────────────────────
--   INSERT amenidades.create
--   UPDATE amenidades.edit
--   DELETE amenidades.delete
--   El UPDATE sólo exigía la empresa (20260822030000 retiró la rama del residente, que reserva y
--   cancela por RPC): se le suma la acción. Check-in, check-out, depósito, aprobación, no-show,
--   tarifa pagada y recordatorio se ofrecen con canEdit('amenidades').
DROP POLICY IF EXISTS reservas_amenidades_delete ON public.reservas_amenidades;
CREATE POLICY reservas_amenidades_delete ON public.reservas_amenidades
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('amenidades', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS reservas_amenidades_insert ON public.reservas_amenidades;
CREATE POLICY reservas_amenidades_insert ON public.reservas_amenidades
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('amenidades', 'create')) ))));
DROP POLICY IF EXISTS reservas_amenidades_update ON public.reservas_amenidades;
CREATE POLICY reservas_amenidades_update ON public.reservas_amenidades
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('amenidades', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('amenidades', 'edit')) )))
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
    ('amenidades', 3, 3),
    ('amenidades_bloqueos', 3, 3),
    ('bodegas_condominio', 3, 3),
    ('consumo_energia_areas', 3, 3),
    ('control_camaras_seguridad', 3, 3),
    ('control_generador', 3, 3),
    ('control_piscina', 3, 3),
    ('control_sistema_incendio', 3, 3),
    ('equipos_comunes', 3, 3),
    ('estacionamiento_visita', 3, 3),
    ('incidencias_elevador', 3, 3),
    ('lecturas_medidor_gas', 3, 3),
    ('llaves_condominio', 3, 3),
    ('mantenimiento_cisterna', 3, 3),
    ('mantenimiento_jardineria', 3, 3),
    ('medidores_unidad', 3, 3),
    ('parqueos_condominio', 3, 3),
    ('reservas_amenidades', 3, 3)
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
