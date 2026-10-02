-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · BLOQUE C · INVENTARIO DESDE LA ORDEN DE COMPRA
--
-- QUÉ YA EXISTÍA (no se toca)
--   · `orden_compra_lineas.suministro_id` y `destino_tipo` (inventario | activo_fijo |
--     servicio | gasto).
--   · La recepción (`compras_tg_recepcion_registrar`) registra la ENTRADA al kardex
--     (`movimientos_suministro`, origen `recepcion_lineas`) solo por la cantidad
--     ACEPTADA (`rl.cantidad > 0`; lo rechazado no entra) y solo al pasar a
--     `registrada`; la anulación compensa con una salida.
--
-- QUÉ FALTABA (brechas)
--   1. Nada validaba el insumo de un renglón: un `suministro_id` de OTRO proyecto
--      (o de otra empresa, vía API) o con otra unidad de medida se aceptaba, y un
--      insumo podía colgarse de un renglón de servicio o de gasto.
--   2. Una orden con un renglón de inventario SIN insumo se aprobaba y, al recibir,
--      la recepción omitía la entrada al kardex sin avisar (el stock no subía, y la
--      cuenta de inventario sí).
--   3. El insumo, el destino y la unidad de un renglón se podían cambiar con la
--      orden ya aprobada o con mercancía ya recibida.
--   4. La unicidad de la entrada al kardex dependía solo de que el trigger dispare
--      una vez: el índice del origen no era único.
--
-- QUÉ HACE
--   · `compras_tg_linea_inventario` (BEFORE INSERT/UPDATE de renglones): con insumo,
--     exige destino «inventario», insumo activo de la MISMA empresa y del MISMO
--     proyecto que la orden (una orden de la contabilidad de la empresa no tiene
--     bodega: no admite insumos) y la MISMA unidad de medida. Insumo, destino y
--     unidad solo se tocan mientras la orden es borrador; no se agregan renglones
--     a una orden que ya salió de borrador.
--   · `compras_tg_oc_inventario_aprobar` (BEFORE UPDATE de la orden): no se aprueba
--     una orden con renglones de inventario sin insumo.
--   · Índice ÚNICO parcial del kardex por (origen_tabla, origen_id) para
--     `recepcion_lineas` y `recepcion_lineas_anulada`: una entrada y, como mucho, una
--     salida compensatoria por renglón de recepción; ni un reintento ni dos sesiones
--     simultáneas pueden duplicar existencias. Si ya hubiera duplicados históricos el
--     índice NO se crea (se avisa) en vez de romper el despliegue.
--
-- NO CAMBIA: permisos, RLS, la recepción ni sus asientos.
--
-- CÓMO REVERTIR
--   DROP TRIGGER trg_compras_linea_inventario ON public.orden_compra_lineas;
--   DROP TRIGGER trg_compras_oc_inventario_aprobar ON public.ordenes_compra;
--   DROP FUNCTION public.compras_tg_linea_inventario(), public.compras_tg_oc_inventario_aprobar();
--   DROP INDEX public.uq_mov_suministro_origen_recepcion;
-- IMPACTO EN DATOS: ninguno sobre filas existentes (solo validaciones de escritura).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_tg_linea_inventario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_oc  record;
  v_sum record;
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT o.company_id, o.project_id, o.estado INTO v_oc
    FROM public.ordenes_compra o WHERE o.id = NEW.orden_compra_id;
  IF NOT FOUND THEN
    RETURN NEW;               -- la FK de la línea es quien responde
  END IF;

  -- Insumo, destino y unidad: solo mientras la orden es borrador. Con la orden
  -- aprobada, o con algo ya recibido, cambiarlos reescribiría a qué bodega entra
  -- lo que ya se pidió o se recibió.
  IF TG_OP = 'INSERT' THEN
    IF v_oc.estado <> 'borrador' THEN
      RAISE EXCEPTION 'COMPRAS_LINEA_ORDEN_CERRADA: la orden está "%" y no admite renglones nuevos; solo en borrador.', v_oc.estado
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF (NEW.suministro_id IS DISTINCT FROM OLD.suministro_id
         OR NEW.destino_tipo IS DISTINCT FROM OLD.destino_tipo
         OR lower(btrim(NEW.unidad)) IS DISTINCT FROM lower(btrim(OLD.unidad)))
        AND (v_oc.estado <> 'borrador' OR COALESCE(OLD.cantidad_recibida, 0) > 0) THEN
    RAISE EXCEPTION 'COMPRAS_LINEA_ORDEN_CERRADA: el insumo, el destino y la unidad del renglón no se cambian con la orden "%" ni con mercancía ya recibida.', v_oc.estado
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.suministro_id IS NULL THEN
    RETURN NEW;               -- inventario sin insumo es válido en borrador; se exige al aprobar
  END IF;

  IF NEW.destino_tipo <> 'inventario' THEN
    RAISE EXCEPTION 'COMPRAS_LINEA_INSUMO_DESTINO: un renglón con insumo del almacén tiene destino «inventario»; no se mezcla con activo, servicio ni gasto.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT s.company_id, s.project_id, s.unidad_medida, s.activo, s.nombre INTO v_sum
    FROM public.suministros_condominio s WHERE s.id = NEW.suministro_id;
  IF NOT FOUND OR v_sum.company_id <> v_oc.company_id THEN
    RAISE EXCEPTION 'COMPRAS_LINEA_INSUMO_ALCANCE: el insumo no existe en la empresa de la orden.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_oc.project_id IS NULL OR v_sum.project_id IS DISTINCT FROM v_oc.project_id THEN
    RAISE EXCEPTION 'COMPRAS_LINEA_INSUMO_ALCANCE: el insumo «%» es de otro proyecto (o la orden es de la contabilidad de la empresa, que no tiene bodega). Elige un insumo del proyecto de la orden.', v_sum.nombre
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_sum.activo THEN
    RAISE EXCEPTION 'COMPRAS_LINEA_INSUMO_INACTIVO: el insumo «%» está inactivo.', v_sum.nombre
      USING ERRCODE = 'check_violation';
  END IF;
  IF lower(btrim(NEW.unidad)) IS DISTINCT FROM lower(btrim(v_sum.unidad_medida)) THEN
    RAISE EXCEPTION 'COMPRAS_LINEA_INSUMO_UNIDAD: el renglón se pide en «%» y el insumo «%» se lleva en «%». Usa la unidad del insumo.', NEW.unidad, v_sum.nombre, v_sum.unidad_medida
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_linea_inventario() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_linea_inventario ON public.orden_compra_lineas;
CREATE TRIGGER trg_compras_linea_inventario
  BEFORE INSERT OR UPDATE ON public.orden_compra_lineas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_linea_inventario();

