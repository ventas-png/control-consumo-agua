-- ════════════════════════════════════════════════════════════════════════════
-- Casos especiales: escribir exige la ACCIÓN del tab, también en la base
--
-- POR QUÉ
-- La pantalla decide cada escritura de estos tabs con su acción (canCreate /
-- canEdit / canDelete). Las policies de INSERT y UPDATE sólo pedían ver el tab
-- —quien sólo consulta podía crear y editar por la API—, y las de DELETE sólo
-- dejaban a company_owner/admin, aunque la pantalla ofreciera «Eliminar».
--
-- Son las tablas que quedaron fuera de su sección: Arrendamientos, Convenios
-- de pago, Gastos (Contabilidad), Huéspedes y reservas de renta corta,
-- Paquetería y Correspondencia, y Reglas de mora.
--
-- OTROS MÓDULOS. Clientes (contratos y reservas), Compras («Enlazar» un gasto
-- a su factura), Tarifas › Facturación (reglas de mora) y Cobros (convenios)
-- también escriben estas tablas, con permisos de su módulo. Para verlas ya
-- hacía falta el permiso del tab de condominios; para escribirlas, ahora, su
-- acción. No se amplía a nadie: quien no tenía el tab de condominios sigue
-- sin leerlas ni escribirlas.
--
-- Paquetería y Correspondencia comparten paquetes_recibidos: la policy elige
-- el tab por la clase de la fila (CASE clase). Cada rama pasa a pedir la
-- acción de su tab. Borrar correspondencia sigue siendo sólo de
-- company_owner (20260829000600: es la constancia de una notificación legal),
-- y la residente sigue viendo lo suyo.
--
-- Las ramas del residente (portal de rentas) no cambian.
--
-- QUÉ HACE (generado por scripts/rls-acciones/generar.mjs desde
-- supabase/rls-acciones/especiales.json; no editar a mano)
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

-- ── contratos_arrendamiento ─────────────────────────────────────────────────
--   INSERT arrendamientos.create
--   UPDATE arrendamientos.edit
--   DELETE arrendamientos.delete
--   Clientes también los escribe (ClienteRentasModal, con platform.clientes.edit/delete); como para
--   verlos, sigue haciendo falta el tab Arrendamientos. Aprobar una solicitud de renta crea el
--   contrato en una RPC SECURITY DEFINER (aprobar_solicitud_renta), que no pasa por RLS.
DROP POLICY IF EXISTS contratos_arrendamiento_delete ON public.contratos_arrendamiento;
CREATE POLICY contratos_arrendamiento_delete ON public.contratos_arrendamiento
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('arrendamientos', 'delete')) ) AND (company_id = get_my_company_id())) OR ((current_user_role() = 'cliente'::text) AND (EXISTS ( SELECT 1
   FROM solicitud_renta_unidad s
  WHERE ((s.cliente_id = get_my_cliente_id()) AND (s.unidad_id = contratos_arrendamiento.unidad_id) AND (s.company_id = contratos_arrendamiento.company_id) AND (s.estado = 'aprobada'::text) AND (COALESCE(s.tipo_aprobado, s.tipo_renta) = ANY (ARRAY['arrendamiento'::text, 'ambas'::text]))))))));
DROP POLICY IF EXISTS contratos_arrendamiento_insert ON public.contratos_arrendamiento;
CREATE POLICY contratos_arrendamiento_insert ON public.contratos_arrendamiento
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('arrendamientos', 'create')) )) OR ((current_user_role() = 'cliente'::text) AND (EXISTS ( SELECT 1
   FROM solicitud_renta_unidad s
  WHERE ((s.cliente_id = get_my_cliente_id()) AND (s.unidad_id = contratos_arrendamiento.unidad_id) AND (s.company_id = contratos_arrendamiento.company_id) AND (s.estado = 'aprobada'::text) AND (COALESCE(s.tipo_aprobado, s.tipo_renta) = ANY (ARRAY['arrendamiento'::text, 'ambas'::text]))))))));
