-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · TRAZABILIDAD DE LOS CAMBIOS A UNA ORDEN DESPUÉS DE SU APROBACIÓN
--
-- LO QUE YA ESTABA CUBIERTO (20261021000000 / …0600)
--   Las CONDICIONES económicas de una orden aprobada o emitida (proveedor, moneda,
--   proyecto, contrato, condiciones de pago, crédito, obra, fecha requerida) y sus
--   renglones no se tocan: para cambiarlas se devuelve a borrador con motivo y la
--   aprobación se invalida (revisión + 1, con evento).
--
-- QUÉ FALTABA (reproducido con UPDATE directo sobre una orden EMITIDA)
--   El resto de la cabecera se podía reescribir sin rastro: `numero` (la identidad del
--   documento que recibió el proveedor), `proveedor_nombre` (el nombre que se imprime),
--   `concepto`, `descripcion`, `notas`, `fecha_entrega_esperada` y los montos
--   informativos (`monto_estimado`, `monto_real`). Ningún evento lo registraba.
--
-- QUÉ HACE
--   · `numero` y `correlativo` no cambian una vez asignados (identidad del documento).
--   · `proveedor_nombre` no cambia después de aprobar (el proveedor real es
--     `proveedor_id`, ya congelado; el nombre es la copia que se imprime).
--   · Cualquier otro cambio de `concepto`, `descripcion`, `notas`,
--     `fecha_entrega_esperada`, `monto_estimado` o `monto_real` sobre una orden que ya no
--     es borrador deja un evento «modificacion» en `orden_compra_eventos` (quién, cuándo,
--     qué campo, valor anterior → nuevo). No se bloquea: corregir una errata o ampliar una
--     nota es legítimo; lo que no se admite es que no quede escrito.
--   · El tipo de evento «modificacion» se agrega a la restricción de `orden_compra_eventos`
--     (es un superconjunto de la anterior: los eventos existentes siguen válidos).
--
-- NO TOCA las condiciones congeladas, los renglones, el ciclo de estados ni los datos
-- existentes. Los triggers de sistema (recepción y factura moviendo el estado) no pasan
-- por aquí.
--
-- CÓMO REVERTIR (sin pérdida de datos si no se han registrado eventos «modificacion»)
--   DROP TRIGGER trg_compras_oc_modificacion ON public.ordenes_compra;
--   DROP TRIGGER trg_compras_oc_identidad ON public.ordenes_compra;
--   DROP FUNCTION public.compras_tg_oc_modificacion();
--   DROP FUNCTION public.compras_tg_oc_identidad();
--   Volver a la restricción anterior exige borrar antes los eventos «modificacion»
--   (se perdería ese rastro): no se recomienda; el tipo extra no estorba.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orden_compra_eventos DROP CONSTRAINT IF EXISTS orden_compra_eventos_tipo_check;
ALTER TABLE public.orden_compra_eventos
  ADD CONSTRAINT orden_compra_eventos_tipo_check
  CHECK (tipo = ANY (ARRAY['estado'::text, 'devolucion'::text, 'excepcion_contrato'::text, 'modificacion'::text]));

-- ── Identidad del documento ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_oc_identidad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;   -- el trigger de estado asigna el número al aprobar
  END IF;
  IF OLD.numero IS NOT NULL AND NEW.numero IS DISTINCT FROM OLD.numero THEN
    RAISE EXCEPTION 'COMPRAS_OC_NUMERO_INMUTABLE: el número de la orden (%) es su identidad y no cambia.', OLD.numero
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.correlativo IS DISTINCT FROM OLD.correlativo THEN
    RAISE EXCEPTION 'COMPRAS_OC_NUMERO_INMUTABLE: el correlativo de la orden no cambia.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.estado <> 'borrador' AND NEW.proveedor_nombre IS DISTINCT FROM OLD.proveedor_nombre THEN
    RAISE EXCEPTION 'COMPRAS_OC_APROBADA_CAMBIO: el nombre del proveedor impreso en una orden que ya no es borrador no se reescribe (el proveedor es el del catálogo). Devuélvela a borrador con motivo si hay que corregirlo.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_oc_identidad ON public.ordenes_compra;
CREATE TRIGGER trg_compras_oc_identidad
  BEFORE UPDATE OF numero, correlativo, proveedor_nombre ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_oc_identidad();

-- ── Evento de modificación posterior a la aprobación ────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_oc_modificacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cambios text[] := '{}';
BEGIN
  IF OLD.estado = 'borrador'
     OR COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NULL;
  END IF;

  IF NEW.concepto IS DISTINCT FROM OLD.concepto THEN
    v_cambios := v_cambios || format('concepto: «%s» → «%s»', left(OLD.concepto, 120), left(NEW.concepto, 120));
  END IF;
  IF NEW.descripcion IS DISTINCT FROM OLD.descripcion THEN
    v_cambios := v_cambios || format('descripción: «%s» → «%s»', left(COALESCE(OLD.descripcion, ''), 120), left(COALESCE(NEW.descripcion, ''), 120));
  END IF;
  IF NEW.notas IS DISTINCT FROM OLD.notas THEN
    v_cambios := v_cambios || format('notas: «%s» → «%s»', left(COALESCE(OLD.notas, ''), 120), left(COALESCE(NEW.notas, ''), 120));
  END IF;
  IF NEW.fecha_entrega_esperada IS DISTINCT FROM OLD.fecha_entrega_esperada THEN
    v_cambios := v_cambios || format('entrega esperada: %s → %s', COALESCE(OLD.fecha_entrega_esperada::text, '—'), COALESCE(NEW.fecha_entrega_esperada::text, '—'));
  END IF;
  IF NEW.monto_estimado IS DISTINCT FROM OLD.monto_estimado THEN
    v_cambios := v_cambios || format('monto estimado: %s → %s', COALESCE(OLD.monto_estimado::text, '—'), COALESCE(NEW.monto_estimado::text, '—'));
  END IF;
  IF NEW.monto_real IS DISTINCT FROM OLD.monto_real THEN
    v_cambios := v_cambios || format('monto real: %s → %s', COALESCE(OLD.monto_real::text, '—'), COALESCE(NEW.monto_real::text, '—'));
  END IF;

  IF cardinality(v_cambios) > 0 THEN
    INSERT INTO public.orden_compra_eventos
      (company_id, project_id, orden_compra_id, tipo, estado_anterior, estado_nuevo, revision, motivo, origen, actor_id)
    VALUES (NEW.company_id, NEW.project_id, NEW.id, 'modificacion', OLD.estado, NEW.estado, NEW.revision,
            array_to_string(v_cambios, '; '), 'usuario', auth.uid());
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_oc_modificacion ON public.ordenes_compra;
CREATE TRIGGER trg_compras_oc_modificacion
  AFTER UPDATE OF concepto, descripcion, notas, fecha_entrega_esperada, monto_estimado, monto_real ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_oc_modificacion();

REVOKE ALL ON FUNCTION public.compras_tg_oc_identidad()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_oc_modificacion()  FROM PUBLIC, anon, authenticated;
