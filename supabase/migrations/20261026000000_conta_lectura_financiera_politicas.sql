-- ════════════════════════════════════════════════════════════════════════════
-- CONTABILIDAD / COMPRAS · LA LECTURA FINANCIERA EXIGE PERMISO Y PROYECTO
-- (cierre técnico del circuito de compras y contabilidad · 1/3 de la serie
--  20261026000000 … 20261026000200)
--
-- QUÉ FALLABA
-- Las políticas SELECT de las tablas financieras decían, literalmente,
--     company_id = get_my_company_id() OR is_super_admin()
-- Es decir: CUALQUIER usuario autenticado de la empresa —un operador sin
-- permisos, un `viewer`, el personal de otro proyecto— leía por la API de tablas
-- (PostgREST) todas las facturas de proveedor, todo el libro diario y su detalle.
-- Las pantallas ya lo ocultaban (el módulo Contabilidad pide
-- `platform.contabilidad.view`; Seguimiento devuelve NULL en lo financiero sin
-- `prov_puede_ver_papeleria()`), pero ocultar columnas en la interfaz no protege
-- nada: la API directa no pasa por la interfaz. Medido en el sandbox: un `viewer`
-- de la empresa con asientos leía 1 192 asientos y 2 941 líneas. Además, las
-- funciones de reporte `SECURITY INVOKER` (balanza, libro mayor, estados
-- financieros, antigüedad de saldos) heredaban el hueco porque su única
-- autorización es esta RLS.
--
-- QUÉ CAMBIA
--   1. Helper `conta_puede_leer()`: «ve el módulo Contabilidad» = super admin, rol
--      de empresa con acceso total o permiso `platform.contabilidad.view`. Es
--      EXACTAMENTE `prov_puede_ver_papeleria()` (la regla que la interfaz espeja
--      en `usePermisosProveedor().verContabilidad`): se delega en ella para que
--      haya una sola definición de «quién ve Contabilidad».
--   2. SELECT de las tablas financieras = empresa propia + permiso de lectura
--      contable + acceso al proyecto (`can_access_project`; sin proyecto sellado =
--      contabilidad de la empresa, visible para quien tenga el permiso):
--        facturas_proveedor, contrasenas_pago, ordenes_pago, conta_asientos,
--        conta_cierres_anuales, conta_cuentas, conta_mapeo_cuentas
--      y, sin columna de proyecto, solo empresa + permiso:
--        conta_tipos_cambio, conta_duplicados_descartados.
--      Las tablas HIJAS (renglones de factura, líneas de asiento, facturas de una
--      contraseña) heredan la visibilidad de su padre con un EXISTS: quien no ve
--      la factura tampoco ve sus renglones, ni el asiento sus líneas.
--   3. `conta_borradores_sin_conversion()` (SECURITY DEFINER, devolvía borradores
--      del libro a cualquier usuario con acceso al proyecto) exige el permiso.
--
-- QUÉ NO CAMBIA
--   · Las políticas de escritura (INSERT/UPDATE/DELETE) y la política
--     restrictiva `mfa_gate_aal2` quedan como están.
--   · Los procesos automáticos: las funciones y triggers SECURITY DEFINER (propietario
--     de las tablas) y la llave de servicio (reportes programados, cron) no pasan
--     por RLS. Las RPC de Contabilidad con guardia propia (`conta_facturas_pendientes`,
--     `compras_seguimiento_*`, `compras_validar_match`…) siguen igual.
--   · Quién necesita qué (verificado en el código y en el sandbox): Contabilidad
--     (admin, owner, rol con `platform.contabilidad.view`) lee todo lo de arriba;
--     Operaciones lee órdenes y recepciones (serie 1/2) pero NO facturas, pagos ni
--     libro: ve lo financiero de una orden solo a través de `compras_seguimiento_*`,
--     que ya lo devuelve NULL sin permiso.
--
-- ⚠ PRECONDICIÓN DE DESPLIEGUE (consecuencia deliberada, no un efecto lateral)
-- El alcance por proyecto es el de la plataforma: un usuario con permiso contable
-- que NO sea exento (admin sin asignaciones, owner, super admin) solo ve las
-- contabilidades de los proyectos que tiene asignados, más la de la empresa.
-- Antes de aplicar en producción, listar con
--     scripts/diagnostico-lectura-financiera.sql
-- a quién le cambia el alcance (contabilidad.view sin asignaciones en una empresa
-- con proyectos) y asignarlo, o quedará viendo solo la contabilidad de la empresa.
--
-- CÓMO REVERTIR (por tabla, con la política anterior):
--     DROP POLICY <t>_select ON public.<t>;
--     CREATE POLICY <t>_select ON public.<t> FOR SELECT TO authenticated
--       USING ((company_id = get_my_company_id()) OR is_super_admin());
--   para las tablas listadas en el punto 2; las hijas igual (company_id + super
--   admin). Y volver a aplicar la definición de `conta_borradores_sin_conversion`
--   de 20261009000000 (sin la guardia). IMPACTO EN DATOS: ninguno (solo políticas
--   y una función).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Helper: «¿ve el módulo Contabilidad?» ────────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_puede_leer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.prov_puede_ver_papeleria()
$$;

COMMENT ON FUNCTION public.conta_puede_leer() IS
  'Lectura financiera (facturas, pagos, libro diario y catálogo): super admin, rol de empresa con acceso total o permiso platform.contabilidad.view. Delega en prov_puede_ver_papeleria() para que «quién ve Contabilidad» tenga una sola definición.';

REVOKE ALL ON FUNCTION public.conta_puede_leer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_puede_leer() TO authenticated;

