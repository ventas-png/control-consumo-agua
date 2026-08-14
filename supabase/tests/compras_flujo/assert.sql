-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes del riel de compras (Fase 6, migraciones 20260821*).
--
--    1-3   backfill y siembra sobre contabilidades que YA operaban
--    4-8   el candado: sin proveedor autorizado y vigente no hay orden
--    9-13  la orden: líneas, totales, correlativo por contabilidad, inmutabilidad
--   14-21  la recepción: GR/IR cuadrado, inventario, activos, sobre-recepción
--   22-27  la factura: cuadre de 3 vías, tolerancia, y la 2105 cerrando en cero
--   28-33  la contraseña: agrupa facturas y UNA orden las cancela todas
--   34-38  reversos: anular deshace exactamente lo que hizo
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

\set CO '11111111-1111-1111-1111-111111111111'
\set PR '22222222-2222-2222-2222-222222222222'
\set USR '99999999-9999-9999-9999-999999999999'

-- ─────────────────────────────────────────────────────────────────────────────
-- 1-3 · Backfill y siembra retroactiva
-- ─────────────────────────────────────────────────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM public.ordenes_compra WHERE proveedor_id IS NOT NULL), 1,
  '1 la orden vieja de texto libre quedó enganchada al catálogo de proveedores');

-- Nace en 'borrador', NO autorizada: el backfill no puede fabricar la
-- autorización que esta fase viene justamente a exigir.
SELECT public.chk_txt(
  (SELECT p.estado FROM public.proveedores p
   JOIN public.ordenes_compra o ON o.proveedor_id = p.id
   WHERE o.concepto = 'Pintura para el muro perimetral'), 'borrador',
  '2 el proveedor creado por el backfill NO nace autorizado');

-- Las cuentas nuevas se sembraron en los DOS ledgers que ya existían.
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas WHERE codigo IN ('1106','2105','1401','1409','5107')), 10,
  '3 las cuentas nuevas se retro-sembraron en la empresa y en el proyecto (5×2)');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4-8 · El candado del proveedor autorizado
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.proveedores (id, company_id, nombre)
VALUES ('55555555-5555-5555-5555-555555555555', :'CO', 'Suministros del Valle');

SELECT public.chk_txt(
  (SELECT estado FROM public.proveedores WHERE id = '55555555-5555-5555-5555-555555555555'), 'borrador',
  '4 un proveedor nuevo nace en borrador, no autorizado');

SELECT public.chk(
  (SELECT public.proveedor_habilitado('55555555-5555-5555-5555-555555555555')::int), 0,
  '5 y por tanto no está habilitado para recibir órdenes');

INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('66666666-6666-6666-6666-666666666666', :'CO', :'PR',
        '55555555-5555-5555-5555-555555555555', 'Suministros del Valle', 'Insumos de piscina');

SELECT public.chk_falla(
  $$UPDATE public.ordenes_compra SET estado='aprobada' WHERE id='66666666-6666-6666-6666-666666666666'$$,
  'COMPRAS_PROVEEDOR_NO_AUTORIZADO',
  '6 aprobar una orden de un proveedor sin autorizar se rechaza');

UPDATE public.proveedores SET estado = 'autorizado', autorizacion_vence = CURRENT_DATE - 1
 WHERE id = '55555555-5555-5555-5555-555555555555';

SELECT public.chk_falla(
  $$UPDATE public.ordenes_compra SET estado='aprobada' WHERE id='66666666-6666-6666-6666-666666666666'$$,
  'COMPRAS_PROVEEDOR_NO_AUTORIZADO',
  '7 una autorización VENCIDA tampoco habilita, aunque el estado diga autorizado');

UPDATE public.proveedores SET autorizacion_vence = NULL WHERE id = '55555555-5555-5555-5555-555555555555';
SELECT public.chk(
  (SELECT activo::int FROM public.proveedores WHERE id = '55555555-5555-5555-5555-555555555555'), 1,
  '8 autorizar deja `activo` en true (proyección del estado, para la UI vieja)');