DROP POLICY IF EXISTS contratos_arrendamiento_update ON public.contratos_arrendamiento;
CREATE POLICY contratos_arrendamiento_update ON public.contratos_arrendamiento
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('arrendamientos', 'edit')) )) OR ((current_user_role() = 'cliente'::text) AND (EXISTS ( SELECT 1
   FROM solicitud_renta_unidad s
  WHERE ((s.cliente_id = get_my_cliente_id()) AND (s.unidad_id = contratos_arrendamiento.unidad_id) AND (s.company_id = contratos_arrendamiento.company_id) AND (s.estado = 'aprobada'::text) AND (COALESCE(s.tipo_aprobado, s.tipo_renta) = ANY (ARRAY['arrendamiento'::text, 'ambas'::text]))))))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('arrendamientos', 'edit')) )) OR ((current_user_role() = 'cliente'::text) AND (EXISTS ( SELECT 1
   FROM solicitud_renta_unidad s
  WHERE ((s.cliente_id = get_my_cliente_id()) AND (s.unidad_id = contratos_arrendamiento.unidad_id) AND (s.company_id = contratos_arrendamiento.company_id) AND (s.estado = 'aprobada'::text) AND (COALESCE(s.tipo_aprobado, s.tipo_renta) = ANY (ARRAY['arrendamiento'::text, 'ambas'::text]))))))));

-- ── convenios_pago ──────────────────────────────────────────────────────────
--   INSERT convenios_cuota.create
--   UPDATE convenios_cuota.edit
--   DELETE convenios_cuota.delete
--   Ninguna pestaña de condominios la escribe: la escribe Cobros (crear un convenio y cambiar su
--   estado). Su policy pedía ver Convenios (convenios_cuota); ahora pide la acción de ese tab.
DROP POLICY IF EXISTS convenios_pago_delete ON public.convenios_pago;
CREATE POLICY convenios_pago_delete ON public.convenios_pago
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('convenios_cuota', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS convenios_pago_insert ON public.convenios_pago;
CREATE POLICY convenios_pago_insert ON public.convenios_pago
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('convenios_cuota', 'create')) ))));
DROP POLICY IF EXISTS convenios_pago_update ON public.convenios_pago;
CREATE POLICY convenios_pago_update ON public.convenios_pago
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('convenios_cuota', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('convenios_cuota', 'edit')) ))));

-- ── gastos_condominio ───────────────────────────────────────────────────────
--   INSERT contabilidad.create
--   UPDATE contabilidad.edit
--   DELETE contabilidad.delete
--   «Enlazar» un gasto a su factura (Compras, con platform.contabilidad.create) es editarlo: como para verlo, sigue haciendo falta el tab Gastos.
DROP POLICY IF EXISTS gastos_condominio_delete ON public.gastos_condominio;
CREATE POLICY gastos_condominio_delete ON public.gastos_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('contabilidad', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS gastos_condominio_insert ON public.gastos_condominio;
CREATE POLICY gastos_condominio_insert ON public.gastos_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('contabilidad', 'create')) ))));
DROP POLICY IF EXISTS gastos_condominio_update ON public.gastos_condominio;
CREATE POLICY gastos_condominio_update ON public.gastos_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('contabilidad', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('contabilidad', 'edit')) ))));

-- ── huespedes_str ───────────────────────────────────────────────────────────
--   INSERT str.create · str.edit
--   UPDATE str.edit · visitantes.create
--   DELETE str.delete · str.edit
--   Guardar una reserva —nueva con canCreate, existente con canEdit— agrega, cambia y quita sus
--   huéspedes. Registrar en Visitantes la entrada de un huésped (canCreate('visitantes')) lo enlaza
--   con su visita.
DROP POLICY IF EXISTS huespedes_str_delete ON public.huespedes_str;
CREATE POLICY huespedes_str_delete ON public.huespedes_str
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM reservas_str r
  WHERE ((r.id = huespedes_str.reserva_str_id) AND (r.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('str', 'delete') OR public.condominios_puede_actuar('str', 'edit')) )))) OR ((current_user_role() = 'cliente'::text) AND (EXISTS ( SELECT 1
   FROM (reservas_str r
     JOIN solicitud_renta_unidad s ON (((s.unidad_id = r.unidad_id) AND (s.company_id = r.company_id))))
  WHERE ((r.id = huespedes_str.reserva_str_id) AND (s.cliente_id = get_my_cliente_id()) AND (s.estado = 'aprobada'::text) AND (COALESCE(s.tipo_aprobado, s.tipo_renta) = ANY (ARRAY['str'::text, 'ambas'::text]))))))));
