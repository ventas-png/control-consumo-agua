-- ════════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO DE LO FACTURADO EN LAS ÓRDENES DE COMPRA
-- SOLO LECTURA: un único SELECT, sin escribir nada. Se puede correr en el SQL Editor
-- del proyecto (producción incluida) ANTES de aplicar 20261026000400 y cuando se quiera
-- comprobar el circuito. Cero filas = todo cuadra.
--
-- POR QUÉ EXISTE
-- Hasta 20261026000400, `compras_tg_factura_acumular` tragaba cualquier error al sumar
-- lo facturado (solo dejaba un aviso en el log). Si alguna vez falló, quedó una factura
-- aprobada cuyo importe NO está sumado en su orden. Esto lo encuentra. Después de
-- 20261026000400 ese descuadre ya no se puede producir; lo que aparezca es anterior.
--
-- QUÉ BUSCA (columna `hallazgo`)
--   acumulado_distinto   El `cantidad_facturada` de un renglón de orden no es la suma de
--                        lo que aportan las facturas aprobadas (aprobada, pagada parcial,
--                        pagada) a ese renglón. `diferencia` = acumulado − esperado.
--                        Con diferencia negativa, ANULAR una de esas facturas fallará con
--                        COMPRAS_ACUMULACION_INCONSISTENTE (a propósito: no se recorta).
--   orden_atascada       Todo recibido y todo facturado, con facturas aprobadas, y la
--                        orden NO está cerrada (emitida / recibida parcial / recibida).
--   aprobada_sin_renglones  Factura aprobada ligada a una orden pero sin ningún renglón
--                        ligado a un renglón de la orden: nada de lo que facturó cuenta.
--
-- CÓMO CORREGIR lo que aparezca: no se repara aquí (no escribe). Se decide caso por caso
-- con Contabilidad: normalmente basta ajustar `cantidad_facturada` al esperado con el
-- permiso de sistema (`SET conta.allow_system_write = 'on'`) en una sola transacción, y
-- cerrar la orden si quedó atascada.
-- ════════════════════════════════════════════════════════════════════════════
WITH aprobadas AS (
  SELECT fl.orden_compra_linea_id AS linea_id, SUM(fl.cantidad) AS esperado
    FROM public.factura_proveedor_lineas fl
    JOIN public.facturas_proveedor f ON f.id = fl.factura_id
   WHERE fl.orden_compra_linea_id IS NOT NULL
     AND f.estado IN ('aprobada', 'pagada_parcial', 'pagada')
   GROUP BY fl.orden_compra_linea_id
), descuadre AS (
  SELECT 'acumulado_distinto'::text AS hallazgo, l.company_id, o.id AS orden_id, o.numero AS orden_numero,
         l.id AS renglon_id, l.cantidad_facturada AS acumulado, COALESCE(a.esperado, 0) AS esperado,
         (l.cantidad_facturada - COALESCE(a.esperado, 0)) AS diferencia, NULL::uuid AS factura_id
    FROM public.orden_compra_lineas l
    JOIN public.ordenes_compra o ON o.id = l.orden_compra_id
    LEFT JOIN aprobadas a ON a.linea_id = l.id
   WHERE l.cantidad_facturada IS DISTINCT FROM COALESCE(a.esperado, 0)
), atascadas AS (
  SELECT 'orden_atascada'::text, o.company_id, o.id, o.numero, NULL::uuid, NULL::numeric, NULL::numeric, NULL::numeric, NULL::uuid
    FROM public.ordenes_compra o
   WHERE o.estado IN ('emitida', 'recibida_parcial', 'recibida')
     AND EXISTS (SELECT 1 FROM public.facturas_proveedor f
                  WHERE f.orden_compra_id = o.id AND f.estado IN ('aprobada', 'pagada_parcial', 'pagada'))
     AND EXISTS (SELECT 1 FROM public.orden_compra_lineas l WHERE l.orden_compra_id = o.id)
     AND NOT EXISTS (SELECT 1 FROM public.orden_compra_lineas l
                      WHERE l.orden_compra_id = o.id AND (l.cantidad_recibida < l.cantidad OR l.cantidad_facturada < l.cantidad))
), sin_renglones AS (
  SELECT 'aprobada_sin_renglones'::text, f.company_id, f.orden_compra_id, NULL::text, NULL::uuid, NULL::numeric, NULL::numeric, NULL::numeric, f.id
    FROM public.facturas_proveedor f
   WHERE f.orden_compra_id IS NOT NULL
     AND f.estado IN ('aprobada', 'pagada_parcial', 'pagada')
     AND NOT EXISTS (SELECT 1 FROM public.factura_proveedor_lineas fl
                      WHERE fl.factura_id = f.id AND fl.orden_compra_linea_id IS NOT NULL)
)
SELECT * FROM descuadre
UNION ALL SELECT * FROM atascadas
UNION ALL SELECT * FROM sin_renglones
ORDER BY 1, 2, 3, 5;