-- ─────────────────────────────────────────────────────────────────────────────
-- 9-13 · La orden de compra
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.orden_compra_lineas
  (company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, cantidad, unidad, precio_unitario)
VALUES (:'CO', '66666666-6666-6666-6666-666666666666', 1, 'Cloro granular 45kg', 'inventario',
        '44444444-4444-4444-4444-444444444444', 10, 'saco', 350.00);
-- La línea de servicio lleva `categoria` explícita: es lo que decide contra qué
-- cuenta de gasto se debita (mantenimiento → 5101). La de inventario se deja en
-- la categoría por defecto ('otros' → 5199) a propósito, para que la aserción
-- 31 pueda distinguir la variación de precio del gasto del servicio.
INSERT INTO public.orden_compra_lineas
  (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES (:'CO', '66666666-6666-6666-6666-666666666666', 2, 'Bomba dosificadora', 'activo_fijo', 'otros', 1, 'unidad', 4500.00),
       (:'CO', '66666666-6666-6666-6666-666666666666', 3, 'Instalación', 'servicio', 'mantenimiento', 1, 'servicio', 800.00);

SELECT public.chk(
  (SELECT total FROM public.ordenes_compra WHERE id = '66666666-6666-6666-6666-666666666666'), 8800.00,
  '9 la cabecera toma sus totales de las líneas (10×350 + 4500 + 800)');

UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '66666666-6666-6666-6666-666666666666';

SELECT public.chk_txt(
  (SELECT numero FROM public.ordenes_compra WHERE id = '66666666-6666-6666-6666-666666666666'), 'OC-000001',
  '10 al aprobar se asigna correlativo de ESTA contabilidad');

SELECT public.chk(
  (SELECT (aprobada_at IS NOT NULL)::int FROM public.ordenes_compra WHERE id = '66666666-6666-6666-6666-666666666666'), 1,
  '11 y queda sellada con la fecha de aprobación');

SELECT public.chk_falla(
  $$UPDATE public.orden_compra_lineas SET cantidad = 99
     WHERE orden_compra_id = '66666666-6666-6666-6666-666666666666' AND linea = 1$$,
  'COMPRAS_OC_INMUTABLE',
  '12 las líneas de una orden aprobada ya no se editan');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'ordenes_compra'), 0,
  '13 aprobar la orden NO genera asiento: es un compromiso, no un gasto');

-- ─────────────────────────────────────────────────────────────────────────────
-- 14-21 · La recepción: GR/IR, inventario y activos
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, documento_referencia)
VALUES ('77777777-7777-7777-7777-777777777777', :'CO', :'PR',
        '66666666-6666-6666-6666-666666666666', 'Envío 8871');

-- Llegan 6 de los 10 sacos, la bomba y el servicio.
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
SELECT :'CO', '77777777-7777-7777-7777-777777777777', l.id,
       CASE l.linea WHEN 1 THEN 6 ELSE 1 END
FROM public.orden_compra_lineas l
WHERE l.orden_compra_id = '66666666-6666-6666-6666-666666666666';

SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'recepciones'), 0,
  '14 una recepción en BORRADOR todavía no contabiliza nada');

UPDATE public.recepciones SET estado = 'registrada' WHERE id = '77777777-7777-7777-7777-777777777777';

SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos
    WHERE origen_tabla = 'recepciones' AND estado = 'publicado'), 1,
  '15 registrarla publica UN asiento');

SELECT public.chk(
  (SELECT SUM(l.debe) - SUM(l.haber) FROM public.conta_asiento_lineas l
   JOIN public.conta_asientos a ON a.id = l.asiento_id WHERE a.origen_tabla = 'recepciones'), 0.00,
  '16 y ese asiento CUADRA (debe = haber)');

SELECT public.chk(public.saldo('1106'), 2100.00, '17 inventario debitado al costo de orden (6 × 350)');
SELECT public.chk(public.saldo('1401'), 4500.00, '18 activo fijo debitado (la bomba)');
SELECT public.chk(public.saldo('5101'), 800.00,  '19 el servicio va directo al gasto de su categoría');
SELECT public.chk(public.saldo('2105'), -7400.00,
  '20 y todo se acredita a la cuenta puente 2105 «por facturar»');

