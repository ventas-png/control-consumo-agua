-- ════════════════════════════════════════════════════════════════════════════
-- FACTURAS DE ENERGÍA · EL TOTAL GUARDADO PASA A SER EL DE SU DESGLOSE
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ EXISTE
-- Hasta #978 el formulario de factura de energía solo llenaba `monto_total`
-- con «Calcular desde tarifa». Quedaron guardadas facturas con un total que no
-- es el de sus propios montos:
--   · capturadas a mano (p. ej. una fuente solar sin tarifa): total 0;
--   · calculadas y luego ajustadas a mano: el total del cálculo, no el ajustado;
--   · con «Otros»: el cálculo nunca lo sumaba;
--   · con el crédito por exportación escrito en positivo: el cálculo lo deja en
--     negativo, así que el Dashboard sumaba créditos con los dos signos.
-- El Dashboard («Costo Total») y la lista de facturas suman `monto_total`, así
-- que muestran de menos. #978 corrige el formulario; esta migración corrige lo
-- que ya está guardado.
--
-- LA REGLA (la misma de totalFacturaEnergia, src/lib/businessEnergia.ts)
--   monto_total = round(energía + potencia + cargo fijo + alumbrado + IVA
--                       + otros − |crédito por exportación|, 2)
--   monto_credito_exportacion = −|monto_credito_exportacion|
-- El crédito siempre resta, venga con el signo que venga; «otros» suma con el
-- suyo (un descuento va en negativo). Las columnas son numeric(12,2) y round()
-- de numeric redondea alejándose de cero, como redondear2 en la app.
--
-- LO QUE NO TOCA
--   · Facturas cuyo desglose está TODO en cero pero tienen total: ahí el total
--     es el único monto registrado (la app no puede producirlas; si existen,
--     vinieron por otra vía). Recalcularlo lo dejaría en 0, así que se dejan
--     como están y se informan con un NOTICE para que alguien decida.
--   · Los montos del desglose, los kWh, el estado, `updated_at` y `creado_por`.
--   · Facturas que ya cumplen la regla: no se escriben ni dejan constancia.
--
-- CONSTANCIA
-- Por cada factura corregida queda una fila en `audit_log`:
--   table_name 'facturas_energia', action 'UPDATE', record_id = la factura,
--   actor_id NULL (escritura de sistema), company_id/project_id de la factura,
--   before = {monto_total, monto_credito_exportacion} anteriores,
--   after  = los nuevos + "correccion": '20261104090000_facturas_energia_total_del_desglose'.
-- El admin y el owner de cada empresa la ven por la policy de `audit_log`.
-- No se crea ninguna tabla, función ni trigger: la huella del esquema no cambia.
--
-- REVERSIÓN (devuelve los dos montos anteriores; la prueba
-- supabase/tests/energia_total_facturas/run.sh ejecuta exactamente este bloque):
-- >>> REVERSIÓN
-- UPDATE public.facturas_energia f
--    SET monto_total               = (a.before->>'monto_total')::numeric,
--        monto_credito_exportacion = (a.before->>'monto_credito_exportacion')::numeric
--   FROM public.audit_log a
--  WHERE a.table_name = 'facturas_energia'
--    AND a.record_id  = f.id
--    AND a.after->>'correccion' = '20261104090000_facturas_energia_total_del_desglose';
-- <<< REVERSIÓN
-- (Las filas de audit_log se conservan: son la constancia de las dos cosas.)
--
-- IDEMPOTENTE: una segunda pasada no encuentra nada que cambiar, así que no
-- escribe ni deja constancia nueva.
--
-- ORDEN DE DESPLIEGUE: después de #978. Si corre antes, las facturas que se
-- capturen a mano entre una y otra se guardan otra vez con total 0.
--
-- IMPACTO EN DATOS PRODUCTIVOS: actualiza monto_total y, si estaba en
-- positivo, monto_credito_exportacion de las facturas de energía cuyo total no
-- es el de su desglose. Una sola sentencia, bloqueando solo esas filas.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_correccion CONSTANT text := '20261104090000_facturas_energia_total_del_desglose';
  v_corregidas bigint;
  v_constancias bigint;
  v_solo_total bigint;
  v_pendientes bigint;
