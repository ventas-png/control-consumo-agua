-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · `compras_tg_factura_acumular`: LOS ERRORES REALES YA NO SE ESCONDEN
-- (cierre técnico del circuito de compras y contabilidad)
--
-- QUÉ HACE EL TRIGGER
-- Al APROBAR una factura (registrada → aprobada) suma lo que facturó a
-- `orden_compra_lineas.cantidad_facturada`; al ANULARLA (aprobada / pagada parcial /
-- pagada → anulada) lo resta. Después cierra la orden si ya está todo recibido y
-- facturado, o la reabre si la anulación deshizo ese cierre. De ahí salen lo
-- facturado, los pendientes por facturar del seguimiento y el estado de la orden.
--
-- QUÉ ESCONDÍA (los puntos 1, 2 y 4 se reprodujeron contra la función anterior en PostgreSQL
-- local —supabase/tests/compras_cierre_tecnico/assert_factura_acumular.sql falla sin esta
-- migración exactamente en ellos—; el 3 es un riesgo de diseño que no se pudo forzar de forma
-- determinista y se cierra por construcción)
--   1. `EXCEPTION WHEN OTHERS … RAISE WARNING … RETURN NEW`: CUALQUIER error al acumular
--      (interbloqueo, bloqueo vencido, restricción, un trigger de renglón u orden, un
--      desborde) se convertía en un aviso en el log del servidor y la factura se
--      aprobaba igual —con su asiento contable— SIN sumar lo facturado: la orden seguía
--      mostrando pendiente lo ya facturado, no se cerraba, y se podía facturar OTRA vez
--      lo mismo. Nadie lo veía: el aviso solo existe en el log.
--   2. `GREATEST(0, acumulado − aporte)`: al anular, si lo acumulado era MENOR que lo que
--      la factura había aportado (acumulación previa ya descuadrada), el recorte a cero
--      ocultaba el descuadre en vez de mostrarlo.
--   3. Sin bloqueo propio al anular: solo la APROBACIÓN bloquea los renglones de la orden
--      (en `compras_tg_factura_match`); la anulación actualizaba renglones en el orden que
--      saliera del GROUP BY, sin orden garantizado frente a otras operaciones sobre la
--      misma orden (otra anulación, una recepción, una aprobación): riesgo de interbloqueo
--      —que el punto 1 ocultaba— y de cierres calculados sobre datos a medias.
--   4. El estado de la orden se movía sin comprobar de dónde venía: con el permiso de
--      sistema activo, una orden CANCELADA podía pasar a «cerrada», y una orden cerrada A
--      MANO con una recepción parcial se «reabría» como «recibida» (no lo está) al anular
--      cualquiera de sus facturas.
--
-- QUÉ CAMBIA
--   · Sin manejador `WHEN OTHERS`: un error REAL aborta la aprobación o la anulación
--     COMPLETA —la factura conserva su estado, no se genera asiento, lo facturado no se
--     toca— y el cliente lo recibe para reintentar. Un interbloqueo o un bloqueo vencido
--     se reintentan y pasan; un dato inconsistente se ve y se corrige.
--   · Bloqueo determinista antes de tocar nada: los renglones de la orden (y los ligados
--     a la factura) por `id`, el mismo orden que usa el trigger de cuadre. Aprobaciones,
--     anulaciones y recepciones sobre la misma orden se serializan sin interbloquearse.
--   · Sin recorte a cero: si restar dejaría un acumulado negativo se rechaza con
--     COMPRAS_ACUMULACION_INCONSISTENTE y el detalle (renglón, acumulado, aporte). Para
--     encontrar de antemano lo que ya esté descuadrado:
--     scripts/diagnostico-acumulacion-facturas.sql (solo lectura).
--   · Se verifica que se actualizaron TODOS los renglones que la factura aporta.
--   · Estados con guarda: solo se CIERRA una orden emitida / recibida parcial / recibida;
--     solo se REABRE una orden cerrada que cumplía el criterio de cierre (todo recibido y
--     facturado) y que la anulación deja de cumplir. Una orden cancelada no se toca y una
--     cerrada a mano con pendientes no se reabre.
--
-- LO QUE SIGUE SIENDO «ESPERADO» (no es un error y no bloquea; ahora es explícito, no un
-- efecto de un manejador que lo tragaba todo)
--   · Cualquier otra transición de estado de la factura (registrada → anulada, aprobada →
--     pagada…): no mueve lo facturado.
--   · Facturas sin renglones ligados a un renglón de la orden (gasto directo, caja chica,
--     o renglones cuyo renglón de orden se borró y quedó en NULL): no hay qué acumular.
--   · Aprobar de nuevo una factura ya aprobada, o anularla dos veces: la transición ya no
--     ocurre, no se suma ni se resta otra vez (idempotente).
--   · Sobrefacturación dentro de la tolerancia: lo acumulado puede pasar de lo ordenado.
--
-- NO CAMBIA: las reglas de cuadre (`compras_tg_factura_match`), el asiento contable, las
-- tolerancias, las firmas ni los permisos. Los otros manejadores del circuito (alertas de
-- presupuesto, contabilización con cola de pendientes) son avisos o tienen una cola visible
-- y reintentable: se documentan en docs/COMPRAS_CIERRE_TECNICO.md y no se tocan.
--
-- CÓMO REVERTIR: volver a aplicar la definición de 20260821000300 (CREATE OR REPLACE).
-- IMPACTO EN DATOS: ninguno (solo reemplaza una función); no repara datos ya descuadrados.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_tg_factura_acumular()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_signo      int;
  v_prev       text := COALESCE(current_setting('conta.allow_system_write', true), 'off');
  v_aporta     int;
  v_actualiz   int;
  v_neg        record;
  v_estado     text;
  v_nuevo      text;
  v_pend_antes int := 0;
  v_pend       int := 0;