SELECT public.chk(
  (SELECT stock_actual FROM public.suministros_condominio WHERE id = '44444444-4444-4444-4444-444444444444'), 10.00,
  '21a el stock subió de 4 a 10 sin que el navegador calculara nada');
-- (4×300 + 6×350) / 10 = 330
SELECT public.chk(
  (SELECT costo_unitario FROM public.suministros_condominio WHERE id = '44444444-4444-4444-4444-444444444444'), 330.0000,
  '21b con costo promedio ponderado');
SELECT public.chk(
  (SELECT count(*) FROM public.activos_fijos WHERE estado = 'activo'), 1,
  '21c y la bomba se dio de alta sola en el registro de activos');

SELECT public.chk_txt(
  (SELECT estado FROM public.ordenes_compra WHERE id = '66666666-6666-6666-6666-666666666666'), 'recibida_parcial',
  '21d la orden queda «recibida parcial»: faltan 4 sacos');

-- El stock es del libro de movimientos, no de quien escriba la columna.
UPDATE public.suministros_condominio SET stock_actual = 999
 WHERE id = '44444444-4444-4444-4444-444444444444';
SELECT public.chk(
  (SELECT stock_actual FROM public.suministros_condominio WHERE id = '44444444-4444-4444-4444-444444444444'), 10.00,
  '21e un UPDATE directo a stock_actual se ignora (un bundle viejo no cuenta doble)');

-- ─────────────────────────────────────────────────────────────────────────────
-- 22-27 · La factura y el cuadre de 3 vías
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.facturas_proveedor
  (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
VALUES ('88888888-8888-8888-8888-888888888881', :'CO', :'PR',
        '55555555-5555-5555-5555-555555555555', '66666666-6666-6666-6666-666666666666',
        'A-4471', 'Insumos y bomba', 'mantenimiento', 1);

INSERT INTO public.factura_proveedor_lineas
  (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto)
SELECT :'CO', '88888888-8888-8888-8888-888888888881', l.id, l.linea, l.descripcion,
       CASE l.linea WHEN 1 THEN 6 ELSE 1 END, l.precio_unitario,
       round(CASE l.linea WHEN 1 THEN 6 ELSE 1 END * l.precio_unitario * 0.12, 2)
FROM public.orden_compra_lineas l
WHERE l.orden_compra_id = '66666666-6666-6666-6666-666666666666';

SELECT public.chk(
  (SELECT monto_total FROM public.facturas_proveedor WHERE id = '88888888-8888-8888-8888-888888888881'), 8288.00,
  '22 la cabecera de la factura se recalcula desde sus renglones (7400 + 888 IVA)');

SELECT public.chk(
  (SELECT count(*) FROM public.compras_validar_match('88888888-8888-8888-8888-888888888881')
    WHERE NOT dentro_tolerancia), 0,
  '23 el cuadre de 3 vías pasa: se factura lo pedido, al precio pedido');

UPDATE public.facturas_proveedor SET estado = 'aprobada'
 WHERE id = '88888888-8888-8888-8888-888888888881';

SELECT public.chk(public.saldo('2105'), 0.00,
  '24 aprobarla LIQUIDA la cuenta puente: lo recibido ya está facturado');
SELECT public.chk(public.saldo('2104'), -8288.00,
  '25 y la deuda pasa a Proveedores por pagar');
SELECT public.chk(public.saldo('1105'), 888.00,
  '26 con el IVA crédito fiscal desglosado');
-- El gasto NO se vuelve a debitar: ya se registró al recibir.
SELECT public.chk(public.saldo('5101'), 800.00,
  '27 el gasto del servicio NO se cuenta dos veces');

-- ── Segunda entrega + factura con precio fuera de tolerancia ────────────────
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, documento_referencia)
VALUES ('77777777-7777-7777-7777-777777777778', :'CO', :'PR',
        '66666666-6666-6666-6666-666666666666', 'Envío 8880');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