DROP POLICY IF EXISTS huespedes_str_insert ON public.huespedes_str;
CREATE POLICY huespedes_str_insert ON public.huespedes_str
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM reservas_str r
  WHERE ((r.id = huespedes_str.reserva_str_id) AND (r.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('str', 'create') OR public.condominios_puede_actuar('str', 'edit')) )))) OR ((current_user_role() = 'cliente'::text) AND (EXISTS ( SELECT 1
   FROM (reservas_str r
     JOIN solicitud_renta_unidad s ON (((s.unidad_id = r.unidad_id) AND (s.company_id = r.company_id))))
  WHERE ((r.id = huespedes_str.reserva_str_id) AND (s.cliente_id = get_my_cliente_id()) AND (s.estado = 'aprobada'::text) AND (COALESCE(s.tipo_aprobado, s.tipo_renta) = ANY (ARRAY['str'::text, 'ambas'::text]))))))));
DROP POLICY IF EXISTS huespedes_str_update ON public.huespedes_str;
CREATE POLICY huespedes_str_update ON public.huespedes_str
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM reservas_str r
  WHERE ((r.id = huespedes_str.reserva_str_id) AND (r.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('str', 'edit') OR public.condominios_puede_actuar('visitantes', 'create')) )))) OR ((current_user_role() = 'cliente'::text) AND (EXISTS ( SELECT 1
   FROM (reservas_str r
     JOIN solicitud_renta_unidad s ON (((s.unidad_id = r.unidad_id) AND (s.company_id = r.company_id))))
  WHERE ((r.id = huespedes_str.reserva_str_id) AND (s.cliente_id = get_my_cliente_id()) AND (s.estado = 'aprobada'::text) AND (COALESCE(s.tipo_aprobado, s.tipo_renta) = ANY (ARRAY['str'::text, 'ambas'::text]))))))))
  WITH CHECK ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM reservas_str r
  WHERE ((r.id = huespedes_str.reserva_str_id) AND (r.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('str', 'edit') OR public.condominios_puede_actuar('visitantes', 'create')) )))) OR ((current_user_role() = 'cliente'::text) AND (EXISTS ( SELECT 1
   FROM (reservas_str r
     JOIN solicitud_renta_unidad s ON (((s.unidad_id = r.unidad_id) AND (s.company_id = r.company_id))))
  WHERE ((r.id = huespedes_str.reserva_str_id) AND (s.cliente_id = get_my_cliente_id()) AND (s.estado = 'aprobada'::text) AND (COALESCE(s.tipo_aprobado, s.tipo_renta) = ANY (ARRAY['str'::text, 'ambas'::text]))))))));

-- ── paquetes_recibidos ──────────────────────────────────────────────────────
--   INSERT paqueteria.create
--   UPDATE paqueteria.edit
--   DELETE paqueteria.delete
--   clase = 'correspondencia': INSERT correspondencia.create / UPDATE correspondencia.edit / DELETE sin sustituir
--   Borrar correspondencia sigue siendo sólo de company_owner: ninguna pantalla lo ofrece, y
--   retirarla de la operación sin destruirla es archivarla (editar).
DROP POLICY IF EXISTS paquetes_recibidos_delete ON public.paquetes_recibidos;
CREATE POLICY paquetes_recibidos_delete ON public.paquetes_recibidos
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND
CASE clase
    WHEN 'correspondencia'::text THEN (current_user_role() = 'company_owner'::text)
    ELSE ( SELECT (public.condominios_puede_actuar('paqueteria', 'delete')) )
END)));
DROP POLICY IF EXISTS paquetes_recibidos_insert ON public.paquetes_recibidos;
CREATE POLICY paquetes_recibidos_insert ON public.paquetes_recibidos
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND CASE clase
    WHEN 'correspondencia'::text THEN ( SELECT (public.condominios_puede_actuar('correspondencia', 'create')) )
    ELSE ( SELECT (public.condominios_puede_actuar('paqueteria', 'create')) )
END)));
DROP POLICY IF EXISTS paquetes_recibidos_update ON public.paquetes_recibidos;
CREATE POLICY paquetes_recibidos_update ON public.paquetes_recibidos
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND CASE clase
    WHEN 'correspondencia'::text THEN ( SELECT (public.condominios_puede_actuar('correspondencia', 'edit')) )
    ELSE ( SELECT (public.condominios_puede_actuar('paqueteria', 'edit')) )
END)))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND CASE clase
    WHEN 'correspondencia'::text THEN ( SELECT (public.condominios_puede_actuar('correspondencia', 'edit')) )
    ELSE ( SELECT (public.condominios_puede_actuar('paqueteria', 'edit')) )