BEGIN
  -- ESPERADO · solo estas dos transiciones mueven lo facturado; cualquier otra no es asunto de este trigger.
  IF NEW.estado = 'aprobada' AND OLD.estado = 'registrada' THEN
    v_signo := 1;
  ELSIF NEW.estado = 'anulada' AND OLD.estado IN ('aprobada', 'pagada_parcial', 'pagada') THEN
    v_signo := -1;
  ELSE
    RETURN NEW;
  END IF;

  -- ESPERADO · sin renglones ligados a un renglón de orden (gasto directo, caja chica) no hay qué acumular.
  SELECT COUNT(DISTINCT orden_compra_linea_id) INTO v_aporta
    FROM public.factura_proveedor_lineas
   WHERE factura_id = NEW.id AND orden_compra_linea_id IS NOT NULL;
  IF v_aporta = 0 THEN
    RETURN NEW;
  END IF;

  -- Bloqueo determinista (por id, como el trigger de cuadre) ANTES de leer o escribir nada: aprobaciones,
  -- anulaciones y recepciones sobre la misma orden se serializan sin interbloquearse, y lo que se lee
  -- después (pendientes, cierre) ya no puede cambiar bajo los pies.
  PERFORM 1
    FROM public.orden_compra_lineas
   WHERE orden_compra_id = NEW.orden_compra_id
      OR id IN (SELECT orden_compra_linea_id FROM public.factura_proveedor_lineas
                 WHERE factura_id = NEW.id AND orden_compra_linea_id IS NOT NULL)
   ORDER BY id
     FOR UPDATE;

  -- Lo pendiente ANTES de mover nada: la anulación solo reabre una orden que cumplía el criterio de cierre.
  IF NEW.orden_compra_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_pend_antes
      FROM public.orden_compra_lineas
     WHERE orden_compra_id = NEW.orden_compra_id
       AND (cantidad_recibida < cantidad OR cantidad_facturada < cantidad);
  END IF;

  -- Restar más de lo acumulado no es un caso legítimo: es una acumulación previa descuadrada. Se muestra.
  SELECT l.id, l.cantidad_facturada AS acumulado, a.cant AS aporte INTO v_neg
    FROM public.orden_compra_lineas l
    JOIN (SELECT orden_compra_linea_id AS id, SUM(cantidad) AS cant
            FROM public.factura_proveedor_lineas
           WHERE factura_id = NEW.id AND orden_compra_linea_id IS NOT NULL
           GROUP BY orden_compra_linea_id) a ON a.id = l.id
   WHERE l.cantidad_facturada + v_signo * a.cant < 0
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'COMPRAS_ACUMULACION_INCONSISTENTE: la factura % aportó % al renglón de orden %, pero lo acumulado como facturado es solo %. Lo facturado de ese renglón ya estaba descuadrado: no se oculta con un recorte a cero. Revisa con scripts/diagnostico-acumulacion-facturas.sql antes de repetir la operación.',
      NEW.id, v_neg.aporte, v_neg.id, v_neg.acumulado
      USING ERRCODE = 'check_violation';
  END IF;

  -- El permiso de sistema solo vale mientras se escribe lo acumulado y el estado de la orden.
  PERFORM set_config('conta.allow_system_write', 'on', true);

  WITH aporte AS (
    SELECT orden_compra_linea_id AS id, SUM(cantidad) AS cant
      FROM public.factura_proveedor_lineas
     WHERE factura_id = NEW.id AND orden_compra_linea_id IS NOT NULL
     GROUP BY orden_compra_linea_id
  ), act AS (
    UPDATE public.orden_compra_lineas l
       SET cantidad_facturada = l.cantidad_facturada + v_signo * a.cant,
           updated_at = now()
      FROM aporte a
     WHERE l.id = a.id
    RETURNING l.id
  )
  SELECT COUNT(*) INTO v_actualiz FROM act;
  IF v_actualiz <> v_aporta THEN
    RAISE EXCEPTION 'COMPRAS_ACUMULACION_INCONSISTENTE: la factura % aporta a % renglón(es) de orden y solo se actualizaron %.',
      NEW.id, v_aporta, v_actualiz USING ERRCODE = 'check_violation';
  END IF;

  -- Estado de la orden: con guardas (no se cierra una cancelada ni se reabre una cerrada a mano con pendientes).
  IF NEW.orden_compra_id IS NOT NULL THEN
    SELECT estado INTO v_estado FROM public.ordenes_compra WHERE id = NEW.orden_compra_id;
    IF v_estado IS NOT NULL THEN
      SELECT COUNT(*) INTO v_pend
        FROM public.orden_compra_lineas
       WHERE orden_compra_id = NEW.orden_compra_id
         AND (cantidad_recibida < cantidad OR cantidad_facturada < cantidad);
      v_nuevo := CASE
        -- Recibida y facturada del todo → la orden se cierra sola (el fin natural del riel).
        WHEN v_signo = 1 AND v_pend = 0 AND v_estado IN ('emitida', 'recibida_parcial', 'recibida') THEN 'cerrada'
        -- La anulación deshizo un cierre que cumplía el criterio → vuelve a «recibida» (todo estaba recibido).
        WHEN v_signo = -1 AND v_pend > 0 AND v_pend_antes = 0 AND v_estado = 'cerrada' THEN 'recibida'
        ELSE v_estado
      END;
      IF v_nuevo <> v_estado THEN
        UPDATE public.ordenes_compra SET estado = v_nuevo, updated_at = now() WHERE id = NEW.orden_compra_id;
      END IF;
    END IF;
  END IF;

  PERFORM set_config('conta.allow_system_write', v_prev, true);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_factura_acumular() IS
  'Suma (aprobar) o resta (anular) lo facturado en los renglones de la orden y cierra/reabre la orden. SIN manejador de excepciones: un error real aborta la operación completa. Bloqueo determinista por id; sin recorte a cero; estados de la orden con guardas.';