SELECT :'CO', '77777777-7777-7777-7777-777777777778', l.id, 4
FROM public.orden_compra_lineas l
WHERE l.orden_compra_id = '66666666-6666-6666-6666-666666666666' AND l.linea = 1;

-- Control positivo: la inmutabilidad es DESPUÉS de registrar. Mientras la
-- recepción esté en borrador se corrige lo que llegó, que es lo normal cuando
-- se está contando la entrega contra el envío.
UPDATE public.recepcion_lineas SET cantidad = 3 WHERE recepcion_id = '77777777-7777-7777-7777-777777777778';
SELECT public.chk(
  (SELECT cantidad FROM public.recepcion_lineas WHERE recepcion_id = '77777777-7777-7777-7777-777777777778'), 3.0000,
  '27b una recepción en borrador SÍ se corrige (la inmutabilidad llega al registrarla)');

UPDATE public.recepcion_lineas SET cantidad = 4 WHERE recepcion_id = '77777777-7777-7777-7777-777777777778';
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '77777777-7777-7777-7777-777777777778';

SELECT public.chk_falla(
  $$UPDATE public.recepcion_lineas SET cantidad = 9
     WHERE recepcion_id = '77777777-7777-7777-7777-777777777778'$$,
  'COMPRAS_RECEPCION_INMUTABLE',
  '27c y una vez registrada ya no');

INSERT INTO public.facturas_proveedor
  (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
VALUES ('88888888-8888-8888-8888-888888888882', :'CO', :'PR',
        '55555555-5555-5555-5555-555555555555', '66666666-6666-6666-6666-666666666666',
        'A-4490', 'Saldo de cloro', 'mantenimiento', 1);
INSERT INTO public.factura_proveedor_lineas
  (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto)
SELECT :'CO', '88888888-8888-8888-8888-888888888882', l.id, 1, 'Cloro granular 45kg', 4, 420.00, 201.60
FROM public.orden_compra_lineas l
WHERE l.orden_compra_id = '66666666-6666-6666-6666-666666666666' AND l.linea = 1;

SELECT public.chk_falla(
  $$UPDATE public.facturas_proveedor SET estado='aprobada' WHERE id='88888888-8888-8888-8888-888888888882'$$,
  'COMPRAS_MATCH_FUERA_DE_TOLERANCIA',
  '28 un precio 20% arriba del pedido NO se aprueba en silencio');

UPDATE public.facturas_proveedor
   SET estado = 'aprobada', match_forzado_por = :'USR',
       match_justificacion = 'Alza autorizada por gerencia.'
 WHERE id = '88888888-8888-8888-8888-888888888882';

SELECT public.chk(public.saldo('2105'), 0.00,
  '29 con justificación pasa, y la 2105 vuelve a cerrar en cero');
-- 4 × (420 − 350) = 280 a GASTO, no capitalizado al inventario: así el mayor
-- 1106 (3500 = 10 sacos al costo de orden) sigue igual al kardex.
SELECT public.chk(public.saldo('1106'), 3500.00,
  '30 el inventario queda al costo de ORDEN, alineado con el kardex');
SELECT public.chk(public.saldo('5199'), 280.00,
  '31 y la variación de precio se reconoce como gasto del periodo');
SELECT public.chk_txt(
  (SELECT estado FROM public.ordenes_compra WHERE id = '66666666-6666-6666-6666-666666666666'), 'cerrada',
  '32 recibida y facturada del todo, la orden se cierra sola');

SELECT public.chk(
  (SELECT count(*) FROM public.compras_validar_match('88888888-8888-8888-8888-888888888881')
    WHERE NOT dentro_tolerancia), 0,
  '33 releer el cuadre de una factura YA aprobada no la reporta fuera de tolerancia');

-- ─────────────────────────────────────────────────────────────────────────────
-- 34-38 · Contraseña de pago y cancelación multi-factura
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('99999999-aaaa-bbbb-cccc-000000000001', :'CO', :'PR',
        '55555555-5555-5555-5555-555555555555', CURRENT_DATE + 15);

INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
SELECT :'CO', '99999999-aaaa-bbbb-cccc-000000000001', f.id, f.monto_total - f.monto_pagado
FROM public.facturas_proveedor f
WHERE f.numero_factura IN ('A-4471', 'A-4490');

SELECT public.chk(
  (SELECT total FROM public.contrasenas_pago WHERE id = '99999999-aaaa-bbbb-cccc-000000000001'), 10169.60,
  '34 la contraseña agrupa las DOS facturas y suma su total');
SELECT public.chk_txt(
  (SELECT numero FROM public.contrasenas_pago WHERE id = '99999999-aaaa-bbbb-cccc-000000000001'), 'CP-000001',
  '35 con correlativo propio de esta contabilidad');

SELECT public.chk_falla(
  $$INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, contrasena_pago_id, monto, metodo_pago)
    VALUES ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
            '55555555-5555-5555-5555-555555555555','99999999-aaaa-bbbb-cccc-000000000001', 500, 'cheque')$$,
  'COMPRAS_ORDEN_MONTO_DISTINTO',
  '36 no se paga una contraseña por un monto distinto al que dice el documento');

INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto, metodo_pago, referencia)
VALUES ('aaaaaaaa-bbbb-cccc-dddd-000000000001', :'CO', :'PR',
        '55555555-5555-5555-5555-555555555555', '99999999-aaaa-bbbb-cccc-000000000001',
        10169.60, 'transferencia', 'TRF-99120');

UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE
 WHERE id = 'aaaaaaaa-bbbb-cccc-dddd-000000000001';

SELECT public.chk(
  (SELECT count(*) FROM public.facturas_proveedor
    WHERE numero_factura IN ('A-4471','A-4490') AND estado = 'pagada'), 2,
  '37 UNA sola orden de pago cancela las DOS facturas de la contraseña');
SELECT public.chk(public.saldo('2104'), 0.00,
  '38 y Proveedores por pagar queda en cero');

-- ─────────────────────────────────────────────────────────────────────────────
-- 39-43 · Reversos: anular deshace exactamente lo que hizo
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'aaaaaaaa-bbbb-cccc-dddd-000000000001';

SELECT public.chk(
  (SELECT count(*) FROM public.facturas_proveedor
    WHERE numero_factura IN ('A-4471','A-4490') AND estado = 'aprobada'), 2,
  '39 anular la orden devuelve AMBAS facturas a aprobada');
SELECT public.chk_txt(
  (SELECT estado FROM public.contrasenas_pago WHERE id = '99999999-aaaa-bbbb-cccc-000000000001'), 'emitida',
  '40 y la contraseña vuelve a estar viva (el proveedor sigue con su acuse)');
SELECT public.chk(public.saldo('2104'), -10169.60, '41 la deuda con el proveedor reaparece');

-- Una recepción ya facturada no se puede "des-recibir".
SELECT public.chk_falla(
  $$UPDATE public.recepciones SET estado='anulada' WHERE id='77777777-7777-7777-7777-777777777777'$$,
  'COMPRAS_RECEPCION_FACTURADA',
  '42 no se anula una recepción cuyas líneas ya se facturaron');

-- Una orden ya cerrada no admite entregas nuevas.
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, documento_referencia)
VALUES ('77777777-7777-7777-7777-777777777779', :'CO', :'PR',
        '66666666-6666-6666-6666-666666666666', 'Envío 9999');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
SELECT :'CO', '77777777-7777-7777-7777-777777777779', l.id, 1
FROM public.orden_compra_lineas l
WHERE l.orden_compra_id = '66666666-6666-6666-6666-666666666666' AND l.linea = 1;

SELECT public.chk_falla(
  $$UPDATE public.recepciones SET estado='registrada' WHERE id='77777777-7777-7777-7777-777777777779'$$,
  'COMPRAS_OC_NO_RECIBIBLE',
  '43 una orden ya cerrada no admite recepciones nuevas');