-- ── No se aprueba una orden con inventario sin insumo ───────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_oc_inventario_aprobar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n int;
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.estado = 'aprobada' AND OLD.estado IS DISTINCT FROM 'aprobada' THEN
    SELECT count(*) INTO v_n FROM public.orden_compra_lineas l
     WHERE l.orden_compra_id = NEW.id AND l.destino_tipo = 'inventario' AND l.suministro_id IS NULL;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'COMPRAS_ORDEN_INVENTARIO_SIN_INSUMO: % renglón(es) de inventario no tienen insumo; sin él la recepción no sabría a qué existencia entra. Elige el insumo de cada renglón antes de aprobar.', v_n
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_inventario_aprobar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_oc_inventario_aprobar ON public.ordenes_compra;
CREATE TRIGGER trg_compras_oc_inventario_aprobar
  BEFORE UPDATE OF estado ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_oc_inventario_aprobar();

-- ── Una entrada y a lo sumo una salida compensatoria por renglón de recepción ─
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.movimientos_suministro
     WHERE origen_tabla IN ('recepcion_lineas', 'recepcion_lineas_anulada') AND origen_id IS NOT NULL
     GROUP BY origen_tabla, origen_id HAVING count(*) > 1
  ) THEN
    RAISE WARNING 'uq_mov_suministro_origen_recepcion NO se creó: hay movimientos de recepción duplicados que deben revisarse a mano.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mov_suministro_origen_recepcion
      ON public.movimientos_suministro (origen_tabla, origen_id)
      WHERE origen_tabla IN ('recepcion_lineas', 'recepcion_lineas_anulada') AND origen_id IS NOT NULL;
  END IF;
END $$;