BEGIN
  -- FOR UPDATE: si alguien guarda una factura mientras corre esto, se espera a
  -- su versión confirmada y el total se calcula sobre ESA, no sobre una vieja.
  WITH objetivo AS (
    SELECT f.id, f.company_id, f.project_id,
           f.monto_total, f.monto_credito_exportacion,
           round(f.monto_energia + f.monto_potencia + f.monto_cargo_fijo + f.monto_alumbrado
                 + f.monto_iva + f.monto_otros - abs(f.monto_credito_exportacion), 2) AS total_nuevo,
           -abs(f.monto_credito_exportacion) AS credito_nuevo
      FROM public.facturas_energia f
     WHERE NOT (f.monto_energia = 0 AND f.monto_potencia = 0 AND f.monto_cargo_fijo = 0
                AND f.monto_alumbrado = 0 AND f.monto_iva = 0 AND f.monto_otros = 0
                AND f.monto_credito_exportacion = 0)
       FOR UPDATE
  ), cambia AS (
    SELECT * FROM objetivo
     WHERE monto_total <> total_nuevo OR monto_credito_exportacion <> credito_nuevo
  ), constancia AS (
    INSERT INTO public.audit_log (table_name, record_id, action, actor_id, company_id, project_id, before, after)
    SELECT 'facturas_energia', c.id, 'UPDATE', NULL, c.company_id, c.project_id,
           jsonb_build_object('monto_total', c.monto_total,
                              'monto_credito_exportacion', c.monto_credito_exportacion),
           jsonb_build_object('monto_total', c.total_nuevo,
                              'monto_credito_exportacion', c.credito_nuevo,
                              'correccion', v_correccion)
      FROM cambia c
    RETURNING 1
  ), corregidas AS (
    UPDATE public.facturas_energia f
       SET monto_total = c.total_nuevo,
           monto_credito_exportacion = c.credito_nuevo
      FROM cambia c
     WHERE f.id = c.id
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM corregidas), (SELECT count(*) FROM constancia)
    INTO v_corregidas, v_constancias;

  IF v_constancias <> v_corregidas THEN
    RAISE EXCEPTION 'ABORTADO: % factura(s) corregida(s) pero % constancia(s) en audit_log.',
      v_corregidas, v_constancias;
  END IF;

  -- Comprobación: ninguna factura con desglose queda fuera de la regla.
  SELECT count(*) INTO v_pendientes
    FROM public.facturas_energia f
   WHERE NOT (f.monto_energia = 0 AND f.monto_potencia = 0 AND f.monto_cargo_fijo = 0
              AND f.monto_alumbrado = 0 AND f.monto_iva = 0 AND f.monto_otros = 0
              AND f.monto_credito_exportacion = 0)
     AND (f.monto_total <> round(f.monto_energia + f.monto_potencia + f.monto_cargo_fijo
                                 + f.monto_alumbrado + f.monto_iva + f.monto_otros
                                 - abs(f.monto_credito_exportacion), 2)
          OR f.monto_credito_exportacion > 0);
  IF v_pendientes > 0 THEN
    RAISE EXCEPTION 'ABORTADO: % factura(s) siguen con un total distinto del de su desglose.', v_pendientes;
  END IF;

  SELECT count(*) INTO v_solo_total
    FROM public.facturas_energia f
   WHERE f.monto_total <> 0
     AND f.monto_energia = 0 AND f.monto_potencia = 0 AND f.monto_cargo_fijo = 0
     AND f.monto_alumbrado = 0 AND f.monto_iva = 0 AND f.monto_otros = 0
     AND f.monto_credito_exportacion = 0;

  RAISE NOTICE 'facturas_energia: % factura(s) corregida(s), con constancia en audit_log (correccion = %).',
    v_corregidas, v_correccion;
  IF v_solo_total > 0 THEN
    RAISE NOTICE 'facturas_energia: % factura(s) tienen total pero ningún monto en el desglose; se dejaron como estaban.',
      v_solo_total;
  END IF;
END;
$$;
