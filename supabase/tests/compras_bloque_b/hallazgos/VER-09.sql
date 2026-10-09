-- ============================================================================
-- VER-09 · IDEMPOTENCIA DE LA ORDEN DE PAGO (y de la contraseña de pago)
--
-- Hallazgo: la orden de pago no tiene clave de idempotencia. Un doble clic o un reintento tras
--   perder la respuesta crea DOS órdenes de la misma factura y las dos se pagan mientras quepan
--   en el saldo (dos órdenes de 400 sobre 1 000: 800 pagados, dos asientos).
-- Causa raíz: `ordenes_pago` (y `contrasenas_pago`) no tienen `clave_idempotencia` ni índice
--   único; los controles de saldo ven dos pagos parciales legítimos, no un duplicado. Solo
--   contrato_ampliaciones, facturas_proveedor, ordenes_compra y recepciones la tenían.
-- Comportamiento esperado: la misma clave (un intento de captura) NO crea dos órdenes: el
--   reintento lo rechaza el índice único `uq_ordenes_pago_clave` (también con dos sesiones a la
--   vez, ver VER-09.conc.sh); la clave no se edita ni se borra; sin clave o con claves distintas
--   siguen siendo posibles dos órdenes parciales; la clave no se cruza entre empresas; el ciclo
--   aprobar → pagar → anular y el asiento funcionan igual con clave. Lo mismo en contrasenas_pago.
--
-- HOY (sin la corrección) debe FALLAR en [VER-09a] (la columna no existe). Con la migración 20261027000800 (pieza VER-09), pasar.
-- Se corre sobre una copia de hall_tpl (suite ya corrida; usa sus ayudas como()/chk*()).
-- ============================================================================
\set ON_ERROR_STOP on
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set D1  '''d1d1d1d1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set PD  '''e3000000-0000-0000-0000-0000000000d1'''

-- ── a · el esquema: columna + índice único PARCIAL por empresa (en ordenes_pago y en contrasenas_pago) ──
SELECT public.chk_bool(EXISTS (SELECT 1 FROM information_schema.columns
                                WHERE table_schema = 'public' AND table_name = 'ordenes_pago' AND column_name = 'clave_idempotencia'), true,
  '[VER-09a] ordenes_pago tiene clave_idempotencia (como facturas_proveedor, ordenes_compra y recepciones)');
SELECT public.chk_bool(EXISTS (SELECT 1 FROM pg_indexes
                                WHERE schemaname = 'public' AND tablename = 'ordenes_pago' AND indexname = 'uq_ordenes_pago_clave'
                                  AND indexdef ~ 'UNIQUE INDEX uq_ordenes_pago_clave ON public\.ordenes_pago USING btree \(company_id, clave_idempotencia\) WHERE \(clave_idempotencia IS NOT NULL\)'), true,
  '[VER-09a] y un índice único PARCIAL (company_id, clave_idempotencia) WHERE clave_idempotencia IS NOT NULL');
SELECT public.chk_bool(EXISTS (SELECT 1 FROM pg_indexes
                                WHERE schemaname = 'public' AND tablename = 'contrasenas_pago' AND indexname = 'uq_contrasenas_pago_clave'
                                  AND indexdef ~ 'UNIQUE INDEX uq_contrasenas_pago_clave ON public\.contrasenas_pago USING btree \(company_id, clave_idempotencia\) WHERE \(clave_idempotencia IS NOT NULL\)'), true,
  '[VER-09a] lo mismo en contrasenas_pago (uq_contrasenas_pago_clave)');
SELECT public.chk_bool(NOT has_function_privilege('authenticated', 'public.compras_tg_pago_clave_inmutable()', 'EXECUTE')
                       AND NOT has_function_privilege('anon', 'public.compras_tg_pago_clave_inmutable()', 'EXECUTE'), true,
  '[VER-09a] la función de trigger nueva no la ejecuta authenticated ni anon');

-- ── Datos propios: facturas APROBADAS por gasto directo (sin orden de compra) ───────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES
  ('faa00001-0000-0000-0000-0000000000f1', :C::uuid, :C1::uuid, :P1::uuid, 'VER09-A-1001', 'a · reintento que cabe',        1000),
  ('faa00002-0000-0000-0000-0000000000f2', :C::uuid, :C1::uuid, :P1::uuid, 'VER09-B-2002', 'd · órdenes distintas legítimas', 1000),
  ('faa00003-0000-0000-0000-0000000000f3', :C::uuid, :C1::uuid, :P1::uuid, 'VER09-C-3003', 'e · ciclo de vida con clave',    1000),
  ('faa00004-0000-0000-0000-0000000000f4', :C::uuid, :C1::uuid, :P1::uuid, 'VER09-E-4004', 'c · reintento por el saldo total', 300),
  ('faa00005-0000-0000-0000-0000000000f5', :C::uuid, :C1::uuid, :P1::uuid, 'VER09-F-5005', 'g · formato de la clave',        1000),
  ('faa00006-0000-0000-0000-0000000000f6', :C::uuid, :C1::uuid, :P1::uuid, 'VER09-G-6006', 'j · contraseña 1',              1000),
  ('faa00008-0000-0000-0000-0000000000f8', :C::uuid, :C1::uuid, :P1::uuid, 'VER09-J-8008', 'j · contraseña 2',              1000),
  ('faa00009-0000-0000-0000-0000000000f9', :C::uuid, :C1::uuid, :P1::uuid, 'VER09-J-9009', 'j · contraseña 3',              1000),
  ('faa0000a-0000-0000-0000-0000000000fa', :C::uuid, :C1::uuid, :P1::uuid, 'VER09-L-A00A', 'l · doble «marcar pagada»',     1000);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id IN
  ('faa00001-0000-0000-0000-0000000000f1', 'faa00002-0000-0000-0000-0000000000f2', 'faa00003-0000-0000-0000-0000000000f3',
   'faa00004-0000-0000-0000-0000000000f4', 'faa00005-0000-0000-0000-0000000000f5', 'faa00006-0000-0000-0000-0000000000f6',
   'faa00008-0000-0000-0000-0000000000f8', 'faa00009-0000-0000-0000-0000000000f9', 'faa0000a-0000-0000-0000-0000000000fa');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id::text LIKE 'faa0000_-%' AND estado = 'aprobada'), 9,
  '[VER-09a] preparación: nueve facturas aprobadas de la empresa C');
-- Las filas que YA existían (las deja la suite de controles) no se tocan: su clave es NULL.
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE id::text NOT LIKE 'faa%' AND clave_idempotencia IS NOT NULL), 0,
  '[VER-09a] las órdenes de pago que ya existían quedan con clave NULL (cambio aditivo, nada se revalida)');
SELECT public.chk((SELECT count(*) FROM public.contrasenas_pago WHERE id::text NOT LIKE 'faa%' AND clave_idempotencia IS NOT NULL), 0,
  '[VER-09a] las contraseñas que ya existían quedan con clave NULL');

-- ── b · EL HALLAZGO: el mismo intento (misma clave) dos veces, cabe en el saldo (400 + 400 sobre 1 000) ──
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, metodo_pago, referencia, clave_idempotencia)
VALUES ('faa10001-0000-0000-0000-0000000000a1', :C::uuid, :C1::uuid, :P1::uuid, 'faa00001-0000-0000-0000-0000000000f1', 400, 'transferencia', 'SPEI-123', 'ver09-clave-a-0001');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, metodo_pago, referencia, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','faa00001-0000-0000-0000-0000000000f1',400,'transferencia','SPEI-123','ver09-clave-a-0001') $$,
  'uq_ordenes_pago_clave', '[VER-09b] el reintento (misma clave, mismo contenido, cabe en el saldo) lo rechaza el índice único');
-- Otro contenido con la MISMA clave (el usuario cambió el monto y reintentó): tampoco se crea otra.
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, metodo_pago, referencia, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','faa00001-0000-0000-0000-0000000000f1',250,'cheque','OTRA','ver09-clave-a-0001') $$,
  'uq_ordenes_pago_clave', '[VER-09b] la misma clave con OTRO contenido tampoco crea una segunda orden');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE factura_id = 'faa00001-0000-0000-0000-0000000000f1'), 1,
  '[VER-09b] la factura tiene UNA sola orden de pago (el reintento no dejó nada)');
SELECT public.chk_num((SELECT COALESCE(sum(monto), 0) FROM public.ordenes_pago WHERE factura_id = 'faa00001-0000-0000-0000-0000000000f1'), 400,
  '[VER-09b] y lo reservado es 400, no 800');
-- El mismo trámite completo: la única orden se aprueba y se paga una sola vez.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE factura_id = 'faa00001-0000-0000-0000-0000000000f1';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE factura_id = 'faa00001-0000-0000-0000-0000000000f1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'faa00001-0000-0000-0000-0000000000f1'),
  'pagada_parcial/400.00', '[VER-09b] se pagó 400 una sola vez (antes del arreglo: 800)');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'ordenes_pago' AND estado = 'publicado'
                    AND origen_evento = 'orden_pago_pagada'
                    AND origen_id IN (SELECT id FROM public.ordenes_pago WHERE factura_id = 'faa00001-0000-0000-0000-0000000000f1')), 1,
  '[VER-09b] y hay UN asiento de pago');

-- ── c · reintento por el saldo TOTAL (lo que la pantalla propone por omisión): lo frena el saldo, y la
--       orden original se recupera por su clave sin depender del texto del error ────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
VALUES ('faa10002-0000-0000-0000-0000000000a2', :C::uuid, :C1::uuid, :P1::uuid, 'faa00004-0000-0000-0000-0000000000f4', 300, 'ver09-clave-c-0001');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','faa00004-0000-0000-0000-0000000000f4',300,'ver09-clave-c-0001') $$,
  'COMPRAS_PAGO_EXCEDE_SALDO|uq_ordenes_pago_clave', '[VER-09c] el reintento del saldo total también se rechaza (por saldo o por la clave; nunca crea otra)');
-- Recuperación que hará la pantalla: buscar por (empresa, clave) con la sesión del usuario.
SELECT public.chk_uuid((SELECT id FROM public.ordenes_pago WHERE company_id = :C::uuid AND clave_idempotencia = 'ver09-clave-c-0001'),
  'faa10002-0000-0000-0000-0000000000a2'::uuid, '[VER-09c] la orden original se recupera por su clave con la sesión del propio usuario');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE factura_id = 'faa00004-0000-0000-0000-0000000000f4'), 1,
  '[VER-09c] sigue habiendo UNA orden');

-- ── d · LO LEGÍTIMO sigue siendo posible: dos pagos parciales distintos (clave distinta, o sin clave) ──
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, referencia, clave_idempotencia) VALUES
  ('faa10003-0000-0000-0000-0000000000a3', :C::uuid, :C1::uuid, :P1::uuid, 'faa00002-0000-0000-0000-0000000000f2', 400, 'SPEI-1', 'ver09-clave-d-0001'),
  ('faa10004-0000-0000-0000-0000000000a4', :C::uuid, :C1::uuid, :P1::uuid, 'faa00002-0000-0000-0000-0000000000f2', 400, 'SPEI-1', 'ver09-clave-d-0002');
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, referencia) VALUES
  ('faa10005-0000-0000-0000-0000000000a5', :C::uuid, :C1::uuid, :P1::uuid, 'faa00002-0000-0000-0000-0000000000f2', 100, 'SPEI-1'),
  ('faa10006-0000-0000-0000-0000000000a6', :C::uuid, :C1::uuid, :P1::uuid, 'faa00002-0000-0000-0000-0000000000f2', 100, 'SPEI-1');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE factura_id = 'faa00002-0000-0000-0000-0000000000f2'), 4,
  '[VER-09d] dos claves distintas + dos órdenes SIN clave sobre la misma factura: las cuatro se aceptan');
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE factura_id = 'faa00002-0000-0000-0000-0000000000f2' AND clave_idempotencia IS NULL), 2,
  '[VER-09d] las órdenes sin clave quedan con la clave en NULL (el índice parcial no las junta)');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','faa00002-0000-0000-0000-0000000000f2',1,'ver09-clave-d-0003') $$,
  'COMPRAS_PAGO_EXCEDE_SALDO', '[VER-09d] los controles de saldo de siempre siguen (1 000 reservados, no cabe 1 más)');
RESET ROLE;

-- ── e · el ciclo con clave: aprobar → pagar → anular funciona igual, con su asiento y su reverso ──────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
VALUES ('faa10007-0000-0000-0000-0000000000a7', :C::uuid, :C1::uuid, :P1::uuid, 'faa00003-0000-0000-0000-0000000000f3', 400, 'ver09-clave-e-0001');
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'faa10007-0000-0000-0000-0000000000a7';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'faa10007-0000-0000-0000-0000000000a7';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'faa00003-0000-0000-0000-0000000000f3'),
  'pagada_parcial/400.00', '[VER-09e] una orden con clave se aprueba y se paga: la factura queda pagada parcial (400)');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'ordenes_pago' AND estado = 'publicado'
                    AND origen_evento = 'orden_pago_pagada' AND origen_id = 'faa10007-0000-0000-0000-0000000000a7'), 1,
  '[VER-09e] y se contabiliza UNA vez');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','faa00003-0000-0000-0000-0000000000f3',400,'ver09-clave-e-0001') $$,
  'uq_ordenes_pago_clave', '[VER-09e] el reintento DESPUÉS de pagada la primera sigue rechazado por la clave');
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'faa10007-0000-0000-0000-0000000000a7';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'faa00003-0000-0000-0000-0000000000f3'),
  'aprobada/0.00', '[VER-09e] anular el pago devuelve el saldo (la factura vuelve a aprobada, 0 pagado)');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'ordenes_pago' AND estado = 'publicado'
                    AND origen_evento = 'orden_pago_pagada_revertido' AND origen_id = 'faa10007-0000-0000-0000-0000000000a7'), 1,
  '[VER-09e] y el reverso contable queda registrado');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
-- La captura ya ocurrió: la clave de una orden anulada NO se reutiliza (otra captura = otra clave).
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','faa00003-0000-0000-0000-0000000000f3',400,'ver09-clave-e-0001') $$,
  'uq_ordenes_pago_clave', '[VER-09e] la clave de una orden anulada no se reutiliza (la captura ya ocurrió)');
-- ... pero una captura NUEVA (clave nueva) sobre la misma factura, ya liberado el saldo, sí se puede pagar.
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
VALUES ('faa10008-0000-0000-0000-0000000000a8', :C::uuid, :C1::uuid, :P1::uuid, 'faa00003-0000-0000-0000-0000000000f3', 400, 'ver09-clave-e-0002');
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'faa10008-0000-0000-0000-0000000000a8';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'faa10008-0000-0000-0000-0000000000a8';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'faa00003-0000-0000-0000-0000000000f3'),
  'pagada_parcial/400.00', '[VER-09e] una captura nueva (clave nueva) se paga con normalidad tras la anulación');

-- ── f · la clave no se edita ni se borra después (si se pudiera, el reintento volvería a pasar) ───────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET clave_idempotencia = 'ver09-clave-otra-1' WHERE id = 'faa10003-0000-0000-0000-0000000000a3' $$,
  'COMPRAS_PAGO_CLAVE_INMUTABLE', '[VER-09f] la clave de una orden no se cambia');
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET clave_idempotencia = NULL WHERE id = 'faa10003-0000-0000-0000-0000000000a3' $$,
  'COMPRAS_PAGO_CLAVE_INMUTABLE', '[VER-09f] ni se borra (poner NULL reabriría el reintento)');
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET clave_idempotencia = 'ver09-clave-tarde-1' WHERE id = 'faa10005-0000-0000-0000-0000000000a5' $$,
  'COMPRAS_PAGO_CLAVE_INMUTABLE', '[VER-09f] ni se le pone clave a posteriori a una orden que nació sin ella');
UPDATE public.ordenes_pago SET notas = 'editada', clave_idempotencia = 'ver09-clave-d-0001' WHERE id = 'faa10003-0000-0000-0000-0000000000a3';
RESET ROLE;
SELECT public.chk_txt((SELECT notas || '/' || clave_idempotencia FROM public.ordenes_pago WHERE id = 'faa10003-0000-0000-0000-0000000000a3'),
  'editada/ver09-clave-d-0001', '[VER-09f] editar otros campos de una orden con clave (o reenviar la misma clave) sigue funcionando');

-- ── g · formato de la clave: ni vacía, ni corta, ni con espacios en los extremos, ni de más de 200 ────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','faa00005-0000-0000-0000-0000000000f5',10,'') $$,
  'ordenes_pago_clave_longitud', '[VER-09g] una clave vacía no es una clave (sería común a todos los intentos)');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','faa00005-0000-0000-0000-0000000000f5',10,'corta') $$,
  'ordenes_pago_clave_longitud', '[VER-09g] una clave de menos de 8 caracteres se rechaza');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','faa00005-0000-0000-0000-0000000000f5',10,' ver09-clave-g-espacios ') $$,
  'ordenes_pago_clave_longitud', '[VER-09g] una clave con espacios en los extremos se rechaza (no se burla con «clave » vs «clave»)');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','faa00005-0000-0000-0000-0000000000f5',10,repeat('k', 201)) $$,
  'ordenes_pago_clave_longitud', '[VER-09g] una clave de más de 200 caracteres se rechaza');
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia) VALUES
  ('faa10009-0000-0000-0000-0000000000a9', :C::uuid, :C1::uuid, :P1::uuid, 'faa00005-0000-0000-0000-0000000000f5', 10, '12345678'),
  ('faa1000a-0000-0000-0000-0000000000aa', :C::uuid, :C1::uuid, :P1::uuid, 'faa00005-0000-0000-0000-0000000000f5', 10, repeat('k', 200));
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE factura_id = 'faa00005-0000-0000-0000-0000000000f5'), 2,
  '[VER-09g] los extremos válidos (8 y 200 caracteres) sí se aceptan');

-- ── h · la clave es por EMPRESA: otra empresa puede usar el mismo texto; no se cruzan ────────────────
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('faa00007-0000-0000-0000-0000000000f7', :D::uuid, :D1::uuid, :PD::uuid, 'VER09-D-7007', 'h · otra empresa', 500);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'faa00007-0000-0000-0000-0000000000f7';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
VALUES ('faa1000b-0000-0000-0000-0000000000ab', :D::uuid, :D1::uuid, :PD::uuid, 'faa00007-0000-0000-0000-0000000000f7', 100, 'ver09-clave-a-0001');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
                           VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','d1d1d1d1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-0000000000d1','faa00007-0000-0000-0000-0000000000f7',100,'ver09-clave-a-0001') $$,
  'uq_ordenes_pago_clave', '[VER-09h] dentro de la empresa D el reintento también se rechaza');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE clave_idempotencia = 'ver09-clave-a-0001'), 2,
  '[VER-09h] el mismo texto de clave existe UNA vez en C y UNA vez en D (la unicidad es por empresa)');

-- ── i · caminos de sistema (sin sesión de usuario: service_role, procesos): la clave es opcional y se respeta ──
SELECT set_config('request.jwt.claim.sub', '', false);
SET ROLE service_role;
SELECT public.chk_bool(auth.uid() IS NULL, true, '[VER-09i] preparación: service_role, sin sesión de usuario (auth.uid() es NULL)');
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia) VALUES
  ('faa1000c-0000-0000-0000-0000000000ac', :C::uuid, :C1::uuid, :P1::uuid, 'faa00001-0000-0000-0000-0000000000f1', 100, NULL),
  ('faa1000d-0000-0000-0000-0000000000ad', :C::uuid, :C1::uuid, :P1::uuid, 'faa00001-0000-0000-0000-0000000000f1', 100, 'ver09-clave-i-0001');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','faa00001-0000-0000-0000-0000000000f1',100,'ver09-clave-i-0001') $$,
  'uq_ordenes_pago_clave', '[VER-09i] sin sesión de usuario el reintento con la misma clave también se rechaza');
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET clave_idempotencia = NULL WHERE id = 'faa1000d-0000-0000-0000-0000000000ad' $$,
  'COMPRAS_PAGO_CLAVE_INMUTABLE', '[VER-09i] ni siquiera sin sesión se borra la clave (solo el camino de sistema marcado)');
BEGIN;
SELECT set_config('conta.allow_system_write', 'on', true);
UPDATE public.ordenes_pago SET clave_idempotencia = 'ver09-clave-i-0002' WHERE id = 'faa1000d-0000-0000-0000-0000000000ad';
COMMIT;
RESET ROLE;
SELECT public.chk_txt((SELECT clave_idempotencia FROM public.ordenes_pago WHERE id = 'faa1000d-0000-0000-0000-0000000000ad'),
  'ver09-clave-i-0002', '[VER-09i] el camino de sistema (conta.allow_system_write) sí puede corregirla');
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE id = 'faa1000c-0000-0000-0000-0000000000ac' AND clave_idempotencia IS NULL), 1,
  '[VER-09i] y una orden de sistema SIN clave sigue siendo válida (la clave no es obligatoria)');

-- ── j · contrasenas_pago: la segunda cabecera del doble clic se rechaza ANTES de que quede huérfana ────
--       (una factura distinta por contraseña y montos bajos: la prueba no depende de cómo se reparta el saldo)
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada, clave_idempotencia)
VALUES ('faa20001-0000-0000-0000-0000000000c1', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE, 'ver09-clave-cp-0001');
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'faa20001-0000-0000-0000-0000000000c1', 'faa00006-0000-0000-0000-0000000000f6', 300);
SELECT public.chk_falla($$ INSERT INTO public.contrasenas_pago (company_id, project_id, proveedor_id, fecha_pago_programada, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001',CURRENT_DATE,'ver09-clave-cp-0001') $$,
  'uq_contrasenas_pago_clave', '[VER-09j] el reintento de emitir la contraseña (misma clave) lo rechaza el índice');
-- Lo legítimo: otra contraseña con otra clave, y otra sin clave.
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada, clave_idempotencia)
VALUES ('faa20002-0000-0000-0000-0000000000c2', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE, 'ver09-clave-cp-0002');
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'faa20002-0000-0000-0000-0000000000c2', 'faa00008-0000-0000-0000-0000000000f8', 300);
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('faa20003-0000-0000-0000-0000000000c3', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'faa20003-0000-0000-0000-0000000000c3', 'faa00009-0000-0000-0000-0000000000f9', 300);
SELECT public.chk_falla($$ UPDATE public.contrasenas_pago SET clave_idempotencia = NULL WHERE id = 'faa20001-0000-0000-0000-0000000000c1' $$,
  'COMPRAS_PAGO_CLAVE_INMUTABLE', '[VER-09j] la clave de la contraseña no se borra');
SELECT public.chk_falla($$ UPDATE public.contrasenas_pago SET clave_idempotencia = 'ver09-clave-cp-9999' WHERE id = 'faa20003-0000-0000-0000-0000000000c3' $$,
  'COMPRAS_PAGO_CLAVE_INMUTABLE', '[VER-09j] ni se le pone a una contraseña que nació sin ella');
SELECT public.chk_falla($$ INSERT INTO public.contrasenas_pago (company_id, project_id, proveedor_id, fecha_pago_programada, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001',CURRENT_DATE,'corta') $$,
  'contrasenas_pago_clave_longitud', '[VER-09j] el formato de la clave (mínimo 8) también rige en contraseñas');
-- La orden de pago POR CONTRASEÑA lleva su propia clave y se comporta igual.
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto, clave_idempotencia)
VALUES ('faa1000e-0000-0000-0000-0000000000ae', :C::uuid, :C1::uuid, :P1::uuid, 'faa20001-0000-0000-0000-0000000000c1', 300, 'ver09-clave-cpo-0001');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, contrasena_pago_id, monto, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','faa20001-0000-0000-0000-0000000000c1',300,'ver09-clave-cpo-0001') $$,
  'uq_ordenes_pago_clave|COMPRAS_CONTRASENA_YA_TIENE_ORDEN|uq_ordenes_pago_contrasena_viva',
  '[VER-09j] el reintento de la orden de pago de una contraseña no crea otra (la clave o la exclusividad de la contraseña)');
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'faa1000e-0000-0000-0000-0000000000ae';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'faa1000e-0000-0000-0000-0000000000ae';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.contrasenas_pago WHERE id::text LIKE 'faa2000_-%'), 3,
  '[VER-09j] quedaron tres contraseñas (con clave, con otra clave y sin clave), ninguna duplicada por el reintento');
SELECT public.chk((SELECT count(*) FROM public.contrasenas_pago c WHERE c.id::text LIKE 'faa2000_-%'
                    AND NOT EXISTS (SELECT 1 FROM public.contrasena_pago_facturas p WHERE p.contrasena_id = c.id)), 0,
  '[VER-09j] y ninguna cabecera quedó huérfana (sin partidas)');
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE contrasena_pago_id = 'faa20001-0000-0000-0000-0000000000c1'), 1,
  '[VER-09j] la contraseña tiene UNA sola orden de pago');
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'faa00006-0000-0000-0000-0000000000f6'),
  'pagada_parcial/300.00', '[VER-09j] la orden de la contraseña con clave se paga y aplica 300 a su factura');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'ordenes_pago' AND estado = 'publicado'
                    AND origen_evento = 'orden_pago_pagada' AND origen_id = 'faa1000e-0000-0000-0000-0000000000ae'), 1,
  '[VER-09j] y se contabiliza UNA vez');

-- ── k · la clave no abre ningún permiso ni filtra nada entre empresas ────────────────────────────────────
-- El administrador de D intenta crear una orden EN C con una clave que YA existe en C ('ver09-clave-a-0001', de [b]):
-- lo detienen el aislamiento y RLS ANTES que el índice (el error no revela que esa clave existe en la otra empresa).
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','faa00005-0000-0000-0000-0000000000f5',10,'ver09-clave-a-0001') $$,
  'row-level security|COMPRAS_', '[VER-09k] el administrador de D no crea una orden en C aunque envíe una clave de C: rige el aislamiento, no el índice');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE company_id = :C::uuid AND clave_idempotencia = 'ver09-clave-a-0001'), 1,
  '[VER-09k] y en C sigue habiendo UNA orden con esa clave');
-- Y el usuario de C sin sesión válida de la empresa tampoco: un usuario SIN fila en app_users no inserta nada.
SELECT public.como('c0c0c0c0-0000-0000-0000-0000000000ff'::uuid);   -- no existe en app_users
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','faa00005-0000-0000-0000-0000000000f5',10,'ver09-clave-k-0002') $$,
  'row-level security|COMPRAS_', '[VER-09k] una sesión que no es de la empresa no crea la orden aunque mande clave');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE clave_idempotencia = 'ver09-clave-k-0002'), 0,
  '[VER-09k] y no queda rastro de la clave rechazada');

-- ── l · LO QUE YA ERA IDEMPOTENTE sigue siéndolo: marcar pagada dos veces no paga dos veces ─────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, clave_idempotencia)
VALUES ('faa10010-0000-0000-0000-0000000000b0', :C::uuid, :C1::uuid, :P1::uuid, 'faa0000a-0000-0000-0000-0000000000fa', 400, 'ver09-clave-l-0001');
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'faa10010-0000-0000-0000-0000000000b0';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'faa10010-0000-0000-0000-0000000000b0';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'faa10010-0000-0000-0000-0000000000b0';   -- el reintento del paso «pagar»
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'faa0000a-0000-0000-0000-0000000000fa'),
  'pagada_parcial/400.00', '[VER-09l] el reintento de «marcar pagada» no vuelve a pagar (400, no 800)');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'ordenes_pago' AND estado = 'publicado'
                    AND origen_evento = 'orden_pago_pagada' AND origen_id = 'faa10010-0000-0000-0000-0000000000b0'), 1,
  '[VER-09l] y sigue habiendo UN asiento');