-- Sobre-recepción, sobre una orden VIVA: se pide 2 y llegan 3.
-- Va en orden aparte a propósito: sobre la primera, que quedó `cerrada`, saltaba
-- antes el guard de "orden no recibible" y la sobre-recepción no se probaba.
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('66666666-6666-6666-6666-666666666667', :'CO', :'PR',
        '55555555-5555-5555-5555-555555555555', 'Suministros del Valle', 'Sellador');
INSERT INTO public.orden_compra_lineas
  (company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, cantidad, unidad, precio_unitario)
VALUES (:'CO', '66666666-6666-6666-6666-666666666667', 1, 'Sellador acrílico', 'inventario',
        '44444444-4444-4444-4444-444444444445', 2, 'galón', 90.00);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '66666666-6666-6666-6666-666666666667';

INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, documento_referencia)
VALUES ('77777777-7777-7777-7777-77777777777a', :'CO', :'PR',
        '66666666-6666-6666-6666-666666666667', 'Envío 9998');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
SELECT :'CO', '77777777-7777-7777-7777-77777777777a', l.id, 3
FROM public.orden_compra_lineas l
WHERE l.orden_compra_id = '66666666-6666-6666-6666-666666666667';

SELECT public.chk_falla(
  $$UPDATE public.recepciones SET estado='registrada' WHERE id='77777777-7777-7777-7777-77777777777a'$$,
  'COMPRAS_SOBRE_RECEPCION',
  '43b recibir más de lo pedido se corta en la recepción, no en la factura');

-- Y con la cantidad correcta entra sin ruido: el corte es por exceso, no por
-- existir. Un guard que bloquea también el caso bueno no sirve de nada.
UPDATE public.recepcion_lineas SET cantidad = 2 WHERE recepcion_id = '77777777-7777-7777-7777-77777777777a';
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '77777777-7777-7777-7777-77777777777a';
SELECT public.chk(
  (SELECT stock_actual FROM public.suministros_condominio WHERE id = '44444444-4444-4444-4444-444444444445'), 2.00,
  '43c y la cantidad correcta sí entra, con su stock partiendo de cero');
SELECT public.chk(
  (SELECT costo_unitario FROM public.suministros_condominio WHERE id = '44444444-4444-4444-4444-444444444445'), 90.0000,
  '43d un insumo sin saldo inicial toma el costo de la compra tal cual');

-- ─────────────────────────────────────────────────────────────────────────────
-- 44-46 · Ledger nuevo: el trigger de siembra y el aislamiento entre libros
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.companies (id, nombre, default_currency)
VALUES ('bbbbbbbb-1111-1111-1111-111111111111', 'Nueva Administradora', 'gtq');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas
    WHERE company_id = 'bbbbbbbb-1111-1111-1111-111111111111'
      AND codigo IN ('1106','2105','1401','1409','5107')), 5,
  '44 una empresa NUEVA nace con las cuentas de compras ya sembradas');

-- El correlativo es POR contabilidad: la primera orden de otra empresa vuelve
-- a ser la 1, no la 2.
INSERT INTO public.proveedores (id, company_id, nombre, estado)
VALUES ('cccccccc-1111-1111-1111-111111111111', 'bbbbbbbb-1111-1111-1111-111111111111', 'Otro Proveedor', 'autorizado');
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('dddddddd-1111-1111-1111-111111111111', 'bbbbbbbb-1111-1111-1111-111111111111', NULL,
        'cccccccc-1111-1111-1111-111111111111', 'Otro Proveedor', 'Papelería', 'aprobada');

SELECT public.chk_txt(
  (SELECT numero FROM public.ordenes_compra WHERE id = 'dddddddd-1111-1111-1111-111111111111'), 'OC-000001',
  '45 el correlativo arranca en 1 en cada contabilidad, no es global');
SELECT public.chk(
  (SELECT (project_id IS NULL)::int FROM public.ordenes_compra WHERE id = 'dddddddd-1111-1111-1111-111111111111'), 1,
  '46 y la EMPRESA puede emitir órdenes propias (project_id NULL)');
