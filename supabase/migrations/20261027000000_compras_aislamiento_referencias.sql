-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · AISLAMIENTO ENTRE EMPRESAS Y CONTABILIDADES EN LAS REFERENCIAS
-- (auditoría del circuito proveedor → orden → recepción → factura → pago)
--
-- QUÉ FALLABA (cada punto se reprodujo con un INSERT directo —el mismo camino que
-- PostgREST— como administrador de la empresa C contra datos de la empresa D, en un
-- PostgreSQL local con la cadena completa de migraciones)
--   Las políticas de INSERT de estas tablas solo comprueban `company_id = mi empresa`
--   en la FILA NUEVA. Nada comprobaba que lo que la fila REFERENCIA fuera de la misma
--   empresa (o del mismo proyecto). Resultado, aceptado por el servidor:
--     1. `ordenes_compra`, `facturas_proveedor`, `contrasenas_pago` y `ordenes_pago`
--        con el PROVEEDOR de otra empresa, y las tres primeras con el PROYECTO de otra
--        empresa.
--     2. Un renglón de la empresa C INSERTADO en la orden BORRADOR de la empresa D
--        (`orden_compra_lineas.orden_compra_id`): el trigger de totales recalculaba el
--        total de la orden AJENA.
--     3. Un renglón de C insertado en la factura REGISTRADA de D
--        (`factura_proveedor_lineas.factura_id`): el trigger del renglón reescribía el
--        monto de la factura AJENA con el permiso de sistema.
--     4. Un renglón de factura con una CUENTA CONTABLE de otra empresa o de otra
--        contabilidad (la cuenta es de otro libro).
--   La orden de pago contra una factura ajena tiene su propia migración
--   (20261027000100): ahí el defecto además mutaba la factura de la otra empresa.
--   Para explotarlo hay que conocer el UUID del objeto ajeno: no es una fuga masiva,
--   pero un control de aislamiento que depende de que un UUID no se filtre no es un
--   control.
--
-- QUÉ HACE
--   Triggers BEFORE INSERT/UPDATE que comprueban la pertenencia de lo referenciado:
--     · proveedor y proyecto del documento ∈ empresa del documento;
--     · renglón de orden / de factura ∈ empresa de su cabecera;
--     · cuenta del renglón de factura ∈ la contabilidad (empresa + proyecto) de la
--       factura, de detalle y activa (la misma regla que ya aplican las reglas de
--       imputación y los renglones de la orden);
--     · partida de contraseña: contraseña y factura de la misma empresa.
--   Solo se evalúan cuando la fila NACE o cambia lo que referencia: una fila histórica
--   inconsistente (si la hubiera) no queda bloqueada para sus cambios de estado.
--   `scripts/diagnostico-compras-controles.sql` (solo lectura) lista lo que ya exista.
--
-- QUÉ NO HACE
--   No toca políticas RLS, grants de tablas ni datos. No repara filas existentes. No
--   cambia ninguna firma ni contrato público.
--
-- CÓMO REVERTIR (sin pérdida de datos: solo funciones y triggers)
--   DROP TRIGGER trg_compras_alcance_orden ON public.ordenes_compra;
--   DROP TRIGGER trg_compras_alcance_factura ON public.facturas_proveedor;
--   DROP TRIGGER trg_compras_alcance_contrasena ON public.contrasenas_pago;
--   DROP TRIGGER trg_compras_alcance_orden_pago ON public.ordenes_pago;
--   DROP TRIGGER trg_compras_alcance_oc_linea ON public.orden_compra_lineas;
--   DROP TRIGGER trg_compras_alcance_factura_linea ON public.factura_proveedor_lineas;
--   DROP TRIGGER trg_compras_alcance_contrasena_factura ON public.contrasena_pago_facturas;
--   y DROP FUNCTION de las funciones compras_alcance_* / compras_tg_alcance_*.
--   Revertir reabre el defecto descrito arriba.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Comprobación común: proveedor y proyecto de un documento ────────────────
CREATE OR REPLACE FUNCTION public.compras_alcance_verificar(
  p_company uuid, p_project uuid, p_proveedor uuid, p_documento text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_project IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.projects p WHERE p.id = p_project AND p.company_id = p_company) THEN
    RAISE EXCEPTION 'COMPRAS_ALCANCE_PROYECTO: el proyecto % no pertenece a la empresa del documento.', p_documento
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_proveedor IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.proveedores v WHERE v.id = p_proveedor AND v.company_id = p_company) THEN
    RAISE EXCEPTION 'COMPRAS_ALCANCE_PROVEEDOR: el proveedor % no pertenece a la empresa del documento.', p_documento
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.compras_alcance_verificar(uuid, uuid, uuid, text) IS
  'Interna de los triggers de compras: el proveedor y el proyecto de un documento deben ser de la empresa del documento.';

-- ── Cabeceras: orden, factura, contraseña y orden de pago ───────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_alcance_documento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.company_id   IS NOT DISTINCT FROM OLD.company_id
     AND NEW.project_id   IS NOT DISTINCT FROM OLD.project_id
     AND NEW.proveedor_id IS NOT DISTINCT FROM OLD.proveedor_id THEN
    RETURN NEW;
  END IF;
  PERFORM public.compras_alcance_verificar(NEW.company_id, NEW.project_id, NEW.proveedor_id, TG_ARGV[0]);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_alcance_orden ON public.ordenes_compra;
CREATE TRIGGER trg_compras_alcance_orden
  BEFORE INSERT OR UPDATE OF company_id, project_id, proveedor_id ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_alcance_documento('de la orden de compra');

