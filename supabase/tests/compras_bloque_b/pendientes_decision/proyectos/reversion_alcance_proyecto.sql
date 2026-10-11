-- ════════════════════════════════════════════════════════════════════════════
-- REVERSIÓN de propuesta_alcance_proyecto.sql (compras · alcance de proyecto al capturar y «sin proyecto» solo para exentos)
--
-- Quita lo que añade la propuesta, y SOLO eso: 9 disparadores (5 de captura, 4 de las hijas) y 3 funciones. No toca datos, ni la 0900
-- (trg_zzcompras_mover_alcance y compras_exigir_permiso quedan como están), ni privilegios, ni políticas. Idempotente (se puede correr
-- varias veces) y sin pérdida de datos: los documentos y renglones creados mientras la propuesta estuvo puesta se conservan tal cual
-- (también los que quedaron en proyectos que la persona ya no podría capturar: no se mueven ni se borran).
--
-- ORDEN: esta reversión va ANTES que la de la 0900 y que cualquier otra de la serie 20261027…: los 9 disparadores llaman a compras_sesion_usuario() (que crea la 0300 y borra la
--   sección de la 0300 de scripts/reversion-compras-controles.sql); si se revierte la serie SIN quitar antes estos disparadores, esa función desaparece con ellos vivos y TODA
--   inserción en las nueve tablas de compras falla (function public.compras_sesion_usuario() does not exist, 42883; reproducido). La misma sección está en
--   scripts/reversion-compras-controles.sql, encima de la de la 0900 (reversion_script.patch), y run.sh §6c la prueba sola, junto con la 0900 y en la reversión total.
--
-- ⚠ REVERTIR REABRE LA BRECHA: una persona acotada vuelve a poder insertar borradores en proyectos que no tiene asignados, insertar o mover
--   documentos de/hacia «sin proyecto» y agregar renglones a borradores ajenos. Comprobado en una base desechable: la huella del catálogo
--   (disparadores, funciones con el hash de su definición, índices, restricciones, políticas y columnas; supabase/tests/compras_bloque_b/reversion_catalogo.sql)
--   vuelve EXACTA a la de antes de aplicar la propuesta (objetos comparados según la base: 9 797 en la cadena del #926 sola, 9 805 con fixture.sql cargado;
--   +5 con la 20261026000600 del #928: 9 802 y 9 810; README.md §7 e impacto.md §8).
--
-- BLOQUEOS: DROP TRIGGER toma ACCESS EXCLUSIVE sobre cada una de las 9 tablas hasta el final de la transacción (bloquea incluso las lecturas):
--   por eso va con lock_timeout = 10 s (si una tabla está ocupada falla entera y se reintenta) y conviene correrla fuera de pagos y aprobaciones.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DROP TRIGGER IF EXISTS trg_zzzcompras_alcance_captura ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_zzzcompras_alcance_captura ON public.recepciones;
DROP TRIGGER IF EXISTS trg_zzzcompras_alcance_captura ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_zzzcompras_alcance_captura ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_zzzcompras_alcance_captura ON public.contrasenas_pago;

DROP TRIGGER IF EXISTS trg_zzzcompras_alcance_hija ON public.orden_compra_lineas;
DROP TRIGGER IF EXISTS trg_zzzcompras_alcance_hija ON public.recepcion_lineas;
DROP TRIGGER IF EXISTS trg_zzzcompras_alcance_hija ON public.factura_proveedor_lineas;
DROP TRIGGER IF EXISTS trg_zzzcompras_alcance_hija ON public.contrasena_pago_facturas;

DROP FUNCTION IF EXISTS public.compras_tg_alcance_captura();
DROP FUNCTION IF EXISTS public.compras_tg_alcance_hija();
DROP FUNCTION IF EXISTS public.compras_puede_destinar_proyecto(uuid);

-- Comprobación: lo añadido ya no está y lo de la 0900 sigue.
DO $reversion$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN ('trg_zzzcompras_alcance_captura', 'trg_zzzcompras_alcance_hija'))
     OR to_regprocedure('public.compras_tg_alcance_captura()') IS NOT NULL
     OR to_regprocedure('public.compras_tg_alcance_hija()') IS NOT NULL
     OR to_regprocedure('public.compras_puede_destinar_proyecto(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'COMPRAS_REVERSION: quedó algo del alcance de proyecto al capturar; se revierte toda la transacción.' USING ERRCODE = 'internal_error';
  END IF;
  IF to_regprocedure('public.compras_tg_mover_alcance()') IS NULL
     OR (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = 'trg_zzcompras_mover_alcance') <> 5 THEN
    RAISE EXCEPTION 'COMPRAS_REVERSION: falta lo de la 20261027000900 (trg_zzcompras_mover_alcance); esta reversión no debía tocarlo.' USING ERRCODE = 'internal_error';
  END IF;
  RAISE NOTICE 'alcance de proyecto al capturar · reversión: 9 disparadores y 3 funciones fuera; la 0900 intacta; los datos no se tocaron.';
END
$reversion$;

COMMIT;