END)));

-- ── reglas_mora_config ──────────────────────────────────────────────────────
--   INSERT reglas_mora.create
--   UPDATE reglas_mora.edit
--   DELETE reglas_mora.delete
--   Tarifas › Facturación también las escribe (con agua.tarifas.edit); como para verlas, sigue haciendo falta el tab Reglas de mora.
DROP POLICY IF EXISTS reglas_mora_config_delete ON public.reglas_mora_config;
CREATE POLICY reglas_mora_config_delete ON public.reglas_mora_config
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('reglas_mora', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS reglas_mora_config_insert ON public.reglas_mora_config;
CREATE POLICY reglas_mora_config_insert ON public.reglas_mora_config
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('reglas_mora', 'create')) ))));
DROP POLICY IF EXISTS reglas_mora_config_update ON public.reglas_mora_config;
CREATE POLICY reglas_mora_config_update ON public.reglas_mora_config
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('reglas_mora', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('reglas_mora', 'edit')) ))));

-- ── reservas_str ────────────────────────────────────────────────────────────
--   INSERT str.create
--   UPDATE str.edit
--   DELETE str.delete
--   Clientes también las escribe (ClienteRentasModal); como para verlas, sigue haciendo falta el
--   tab Renta corta. La carga masiva inserta con str_reservas_importar_aplicar, SECURITY INVOKER,
--   que ya exigía la misma regla que canCreate('str') (str_import_puede_crear).
DROP POLICY IF EXISTS reservas_str_delete ON public.reservas_str;
CREATE POLICY reservas_str_delete ON public.reservas_str
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('str', 'delete')) ) AND (company_id = get_my_company_id())) OR ((current_user_role() = 'cliente'::text) AND (EXISTS ( SELECT 1
   FROM solicitud_renta_unidad s
  WHERE ((s.cliente_id = get_my_cliente_id()) AND (s.unidad_id = reservas_str.unidad_id) AND (s.company_id = reservas_str.company_id) AND (s.estado = 'aprobada'::text) AND (COALESCE(s.tipo_aprobado, s.tipo_renta) = ANY (ARRAY['str'::text, 'ambas'::text]))))))));
DROP POLICY IF EXISTS reservas_str_insert ON public.reservas_str;
CREATE POLICY reservas_str_insert ON public.reservas_str
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('str', 'create')) )) OR ((current_user_role() = 'cliente'::text) AND (EXISTS ( SELECT 1
   FROM solicitud_renta_unidad s
  WHERE ((s.cliente_id = get_my_cliente_id()) AND (s.unidad_id = reservas_str.unidad_id) AND (s.company_id = reservas_str.company_id) AND (s.estado = 'aprobada'::text) AND (COALESCE(s.tipo_aprobado, s.tipo_renta) = ANY (ARRAY['str'::text, 'ambas'::text]))))))));
DROP POLICY IF EXISTS reservas_str_update ON public.reservas_str;
CREATE POLICY reservas_str_update ON public.reservas_str
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('str', 'edit')) )) OR ((current_user_role() = 'cliente'::text) AND (EXISTS ( SELECT 1
   FROM solicitud_renta_unidad s
  WHERE ((s.cliente_id = get_my_cliente_id()) AND (s.unidad_id = reservas_str.unidad_id) AND (s.company_id = reservas_str.company_id) AND (s.estado = 'aprobada'::text) AND (COALESCE(s.tipo_aprobado, s.tipo_renta) = ANY (ARRAY['str'::text, 'ambas'::text]))))))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('str', 'edit')) )) OR ((current_user_role() = 'cliente'::text) AND (EXISTS ( SELECT 1
   FROM solicitud_renta_unidad s
  WHERE ((s.cliente_id = get_my_cliente_id()) AND (s.unidad_id = reservas_str.unidad_id) AND (s.company_id = reservas_str.company_id) AND (s.estado = 'aprobada'::text) AND (COALESCE(s.tipo_aprobado, s.tipo_renta) = ANY (ARRAY['str'::text, 'ambas'::text])))))))
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
    ('contratos_arrendamiento', 3, 3),
    ('convenios_pago', 3, 3),
    ('gastos_condominio', 3, 3),
    ('huespedes_str', 3, 3),
    ('paquetes_recibidos', 3, 3),
    ('reglas_mora_config', 3, 3),
    ('reservas_str', 3, 3)
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