DROP TRIGGER IF EXISTS trg_compras_alcance_factura ON public.facturas_proveedor;
CREATE TRIGGER trg_compras_alcance_factura
  BEFORE INSERT OR UPDATE OF company_id, project_id, proveedor_id ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_alcance_documento('de la factura');

DROP TRIGGER IF EXISTS trg_compras_alcance_contrasena ON public.contrasenas_pago;
CREATE TRIGGER trg_compras_alcance_contrasena
  BEFORE INSERT OR UPDATE OF company_id, project_id, proveedor_id ON public.contrasenas_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_alcance_documento('de la contraseña de pago');

DROP TRIGGER IF EXISTS trg_compras_alcance_orden_pago ON public.ordenes_pago;
CREATE TRIGGER trg_compras_alcance_orden_pago
  BEFORE INSERT OR UPDATE OF company_id, project_id, proveedor_id ON public.ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_alcance_documento('de la orden de pago');

-- ── Renglones: la cabecera debe ser de la misma empresa ─────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_alcance_oc_linea()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_company uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.orden_compra_id = OLD.orden_compra_id
     AND NEW.company_id      = OLD.company_id THEN
    RETURN NEW;
  END IF;
  SELECT o.company_id INTO v_company FROM public.ordenes_compra o WHERE o.id = NEW.orden_compra_id;
  IF FOUND AND v_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'COMPRAS_ALCANCE_RENGLON: el renglón no pertenece a la empresa de su orden de compra.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_alcance_oc_linea ON public.orden_compra_lineas;
CREATE TRIGGER trg_compras_alcance_oc_linea
  BEFORE INSERT OR UPDATE OF company_id, orden_compra_id ON public.orden_compra_lineas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_alcance_oc_linea();

-- Renglón de factura: misma empresa que su factura, y la cuenta (si trae) es de la
-- contabilidad de la factura, de detalle y activa.
CREATE OR REPLACE FUNCTION public.compras_tg_alcance_factura_linea()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_f record;
  v_c record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.factura_id = OLD.factura_id
     AND NEW.company_id = OLD.company_id
     AND NEW.cuenta_id IS NOT DISTINCT FROM OLD.cuenta_id THEN
    RETURN NEW;
  END IF;

  SELECT f.company_id, f.project_id INTO v_f FROM public.facturas_proveedor f WHERE f.id = NEW.factura_id;
  IF NOT FOUND THEN
    RETURN NEW;   -- la FK rechaza la fila
  END IF;
  IF v_f.company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'COMPRAS_ALCANCE_RENGLON: el renglón no pertenece a la empresa de su factura.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.cuenta_id IS NOT NULL THEN
    SELECT c.company_id, c.project_id, c.es_detalle, c.activa INTO v_c
      FROM public.conta_cuentas c WHERE c.id = NEW.cuenta_id;
    IF NOT FOUND THEN
      RETURN NEW;   -- la FK rechaza la fila
    END IF;
    IF v_c.company_id IS DISTINCT FROM v_f.company_id OR v_c.project_id IS DISTINCT FROM v_f.project_id THEN
      RAISE EXCEPTION 'COMPRAS_LINEA_CUENTA_LEDGER: la cuenta del renglón no pertenece a la contabilidad (empresa y proyecto) de la factura.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_c.es_detalle THEN
      RAISE EXCEPTION 'COMPRAS_LINEA_CUENTA_AGRUPADORA: solo las cuentas de detalle reciben movimientos.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_c.activa THEN
      RAISE EXCEPTION 'COMPRAS_LINEA_CUENTA_INACTIVA: la cuenta elegida para el renglón está desactivada.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_alcance_factura_linea ON public.factura_proveedor_lineas;
CREATE TRIGGER trg_compras_alcance_factura_linea
  BEFORE INSERT OR UPDATE OF company_id, factura_id, cuenta_id ON public.factura_proveedor_lineas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_alcance_factura_linea();

-- Partida de contraseña: contraseña y factura de la misma empresa que la partida.
CREATE OR REPLACE FUNCTION public.compras_tg_alcance_contrasena_factura()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cc uuid;
  v_fc uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.contrasena_id = OLD.contrasena_id
     AND NEW.factura_id    = OLD.factura_id
     AND NEW.company_id    = OLD.company_id THEN
    RETURN NEW;
  END IF;
  SELECT c.company_id INTO v_cc FROM public.contrasenas_pago c WHERE c.id = NEW.contrasena_id;
  SELECT f.company_id INTO v_fc FROM public.facturas_proveedor f WHERE f.id = NEW.factura_id;
  IF (v_cc IS NOT NULL AND v_cc IS DISTINCT FROM NEW.company_id)
     OR (v_fc IS NOT NULL AND v_fc IS DISTINCT FROM NEW.company_id) THEN
    RAISE EXCEPTION 'COMPRAS_ALCANCE_PARTIDA: la contraseña y la factura de una partida deben ser de la empresa de la partida.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_alcance_contrasena_factura ON public.contrasena_pago_facturas;
CREATE TRIGGER trg_compras_alcance_contrasena_factura
  BEFORE INSERT OR UPDATE OF company_id, contrasena_id, factura_id ON public.contrasena_pago_facturas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_alcance_contrasena_factura();

-- ── Permisos de ejecución: solo los invocan los triggers ────────────────────
REVOKE ALL ON FUNCTION public.compras_alcance_verificar(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_alcance_documento()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_alcance_oc_linea()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_alcance_factura_linea()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_alcance_contrasena_factura()   FROM PUBLIC, anon, authenticated;
