-- Portal propietario vs inquilino — FASE 2 · batch 2 (P1 · condominios).
--
-- Sigue repuntando policies SELECT del residente al helper `mis_unidades_ids()`.
-- PRESERVA LA CONDUCTA por construcción: ambas formas del subquery del residente
--   (a) inline:  unidad_id IN (SELECT id FROM unidades WHERE cliente_id = <app_users> AND activo)
--   (b) join:    unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id=u.cliente_id WHERE au.id=auth.uid() AND u.activo)
-- son IGUALES a mis_unidades_ids() (unidades de mi cliente, activas). Solo cambia esa
-- rama; is_super_admin() + el gate de permiso quedan intactos. Validado contra prod
-- vía BEGIN…ROLLBACK (las 4: usa_helper=true, sin app_users, staff intacto).
--
-- Batch 2 = paquetes_recibidos (forma inline) + mascotas/votos/reservas_amenidades
-- (forma join). Excluidas de esta tanda: las que scopean por project_id (amenidades:
-- necesitan un helper de proyectos) y las de agua (registros/contadores: scoping por
-- cliente/contador, diseño aparte). Siguen en batches posteriores.

DROP POLICY IF EXISTS paquetes_recibidos_select ON public.paquetes_recibidos;
CREATE POLICY paquetes_recibidos_select ON public.paquetes_recibidos
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.paqueteria'))
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  );

DROP POLICY IF EXISTS mascotas_select ON public.mascotas;
CREATE POLICY mascotas_select ON public.mascotas
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.mascotas'))
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  );

DROP POLICY IF EXISTS votos_select ON public.votos;
CREATE POLICY votos_select ON public.votos
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.votaciones'))
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  );

DROP POLICY IF EXISTS reservas_amenidades_select ON public.reservas_amenidades;
CREATE POLICY reservas_amenidades_select ON public.reservas_amenidades
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.amenidades'))
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  );
