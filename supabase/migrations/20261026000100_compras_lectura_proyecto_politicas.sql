-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · ÓRDENES Y RECEPCIONES: LA LECTURA RESPETA EL PROYECTO
-- (cierre técnico del circuito de compras y contabilidad · 2/3)
--
-- QUÉ FALLABA
-- `ordenes_compra`, `orden_compra_lineas`, `recepciones` y `recepcion_lineas`
-- se leían con `company_id = get_my_company_id() OR is_super_admin()`: el
-- personal de un proyecto leía por la API de tablas las órdenes (con sus precios)
-- y recepciones de TODOS los proyectos de la empresa. El seguimiento por RPC sí
-- filtraba por proyecto, y el código de la interfaz asume que la RLS lo hace
-- (`useActividadProveedorQuery`: «la RLS de cada tabla decide además qué filas
-- llegan (empresa, proyecto)»), pero la tabla no lo hacía. Las tablas del mismo
-- circuito creadas después (`orden_compra_eventos`, `orden_compra_excepciones`,
-- `recepcion_respaldos`, `compras_linea_importaciones`) ya usaban
-- `can_access_project`.
--
-- QUÉ CAMBIA
-- SELECT de órdenes y recepciones = empresa propia + acceso al proyecto
-- (`can_access_project`; sin proyecto sellado = contabilidad de la empresa, visible
-- para la empresa, como en el resto de tablas del circuito). Los renglones heredan
-- la visibilidad de su orden / recepción con un EXISTS.
--
-- LO QUE A PROPÓSITO NO SE EXIGE AQUÍ: un permiso de «ver compras». Operaciones
-- (`condominios.tab.ordenes_compra`) y Contabilidad (`platform.contabilidad.view`)
-- las leen, pero también las leen la evaluación de proveedores y el seguimiento de
-- contratos desde pestañas que NO son la de órdenes; exigir solo el permiso de la
-- pestaña de órdenes rompería a esos consumidores. Queda documentado como brecha
-- residual en docs/COMPRAS_CIERRE_TECNICO.md (con la propuesta: mapear el conjunto
-- de pestañas legítimas y exigirlo en otra serie). Lo financiero que cuelga de una
-- orden (facturas, pagos, asientos) SÍ queda cerrado por permiso en la migración
-- anterior.
--
-- NO CAMBIA: las políticas de escritura, `mfa_gate_aal2`, las funciones y triggers
-- SECURITY DEFINER (propietario de las tablas) ni la llave de servicio.
--
-- CÓMO REVERTIR (por tabla):
--     DROP POLICY <t>_select ON public.<t>;
--     CREATE POLICY <t>_select ON public.<t> FOR SELECT TO authenticated
--       USING ((company_id = get_my_company_id()) OR is_super_admin());
-- IMPACTO EN DATOS: ninguno.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS ordenes_compra_select ON public.ordenes_compra;
CREATE POLICY ordenes_compra_select ON public.ordenes_compra FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (project_id IS NULL OR public.can_access_project(project_id)))
  );

DROP POLICY IF EXISTS recepciones_select ON public.recepciones;
CREATE POLICY recepciones_select ON public.recepciones FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (project_id IS NULL OR public.can_access_project(project_id)))
  );

-- Los renglones heredan la visibilidad del documento (el EXISTS se evalúa con la
-- RLS del padre: empresa + proyecto).
DROP POLICY IF EXISTS orden_compra_lineas_select ON public.orden_compra_lineas;
CREATE POLICY orden_compra_lineas_select ON public.orden_compra_lineas FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND EXISTS (SELECT 1 FROM public.ordenes_compra o WHERE o.id = orden_compra_id))
  );

DROP POLICY IF EXISTS recepcion_lineas_select ON public.recepcion_lineas;
CREATE POLICY recepcion_lineas_select ON public.recepcion_lineas FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND EXISTS (SELECT 1 FROM public.recepciones r WHERE r.id = recepcion_id))
  );
