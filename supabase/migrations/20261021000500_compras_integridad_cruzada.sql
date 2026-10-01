-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · BLOQUE B · NADA SE CRUZA ENTRE EMPRESA, PROVEEDOR NI CONTABILIDAD
--
-- EL HUECO (encontrado al probar el acceso cruzado del Bloque B)
-- Las policies de `recepciones` y `facturas_proveedor` solo exigen que la FILA
-- sea de la empresa de quien escribe (`company_id = get_my_company_id()`); nada
-- exigía que la ORDEN a la que apuntan sea de esa misma empresa, proveedor y
-- contabilidad. Un administrador de la empresa D podía insertar una recepción
-- (o una factura) propia que referenciara una orden de la empresa C: al
-- registrarla, los triggers —SECURITY DEFINER— sumaban recibido/facturado a las
-- líneas de la orden AJENA y asentaban en los libros de D.
--
-- QUÉ HACE (solo valida; no modifica filas)
--   · recepciones: la orden es de la misma empresa y de la misma contabilidad
--     (proyecto o empresa) que la recepción.
--   · recepcion_lineas: la línea de orden pertenece a LA orden de su recepción.
--   · facturas_proveedor con orden: misma empresa, mismo proveedor y misma
--     contabilidad que la orden. Cruzar contabilidades exigiría una distribución
--     que NO existe y que requiere decisión (ver docs): se rechaza, no se
--     distribuye en silencio.
--   · factura_proveedor_lineas: la línea de orden pertenece a la orden de la
--     factura.
-- Las escrituras del sistema (`conta.allow_system_write`) quedan fuera.
--
-- CÓMO REVERTIR: DROP TRIGGER trg_compras_integridad_{recepcion,recepcion_linea,
--   factura,factura_linea} …; DROP FUNCTION public.compras_tg_integridad_*();
-- IMPACTO EN DATOS: ninguno sobre filas existentes (solo triggers de escritura).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_tg_integridad_recepcion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_oc record;
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.orden_compra_id = OLD.orden_compra_id
     AND NEW.company_id = OLD.company_id AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN
    RETURN NEW;
  END IF;
  SELECT o.company_id, o.project_id INTO v_oc FROM public.ordenes_compra o WHERE o.id = NEW.orden_compra_id;
  IF NOT FOUND OR v_oc.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'COMPRAS_RECEPCION_ORDEN_AJENA: la orden no pertenece a la empresa de la recepción.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_oc.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'COMPRAS_RECEPCION_ORDEN_AJENA: la orden es de otra contabilidad (proyecto o empresa) que la recepción; no se mezclan.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_integridad_recepcion() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_compras_integridad_recepcion ON public.recepciones;
CREATE TRIGGER trg_compras_integridad_recepcion
  BEFORE INSERT OR UPDATE ON public.recepciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_integridad_recepcion();

CREATE OR REPLACE FUNCTION public.compras_tg_integridad_recepcion_linea()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_orden uuid;
  v_ocl   record;
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  SELECT r.orden_compra_id INTO v_orden FROM public.recepciones r WHERE r.id = NEW.recepcion_id;
  SELECT l.orden_compra_id, l.company_id INTO v_ocl FROM public.orden_compra_lineas l WHERE l.id = NEW.orden_compra_linea_id;
  IF NOT FOUND OR v_ocl.orden_compra_id IS DISTINCT FROM v_orden OR v_ocl.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'COMPRAS_RECEPCION_LINEA_AJENA: la línea no es de la orden de esta recepción.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_integridad_recepcion_linea() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_compras_integridad_recepcion_linea ON public.recepcion_lineas;
CREATE TRIGGER trg_compras_integridad_recepcion_linea
  BEFORE INSERT OR UPDATE OF recepcion_id, orden_compra_linea_id, company_id ON public.recepcion_lineas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_integridad_recepcion_linea();

CREATE OR REPLACE FUNCTION public.compras_tg_integridad_factura()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_oc record;
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' OR NEW.orden_compra_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.orden_compra_id IS NOT DISTINCT FROM OLD.orden_compra_id
     AND NEW.proveedor_id = OLD.proveedor_id AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN
    RETURN NEW;
  END IF;
  SELECT o.company_id, o.project_id, o.proveedor_id INTO v_oc FROM public.ordenes_compra o WHERE o.id = NEW.orden_compra_id;
  IF NOT FOUND OR v_oc.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_ORDEN_AJENA: la orden no pertenece a la empresa de la factura.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_oc.proveedor_id IS DISTINCT FROM NEW.proveedor_id THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_ORDEN_AJENA: la orden es de otro proveedor que la factura.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_oc.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_ORDEN_AJENA: la orden es de otra contabilidad (proyecto o empresa) que la factura. Una compra que se reparte entre contabilidades requiere una decisión de distribución que no está implementada.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_integridad_factura() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_compras_integridad_factura ON public.facturas_proveedor;
CREATE TRIGGER trg_compras_integridad_factura
  BEFORE INSERT OR UPDATE ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_integridad_factura();

CREATE OR REPLACE FUNCTION public.compras_tg_integridad_factura_linea()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_orden uuid;
  v_ocl   record;
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on'
     OR NEW.orden_compra_linea_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT f.orden_compra_id INTO v_orden FROM public.facturas_proveedor f WHERE f.id = NEW.factura_id;
  SELECT l.orden_compra_id, l.company_id INTO v_ocl FROM public.orden_compra_lineas l WHERE l.id = NEW.orden_compra_linea_id;
  IF NOT FOUND OR v_orden IS NULL OR v_ocl.orden_compra_id IS DISTINCT FROM v_orden OR v_ocl.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_LINEA_AJENA: la línea no es de la orden de esta factura.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_integridad_factura_linea() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_compras_integridad_factura_linea ON public.factura_proveedor_lineas;
CREATE TRIGGER trg_compras_integridad_factura_linea
  BEFORE INSERT OR UPDATE OF factura_id, orden_compra_linea_id, company_id ON public.factura_proveedor_lineas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_integridad_factura_linea();