-- ── 2. Tablas con columna de proyecto: empresa + permiso + proyecto ─────────
DROP POLICY IF EXISTS facturas_proveedor_select ON public.facturas_proveedor;
CREATE POLICY facturas_proveedor_select ON public.facturas_proveedor FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.conta_puede_leer())
        AND (project_id IS NULL OR public.can_access_project(project_id)))
  );

DROP POLICY IF EXISTS contrasenas_pago_select ON public.contrasenas_pago;
CREATE POLICY contrasenas_pago_select ON public.contrasenas_pago FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.conta_puede_leer())
        AND (project_id IS NULL OR public.can_access_project(project_id)))
  );

DROP POLICY IF EXISTS ordenes_pago_select ON public.ordenes_pago;
CREATE POLICY ordenes_pago_select ON public.ordenes_pago FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.conta_puede_leer())
        AND (project_id IS NULL OR public.can_access_project(project_id)))
  );

DROP POLICY IF EXISTS conta_asientos_select ON public.conta_asientos;
CREATE POLICY conta_asientos_select ON public.conta_asientos FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.conta_puede_leer())
        AND (project_id IS NULL OR public.can_access_project(project_id)))
  );

DROP POLICY IF EXISTS conta_cierres_anuales_select ON public.conta_cierres_anuales;
CREATE POLICY conta_cierres_anuales_select ON public.conta_cierres_anuales FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.conta_puede_leer())
        AND (project_id IS NULL OR public.can_access_project(project_id)))
  );

DROP POLICY IF EXISTS conta_cuentas_select ON public.conta_cuentas;
CREATE POLICY conta_cuentas_select ON public.conta_cuentas FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.conta_puede_leer())
        AND (project_id IS NULL OR public.can_access_project(project_id)))
  );

DROP POLICY IF EXISTS conta_mapeo_cuentas_select ON public.conta_mapeo_cuentas;
CREATE POLICY conta_mapeo_cuentas_select ON public.conta_mapeo_cuentas FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.conta_puede_leer())
        AND (project_id IS NULL OR public.can_access_project(project_id)))
  );

-- ── 3. Tablas sin columna de proyecto: empresa + permiso ────────────────────
DROP POLICY IF EXISTS conta_tipos_cambio_select ON public.conta_tipos_cambio;
CREATE POLICY conta_tipos_cambio_select ON public.conta_tipos_cambio FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.conta_puede_leer()))
  );

DROP POLICY IF EXISTS conta_duplicados_descartados_select ON public.conta_duplicados_descartados;
CREATE POLICY conta_duplicados_descartados_select ON public.conta_duplicados_descartados FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.conta_puede_leer()))
  );

-- ── 4. Tablas HIJAS: heredan la visibilidad de su padre ─────────────────────
-- El EXISTS se evalúa con la RLS del padre (empresa + permiso + proyecto): quien
-- no ve la factura no ve sus renglones; quien no ve el asiento no ve sus líneas.
DROP POLICY IF EXISTS factura_proveedor_lineas_select ON public.factura_proveedor_lineas;
CREATE POLICY factura_proveedor_lineas_select ON public.factura_proveedor_lineas FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.conta_puede_leer())
        AND EXISTS (SELECT 1 FROM public.facturas_proveedor f WHERE f.id = factura_id))
  );

DROP POLICY IF EXISTS conta_asiento_lineas_select ON public.conta_asiento_lineas;
CREATE POLICY conta_asiento_lineas_select ON public.conta_asiento_lineas FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.conta_puede_leer())
        AND EXISTS (SELECT 1 FROM public.conta_asientos a WHERE a.id = asiento_id))
  );

DROP POLICY IF EXISTS contrasena_pago_facturas_select ON public.contrasena_pago_facturas;
CREATE POLICY contrasena_pago_facturas_select ON public.contrasena_pago_facturas FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.conta_puede_leer())
        AND EXISTS (SELECT 1 FROM public.contrasenas_pago c WHERE c.id = contrasena_id))
  );

-- ── 5. RPC DEFINER que devolvía borradores del libro sin exigir permiso ─────
-- Misma función de 20261009000000 (mismo cuerpo, misma firma, mismos permisos de
-- ejecución): solo se añade la guardia de lectura contable.
CREATE OR REPLACE FUNCTION public.conta_borradores_sin_conversion()
RETURNS TABLE(asiento_id uuid, project_id uuid, fecha date, origen text, origen_tabla text, concepto text,
              moneda_origen text, moneda_base text, lineas integer, marca_antigua boolean,
              pendiente_nuevo boolean, periodo_asignado text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión con empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.conta_puede_leer() THEN
    RAISE EXCEPTION 'No autorizado: los borradores del libro los consulta quien tiene acceso de lectura a Contabilidad.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.id, a.project_id, a.fecha, a.origen, a.origen_tabla, a.concepto,
         (SELECT min(l.moneda_origen) FROM public.conta_asiento_lineas l
           WHERE l.asiento_id = a.id AND l.moneda_origen IS DISTINCT FROM a.moneda_base),
         a.moneda_base, public.conta_asiento_lineas_sin_convertir(a.id),
         a.concepto LIKE '%[SIN TIPO DE CAMBIO %', a.tipo_cambio_pendiente, a.tipo_cambio_periodo
    FROM public.conta_asientos a
   WHERE a.company_id = v_company AND a.estado = 'borrador'
     AND (a.project_id IS NULL OR public.can_access_project(a.project_id))
     AND (a.tipo_cambio_pendiente OR public.conta_asiento_lineas_sin_convertir(a.id) > 0)
   ORDER BY a.fecha, a.created_at;
END;
$$;
