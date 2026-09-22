\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · pendientes de contabilización y reproceso
--
-- Todo se mide sobre FILAS REALES: la factura se aprueba con el trigger de
-- verdad, el reproceso se llama como `authenticated` con el usuario de turno,
-- y lo que se comprueba es el asiento que quedó (o que no quedó) en
-- `conta_asientos` y `conta_asiento_lineas`.
-- ============================================================================

\set A     '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set A1    '''a1a1a1a1-0000-0000-0000-000000000001'''
\set UA    '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set UB    '''b0b0b0b0-0000-0000-0000-00000000000b'''
\set UV    '''a0a0a0a0-0000-0000-0000-0000000000f1'''
\set UN    '''a0a0a0a0-0000-0000-0000-0000000000f2'''
\set UP    '''a0a0a0a0-0000-0000-0000-0000000000f3'''

\set F1    '''f1000000-0000-0000-0000-000000000001'''
\set F5    '''f5000000-0000-0000-0000-000000000001'''
\set F6    '''f6000000-0000-0000-0000-000000000001'''
\set F7A   '''f7000000-0000-0000-0000-00000000000a'''
\set F7B   '''f7000000-0000-0000-0000-00000000000b'''
\set F7C   '''f7000000-0000-0000-0000-00000000000c'''
\set F8    '''f8000000-0000-0000-0000-000000000001'''
\set F9    '''f9000000-0000-0000-0000-000000000001'''
\set FANU  '''fa000000-0000-0000-0000-00000000000a'''
\set FDEL  '''fa000000-0000-0000-0000-00000000000d'''
\set FREG  '''fa000000-0000-0000-0000-00000000000e'''
\set FREV  '''fa000000-0000-0000-0000-00000000000f'''
\set FB    '''fb000000-0000-0000-0000-000000000001'''

SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);

-- ── 0. Nada que hacer todavía ───────────────────────────────────────────────
SELECT public.chk((SELECT count(*) FROM public.conta_intentos_contabilizacion), 0,
  '0 · la bitácora de intentos nace vacía (sin backfill)');

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Aprobada SIN configuración: pendiente y sin asiento
-- ════════════════════════════════════════════════════════════════════════════
SELECT public.factura(:F1, 'Servicio sin cuenta de gasto', 500);
SELECT public.aprobar_id(:F1);

SELECT public.chk(public.n_asientos(:F1), 0, '1 · aprobada sin mapeo de gasto: NO tiene asiento');
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = :F1), 'aprobada',
  '1 · y la factura queda aprobada (la contabilidad no bloquea la operación)');
SELECT public.chk_txt(
  (SELECT resultado || '/' || codigo || '/' || disparo FROM public.conta_intentos_contabilizacion
    WHERE origen_id = :F1),
  'pendiente/sin_cuenta/aprobacion',
  '1 · la aprobación dejó UN intento: pendiente por «sin cuenta»');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion
    WHERE origen_id = :F1 AND actor = :UA::uuid), 1,
  '1 · y el intento registra al actor');

SELECT public.chk(
  (SELECT count(*) FROM public.bandeja_como(:UA::uuid) b WHERE b->>'factura_id' = :F1), 1,
  '1 · y APARECE en la bandeja de pendientes');
SELECT public.chk_txt(
  (SELECT b->>'codigo' FROM public.bandeja_como(:UA::uuid) b WHERE b->>'factura_id' = :F1),
  'sin_cuenta', '1 · con el motivo tipificado «sin_cuenta»');
SELECT public.chk_txt(
  (SELECT b->>'proveedor_nombre' || '|' || (b->>'monto_total')::numeric || '|' || (b->>'moneda')
     FROM public.bandeja_como(:UA::uuid) b WHERE b->>'factura_id' = :F1),
  'Proveedor A|500.00|USD', '1 · con proveedor, importe y moneda');
SELECT public.chk_txt(
  (SELECT (b->>'puede_reprocesar') FROM public.bandeja_como(:UA::uuid) b WHERE b->>'factura_id' = :F1),
  'true', '1 · y el admin puede reprocesarla');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Corregir la configuración y reprocesar: UN asiento balanceado
-- ════════════════════════════════════════════════════════════════════════════
-- Instantánea de lo comercial ANTES: el reproceso no debe tocarlo.
CREATE TEMP TABLE antes_f1 AS
  SELECT estado, monto_pagado, aprobada_at, aprobada_por, updated_at, fecha_emision
    FROM public.facturas_proveedor WHERE id = :F1;

INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
VALUES (:A::uuid, NULL, 'gasto_otros', 'c0000000-0000-0000-0000-00000000a002');

SELECT public.chk_txt(public.reprocesar_como(:UA::uuid, :F1)->>'resultado', 'contabilizada',
  '2 · con el mapeo corregido, el reproceso CONTABILIZA');
SELECT public.chk(public.n_asientos(:F1), 1, '2 · exactamente UN asiento');
SELECT public.chk_txt(
  (SELECT estado || '|' || (total_debe = total_haber)::text || '|' || total_debe
     FROM public.conta_asientos WHERE origen_id = :F1 AND origen_evento = 'factura_prov_aprobada'),
  'publicado|true|500.00', '2 · publicado y BALANCEADO (debe = haber = 500)');
SELECT public.chk_num(public.debe_en(:F1, 'c0000000-0000-0000-0000-00000000a002'), 500,
  '2 · gasto al debe por el total');
SELECT public.chk_num(public.haber_en(:F1, 'c0000000-0000-0000-0000-00000000a008'), 500,
  '2 · CxP al haber por el total');
SELECT public.chk_txt(
  (SELECT fecha::text FROM public.conta_asientos WHERE origen_id = :F1 AND origen_evento = 'factura_prov_aprobada'),
  '2026-09-10', '2 · con la fecha de la FACTURA, no la de hoy');
SELECT public.chk(
  (SELECT count(*) FROM public.facturas_proveedor f, antes_f1 b
    WHERE f.id = :F1 AND f.estado = b.estado AND f.monto_pagado = b.monto_pagado
      AND f.aprobada_at IS NOT DISTINCT FROM b.aprobada_at
      AND f.aprobada_por IS NOT DISTINCT FROM b.aprobada_por
      AND f.updated_at = b.updated_at AND f.fecha_emision = b.fecha_emision), 1,
  '2 · la factura NO cambia: estado, pagado, aprobación, fechas intactos');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion i
     JOIN public.conta_asientos a ON a.id = i.asiento_id
    WHERE i.origen_id = :F1 AND i.resultado = 'contabilizada' AND i.disparo = 'reproceso'
      AND i.actor = :UA::uuid), 1,
  '2 · el intento de reproceso registra actor, resultado y el asiento generado');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Reintentar después del éxito: no duplica
-- ════════════════════════════════════════════════════════════════════════════
CREATE TEMP TABLE lineas_f1 AS SELECT public.n_lineas_asiento(:F1) AS n;

SELECT public.chk_txt(public.reprocesar_como(:UA::uuid, :F1)->>'resultado', 'ya_contabilizada',
  '3 · repetir tras el éxito responde «ya contabilizada»');
SELECT public.chk_txt(
  public.reprocesar_como(:UA::uuid, :F1)->>'asiento_id',
  (SELECT id::text FROM public.conta_asientos WHERE origen_id = :F1 AND origen_evento = 'factura_prov_aprobada'),
  '3 · y devuelve EL asiento existente');
SELECT public.chk(public.n_asientos(:F1), 1, '3 · sigue habiendo UN asiento');
SELECT public.chk(public.n_lineas_asiento(:F1), (SELECT n FROM lineas_f1),
  '3 · y ni una partida nueva');

-- ════════════════════════════════════════════════════════════════════════════
-- 11. Intento fallido antiguo seguido de éxito: deja de ser pendiente
-- ════════════════════════════════════════════════════════════════════════════
SELECT public.chk(
  (SELECT count(*) FROM public.bandeja_como(:UA::uuid) b WHERE b->>'factura_id' = :F1), 0,
  '11 · contabilizada tras un fallo: YA NO figura en la bandeja');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion
    WHERE origen_id = :F1 AND resultado = 'pendiente'), 1,
  '11 · y el intento fallido se CONSERVA en el historial');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_resoluciones
    WHERE origen_id = :F1 AND origen_resolucion = 'sin_resolver'), 1,
  '11 · igual que su resolución sin_resolver: no se borra nada para quitar el pendiente');

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Dos líneas con cuentas EXPLÍCITAS distintas: cada una su importe
-- ════════════════════════════════════════════════════════════════════════════
-- La falla es OTRA: sin mapeo de CxP. Las cuentas de gasto se resuelven y el
-- asiento igual no puede salir: resolver no es contabilizar.
DELETE FROM public.conta_mapeo_cuentas WHERE company_id = :A::uuid AND project_id IS NULL AND evento = 'cxp_proveedores';

SELECT public.factura(:F5, 'Dos cuentas elegidas', 300);
SELECT public.linea(:F5, 1, 1, 100, 'c0000000-0000-0000-0000-00000000a005');
SELECT public.linea(:F5, 2, 1, 200, 'c0000000-0000-0000-0000-00000000a006');
SELECT public.aprobar_id(:F5);

SELECT public.chk(public.n_asientos(:F5), 0, '5 · sin mapeo de CxP no hay asiento');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_resoluciones
    WHERE origen_id = :F5 AND origen_resolucion = 'linea_explicita'), 2,
  '5 · aunque las DOS cuentas de gasto se resolvieron');
SELECT public.chk_txt(
  (SELECT b->>'codigo' FROM public.bandeja_como(:UA::uuid) b WHERE b->>'factura_id' = :F5),
  'configuracion_incompleta', '5 · la bandeja lo distingue: «configuración incompleta», no «sin cuenta»');
SELECT public.chk(
  (SELECT count(*) FROM public.bandeja_como(:UA::uuid) b
    WHERE b->>'factura_id' = :F5 AND b->>'motivo' LIKE '%cxp_proveedores%'), 1,
  '5 · y el motivo nombra el evento que falta');

INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
VALUES (:A::uuid, NULL, 'cxp_proveedores', 'c0000000-0000-0000-0000-00000000a008');

SELECT public.chk_txt(public.reprocesar_como(:UA::uuid, :F5)->>'resultado', 'contabilizada',
  '5 · corregido el mapeo, el reproceso contabiliza');
SELECT public.chk_num(public.debe_en(:F5, 'c0000000-0000-0000-0000-00000000a005'), 100,
  '5 · la línea 1 va a SU cuenta por SU importe');
SELECT public.chk_num(public.debe_en(:F5, 'c0000000-0000-0000-0000-00000000a006'), 200,
  '5 · y la línea 2 a la suya por el suyo');
SELECT public.chk_num(public.debe_en(:F5, 'c0000000-0000-0000-0000-00000000a002'), 0,
  '5 · nada cae al mapeo del evento');

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Línea explícita + línea resuelta por la regla del proveedor
-- ════════════════════════════════════════════════════════════════════════════
DELETE FROM public.conta_mapeo_cuentas WHERE company_id = :A::uuid AND project_id IS NULL AND evento = 'gasto_otros';

SELECT public.factura(:F6, 'Elegida y regla', 300);
SELECT public.linea(:F6, 1, 1, 100, 'c0000000-0000-0000-0000-00000000a005');
SELECT public.linea(:F6, 2, 1, 200, NULL);
SELECT public.aprobar_id(:F6);

SELECT public.chk(public.n_asientos(:F6), 0, '6 · la línea 2 no tiene cuenta: sin asiento, nada parcial');
SELECT public.chk_txt(
  (SELECT (b->>'codigo') || '|' || (b->>'linea_numero')
     FROM public.bandeja_como(:UA::uuid) b WHERE b->>'factura_id' = :F6),
  'sin_cuenta|2', '6 · la bandeja señala «sin cuenta» y LA LÍNEA 2');

INSERT INTO public.conta_reglas_proveedor (company_id, project_id, proveedor_id, destino, cuenta_id)
VALUES (:A::uuid, NULL, 'd0000000-0000-0000-0000-00000000a001', 'gasto', 'c0000000-0000-0000-0000-00000000a003');

SELECT public.chk_txt(public.reprocesar_como(:UA::uuid, :F6)->>'resultado', 'contabilizada',
  '6 · con la regla del proveedor, el reproceso contabiliza');
SELECT public.chk_num(public.debe_en(:F6, 'c0000000-0000-0000-0000-00000000a005'), 100,
  '6 · la línea explícita conserva su cuenta y su importe');
SELECT public.chk_num(public.debe_en(:F6, 'c0000000-0000-0000-0000-00000000a003'), 200,
  '6 · y la otra va a la cuenta de la regla por el resto');
SELECT public.chk_num(
  (SELECT total_debe FROM public.conta_asientos WHERE origen_id = :F6 AND origen_evento = 'factura_prov_aprobada'),
  300, '6 · asiento balanceado por el total');

DELETE FROM public.conta_reglas_proveedor;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Cuenta inactiva, agrupadora o de otra contabilidad: rechazo sin parcial
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
VALUES (:A::uuid, NULL, 'gasto_otros', 'c0000000-0000-0000-0000-00000000a002');

SELECT public.factura(:F7A, 'Cuenta inactiva', 300);
SELECT public.linea(:F7A, 1, 1, 100, 'c0000000-0000-0000-0000-00000000a004');   -- inactiva
SELECT public.linea(:F7A, 2, 1, 200, NULL);                                      -- válida (mapeo)
SELECT public.aprobar_id(:F7A);

SELECT public.factura(:F7B, 'Cuenta agrupadora', 300);
SELECT public.linea(:F7B, 1, 1, 300, 'c0000000-0000-0000-0000-00000000a001');
SELECT public.aprobar_id(:F7B);

SELECT public.factura(:F7C, 'Cuenta de otra contabilidad', 300);
SELECT public.linea(:F7C, 1, 1, 300, 'c0000000-0000-0000-0000-00000000a101');   -- ledger A1
SELECT public.aprobar_id(:F7C);

SELECT public.chk_txt(public.reprocesar_como(:UA::uuid, :F7A)->>'codigo', 'cuenta_invalida',
  '7 · cuenta INACTIVA: rechazo «cuenta inválida»');
SELECT public.chk_txt(public.reprocesar_como(:UA::uuid, :F7B)->>'codigo', 'cuenta_invalida',
  '7 · cuenta AGRUPADORA: rechazo «cuenta inválida»');
SELECT public.chk_txt(public.reprocesar_como(:UA::uuid, :F7C)->>'codigo', 'cuenta_invalida',
  '7 · cuenta de OTRA contabilidad: rechazo «cuenta inválida»');
SELECT public.chk(public.n_asientos(:F7A) + public.n_asientos(:F7B) + public.n_asientos(:F7C), 0,
  '7 · ninguna de las tres genera asiento');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_id IN (:F7A, :F7B, :F7C)), 0,
  '7 · ni una sola partida: la línea válida de F7A tampoco se contabiliza sola');
SELECT public.chk_txt(
  (SELECT (b->>'linea_numero') FROM public.bandeja_como(:UA::uuid) b WHERE b->>'factura_id' = :F7A),
  '1', '7 · y la bandeja señala la línea culpable');

-- La contrapartida mapeada a una cuenta que DESPUÉS se desactiva. El generador
-- la habría usado igual; el diagnóstico la frena con su motivo.
UPDATE public.conta_cuentas SET activa = false WHERE id = 'c0000000-0000-0000-0000-00000000a008';
SELECT public.factura('f7000000-0000-0000-0000-00000000000d', 'CxP inactiva', 100);
SELECT public.aprobar_id('f7000000-0000-0000-0000-00000000000d');
SELECT public.chk(public.n_asientos('f7000000-0000-0000-0000-00000000000d'), 0,
  '7 · CxP mapeada a una cuenta INACTIVA: no se publica un asiento contra ella');
SELECT public.chk_txt(
  (SELECT codigo FROM public.conta_intentos_contabilizacion
    WHERE origen_id = 'f7000000-0000-0000-0000-00000000000d'),
  'cuenta_invalida', '7 · y queda pendiente por «cuenta inválida»');
UPDATE public.conta_cuentas SET activa = true WHERE id = 'c0000000-0000-0000-0000-00000000a008';

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Compra totalmente recibida (GR/IR): sin exigir cuenta de gasto
-- ════════════════════════════════════════════════════════════════════════════
DELETE FROM public.conta_mapeo_cuentas WHERE company_id = :A::uuid AND project_id IS NULL AND evento = 'gasto_otros';
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES
  (:A::uuid, NULL, 'compras_por_facturar', 'c0000000-0000-0000-0000-00000000a009');
-- Sin IVA mapeado aún: el IVA iría a gasto y NO hay cuenta de gasto → pendiente.

INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('0c000000-0000-0000-0000-000000000001', :A::uuid, NULL,
        'd0000000-0000-0000-0000-00000000a001', 'Proveedor A', 'Compra recibida', 'borrador');
INSERT INTO public.orden_compra_lineas
  (id, company_id, orden_compra_id, linea, descripcion, categoria, cantidad, precio_unitario, cantidad_recibida)
VALUES ('0c100000-0000-0000-0000-000000000001', :A::uuid,
        '0c000000-0000-0000-0000-000000000001', 1, 'Material', 'otros', 10, 50, 10);
UPDATE public.ordenes_compra SET estado = 'recibida' WHERE id = '0c000000-0000-0000-0000-000000000001';

SELECT public.factura(:F8, 'GR/IR íntegra', 580, 0, '0c000000-0000-0000-0000-000000000001');
SELECT public.linea(:F8, 1, 10, 50, NULL, '0c100000-0000-0000-0000-000000000001', 80);
SELECT public.aprobar_id(:F8);

SELECT public.chk(public.n_asientos(:F8), 0,
  '8 · con el IVA sin cuenta de crédito, el IVA cae a gasto y falta: pendiente');

-- Se corrige lo que de verdad falta —el IVA—, NO una cuenta de gasto.
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES
  (:A::uuid, NULL, 'iva_credito', 'c0000000-0000-0000-0000-00000000a010');

SELECT public.chk_txt(public.reprocesar_como(:UA::uuid, :F8)->>'resultado', 'contabilizada',
  '8 · GR/IR íntegra se contabiliza SIN cuenta de gasto configurada');
SELECT public.chk_num(public.debe_en(:F8, 'c0000000-0000-0000-0000-00000000a009'), 500,
  '8 · liquida compras por facturar por lo recibido');
SELECT public.chk_num(public.debe_en(:F8, 'c0000000-0000-0000-0000-00000000a010'), 80,
  '8 · el IVA a su cuenta de crédito');
SELECT public.chk_num(public.haber_en(:F8, 'c0000000-0000-0000-0000-00000000a008'), 580,
  '8 · contra CxP por el total');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_resoluciones r
    WHERE r.origen_id = :F8 AND r.cuenta_id IS NOT NULL
      AND r.created_at >= (SELECT max(created_at) FROM public.conta_intentos_contabilizacion
                            WHERE origen_id = :F8 AND disparo = 'aprobacion')), 0,
  '8 · y el reproceso no anota una cuenta de gasto que el asiento no usa');

INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
VALUES (:A::uuid, NULL, 'gasto_otros', 'c0000000-0000-0000-0000-00000000a002');

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Período cerrado: bloqueo sin tocar fecha ni período
-- ════════════════════════════════════════════════════════════════════════════
SELECT public.factura(:F9, 'Factura de enero en A1', 250, 0, NULL, :A1::uuid, DATE '2026-01-15');
SELECT public.aprobar_id(:F9);
SELECT public.chk(public.n_asientos(:F9), 0, '9 · A1 sin mapeo de gasto: pendiente');

INSERT INTO public.cierres_mensuales (company_id, project_id, periodo, estado)
VALUES (:A::uuid, :A1::uuid, '2026-01', 'cerrado');
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
VALUES (:A::uuid, :A1::uuid, 'gasto_otros', 'c0000000-0000-0000-0000-00000000a101');

SELECT public.chk_txt(public.reprocesar_como(:UA::uuid, :F9)->>'codigo', 'periodo_cerrado',
  '9 · con el período de la factura CERRADO, el reproceso se bloquea');
SELECT public.chk(public.n_asientos(:F9), 0, '9 · sin asiento (no se re-fecha a hoy)');
SELECT public.chk_txt((SELECT fecha_emision::text FROM public.facturas_proveedor WHERE id = :F9),
  '2026-01-15', '9 · la fecha de la factura no cambia');
SELECT public.chk_txt(
  (SELECT estado FROM public.cierres_mensuales WHERE project_id = :A1::uuid AND periodo = '2026-01'),
  'cerrado', '9 · y el período sigue cerrado: no se abre solo');
SELECT public.chk_txt(
  (SELECT b->>'codigo' FROM public.bandeja_como(:UA::uuid, :A1::uuid) b WHERE b->>'factura_id' = :F9),
  'periodo_cerrado', '9 · la bandeja de A1 lo muestra como «período cerrado»');
SELECT public.chk(
  (SELECT count(*) FROM public.bandeja_como(:UA::uuid, :A1::uuid, 'otro') b WHERE b->>'factura_id' = :F9), 1,
  '9 · y cae en el filtro «otros bloqueos»');

-- ════════════════════════════════════════════════════════════════════════════
-- 10. Anulada, eliminada, no aprobada, reversada: respuesta segura
-- ════════════════════════════════════════════════════════════════════════════
DELETE FROM public.conta_mapeo_cuentas WHERE company_id = :A::uuid AND project_id IS NULL AND evento = 'gasto_otros';

SELECT public.factura(:FANU, 'Pendiente que se anula', 120);
SELECT public.aprobar_id(:FANU);
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE id = :FANU;

SELECT public.factura(:FDEL, 'Pendiente que se borra', 130);
SELECT public.aprobar_id(:FDEL);
DELETE FROM public.facturas_proveedor WHERE id = :FDEL;

SELECT public.factura(:FREG, 'Registrada, sin aprobar', 140);

INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
VALUES (:A::uuid, NULL, 'gasto_otros', 'c0000000-0000-0000-0000-00000000a002');

SELECT public.chk_txt(public.reprocesar_como(:UA::uuid, :FANU)->>'codigo', 'documento_anulado',
  '10 · anulada: «documento anulado»');
SELECT public.chk_txt(public.reprocesar_como(:UA::uuid, :FDEL)->>'codigo', 'documento_inexistente',
  '10 · eliminada: «documento inexistente»');
SELECT public.chk_txt(public.reprocesar_como(:UA::uuid, :FREG)->>'codigo', 'documento_no_aprobado',
  '10 · registrada sin aprobar: «no aprobada»');
SELECT public.chk(public.n_asientos(:FANU) + public.n_asientos(:FDEL) + public.n_asientos(:FREG), 0,
  '10 · ninguna genera asiento: no se resucita lo anulado ni lo borrado');
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = :FANU), 'anulada',
  '10 · y la anulada sigue anulada');
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = :FREG), 'registrada',
  '10 · y la registrada sigue registrada (el reproceso no aprueba)');
SELECT public.chk(
  (SELECT count(*) FROM public.bandeja_como(:UA::uuid) b
    WHERE b->>'factura_id' IN (:FANU, :FDEL, :FREG, :F1)), 0,
  '10 · ninguna figura como pendiente accionable (ni la ya contabilizada)');

-- Asiento reversado a mano con la factura todavía aprobada: no se recrea.
SELECT public.factura(:FREV, 'Contabilizada y reversada a mano', 160);
SELECT public.aprobar_id(:FREV);
SELECT public.chk(public.n_asientos(:FREV), 1, '10 · la factura se contabilizó al aprobar');
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);
SELECT public.conta_anular_asiento(
  (SELECT id FROM public.conta_asientos WHERE origen_id = :FREV AND origen_evento = 'factura_prov_aprobada'),
  'Corrección manual');
SELECT public.chk_txt(public.reprocesar_como(:UA::uuid, :FREV)->>'codigo', 'asiento_reversado',
  '10 · asiento reversado: el reproceso NO lo recrea');
SELECT public.chk(public.n_asientos(:FREV), 1, '10 · sigue habiendo sólo el asiento original');
SELECT public.chk(
  (SELECT count(*) FROM public.bandeja_como(:UA::uuid) b WHERE b->>'factura_id' = :FREV), 0,
  '10 · y no aparece como pendiente');

-- ════════════════════════════════════════════════════════════════════════════
-- 12. Acceso cruzado y usuario sin permiso: rechazo desde el servidor
-- ════════════════════════════════════════════════════════════════════════════
-- F7A sigue pendiente en el ledger de empresa de A. F9 pendiente en A1.
SELECT public.chk_txt(public.reprocesar_como(:UB::uuid, :F7A)->>'codigo', 'documento_inexistente',
  '12 · otra EMPRESA: la factura ni siquiera «existe» para ella');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion
    WHERE origen_id = :F7A AND actor = :UB::uuid), 0,
  '12 · y no deja rastro en la bitácora ajena');
SELECT public.chk(
  (SELECT count(*) FROM public.bandeja_como(:UB::uuid)), 0,
  '12 · la bandeja de B no muestra nada de A');
SELECT public.chk_falla($$SELECT * FROM public.bandeja_como('b0b0b0b0-0000-0000-0000-00000000000b', 'a1a1a1a1-0000-0000-0000-000000000001')$$,
  'no pertenece a la empresa', '12 · B pidiendo la bandeja de un proyecto de A: rechazado');

SELECT public.chk_falla($$SELECT public.reprocesar_como('a0a0a0a0-0000-0000-0000-0000000000f2', 'f7000000-0000-0000-0000-00000000000a')$$,
  'No autorizado para contabilizar', '12 · usuario SIN permiso: reproceso rechazado');
SELECT public.chk_falla($$SELECT * FROM public.bandeja_como('a0a0a0a0-0000-0000-0000-0000000000f2')$$,
  'No autorizado para ver', '12 · y tampoco ve la bandeja');

SELECT public.chk_falla($$SELECT public.reprocesar_como('a0a0a0a0-0000-0000-0000-0000000000f1', 'f7000000-0000-0000-0000-00000000000a')$$,
  'No autorizado para contabilizar', '12 · usuario de SÓLO LECTURA: reproceso rechazado aunque haga la petición');
SELECT public.chk(
  (SELECT count(*) FROM public.bandeja_como(:UV::uuid) b
    WHERE b->>'factura_id' = :F7A AND (b->>'puede_reprocesar')::boolean = false), 1,
  '12 · pero sí ve la bandeja, marcada sin permiso de reproceso');

SELECT public.chk_falla($$SELECT * FROM public.bandeja_como('a0a0a0a0-0000-0000-0000-0000000000f3', 'a1a1a1a1-0000-0000-0000-000000000001')$$,
  'No autorizado para este proyecto', '12 · usuario asignado sólo a A2: la bandeja de A1 se rechaza');
SELECT public.chk_txt(public.reprocesar_como(:UP::uuid, :F9)->>'codigo', 'documento_inexistente',
  '12 · y el reproceso de una factura de A1 responde como inexistente');

-- RLS y grants de la bitácora, como authenticated.
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-0000000000f3', false);
SET ROLE authenticated;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion WHERE project_id = 'a1a1a1a1-0000-0000-0000-000000000001'), 0,
  '12 · RLS: el usuario de A2 no lee los intentos de A1');
SELECT public.chk_falla($$INSERT INTO public.conta_intentos_contabilizacion (company_id, origen_tabla, origen_id, disparo, resultado) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'facturas_proveedor', gen_random_uuid(), 'reproceso', 'contabilizada')$$,
  'permission denied', '12 · nadie escribe la bitácora a mano');
SELECT public.chk_falla($$DELETE FROM public.conta_intentos_contabilizacion$$,
  'permission denied', '12 · ni la borra para «quitar» un pendiente');
SELECT public.chk_falla($$SELECT public.conta_contabilizar_factura_prov_interno(f, 'reproceso') FROM public.facturas_proveedor f LIMIT 1$$,
  'permission denied', '12 · el contabilizador interno NO es invocable por authenticated');
SELECT public.chk_falla($$SELECT public.conta_registrar_intento('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, gen_random_uuid(), 'reproceso', 'contabilizada')$$,
  'permission denied', '12 · ni el registrador de intentos');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'b0b0b0b0-0000-0000-0000-00000000000b', false);
SET ROLE authenticated;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion
    WHERE company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0,
  '12 · RLS: otra empresa no lee los intentos de A');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);

-- ════════════════════════════════════════════════════════════════════════════
-- 13. Regresión de reversos por eliminación y anulación
-- ════════════════════════════════════════════════════════════════════════════
-- Reprocesada y DESPUÉS anulada: el reverso sigue funcionando sobre el asiento
-- que nació del reproceso.
SELECT public.chk_txt(public.reprocesar_como(:UA::uuid, :F7A)->>'codigo', 'cuenta_invalida',
  '13 · (F7A sigue con su cuenta inactiva)');
-- Las líneas de una factura aprobada son inmutables (COMPRAS_FACTURA_INMUTABLE):
-- la corrección autorizada es en el CATÁLOGO, reactivando la cuenta elegida.
SELECT public.chk_falla($$UPDATE public.factura_proveedor_lineas SET cuenta_id = 'c0000000-0000-0000-0000-00000000a005' WHERE factura_id = 'f7000000-0000-0000-0000-00000000000a'$$,
  'COMPRAS_FACTURA_INMUTABLE', '13 · la línea de una factura aprobada no se edita (el reproceso no lo esquiva)');
UPDATE public.conta_cuentas SET activa = true WHERE id = 'c0000000-0000-0000-0000-00000000a004';
SELECT public.chk_txt(public.reprocesar_como(:UA::uuid, :F7A)->>'resultado', 'contabilizada',
  '13 · reactivada la cuenta en el catálogo, se contabiliza');
SELECT public.chk_num(public.debe_en(:F7A, 'c0000000-0000-0000-0000-00000000a004'), 100,
  '13 · con la cuenta ELEGIDA en la línea, por su importe');
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE id = :F7A;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos
    WHERE origen_id = :F7A AND origen_evento = 'factura_prov_aprobada_revertido'), 1,
  '13 · anular la factura reprocesada genera su reverso');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos
    WHERE origen_id = :F7A AND origen_evento = 'factura_prov_aprobada' AND anulado_por_id IS NOT NULL), 1,
  '13 · y el original queda marcado como reversado');

SELECT public.chk_txt(public.reprocesar_como(:UA::uuid, :F6)->>'resultado', 'ya_contabilizada',
  '13 · (F6 está contabilizada)');
DELETE FROM public.facturas_proveedor WHERE id = :F6;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos
    WHERE origen_id = :F6 AND origen_evento = 'factura_prov_aprobada_revertido'), 1,
  '13 · borrar una factura contabilizada genera su reverso');
SELECT public.chk(
  (SELECT (count(*) >= 2)::int FROM public.conta_intentos_contabilizacion WHERE origen_id = :F6), 1,
  '13 · y su historial de intentos sobrevive al borrado');

-- Un reverso nunca pasa a ser «pendiente».
SELECT public.chk(
  (SELECT count(*) FROM public.bandeja_como(:UA::uuid) b WHERE b->>'factura_id' IN (:F6, :F7A)), 0,
  '13 · ni la anulada ni la borrada vuelven a la bandeja');

-- ════════════════════════════════════════════════════════════════════════════
-- 14. La bandeja: pendientes legados, paginación, filtros y búsqueda
-- ════════════════════════════════════════════════════════════════════════════
-- Aprobadas ANTES de esta migración: sólo tienen filas en conta_resoluciones.
-- Se simulan con el trigger apagado y la fila de #885 escrita a mano.
ALTER TABLE public.facturas_proveedor DISABLE TRIGGER trg_conta_facturas_prov;
SELECT public.factura('fc000000-0000-0000-0000-00000000000a', 'Legado sin resolver', 70);
SELECT public.aprobar_id('fc000000-0000-0000-0000-00000000000a');
INSERT INTO public.conta_resoluciones (company_id, project_id, origen_tabla, origen_id, destino, evento,
  cuenta_id, origen_resolucion, motivo)
VALUES (:A::uuid, NULL, 'facturas_proveedor', 'fc000000-0000-0000-0000-00000000000a', 'gasto', 'gasto_otros',
  NULL, 'sin_resolver', 'No hay regla aplicable y el evento «gasto_otros» no está mapeado en esta contabilidad. Configura el mapeo o una regla.');
SELECT public.factura('fc000000-0000-0000-0000-00000000000b', 'Legado resuelto sin asiento', 80);
SELECT public.aprobar_id('fc000000-0000-0000-0000-00000000000b');
INSERT INTO public.conta_resoluciones (company_id, project_id, origen_tabla, origen_id, destino, evento,
  cuenta_id, origen_resolucion)
VALUES (:A::uuid, NULL, 'facturas_proveedor', 'fc000000-0000-0000-0000-00000000000b', 'gasto', 'gasto_otros',
  'c0000000-0000-0000-0000-00000000a002', 'mapeo_evento');
-- Y una aprobada antes de la contabilidad automática: sin intento alguno.
SELECT public.factura('fc000000-0000-0000-0000-00000000000c', 'Anterior a la contabilidad', 90);
SELECT public.aprobar_id('fc000000-0000-0000-0000-00000000000c');
ALTER TABLE public.facturas_proveedor ENABLE TRIGGER trg_conta_facturas_prov;

SELECT public.chk_txt(
  (SELECT b->>'codigo' FROM public.bandeja_como(:UA::uuid) b WHERE b->>'factura_id' = 'fc000000-0000-0000-0000-00000000000a'),
  'sin_cuenta', '14 · pendiente legado (sólo bitácora de #885): figura como «sin cuenta»');
SELECT public.chk_txt(
  (SELECT b->>'codigo' FROM public.bandeja_como(:UA::uuid) b WHERE b->>'factura_id' = 'fc000000-0000-0000-0000-00000000000b'),
  'configuracion_incompleta', '14 · cuenta RESUELTA pero sin asiento: «configuración incompleta», no «resuelta»');
SELECT public.chk(
  (SELECT count(*) FROM public.bandeja_como(:UA::uuid) b WHERE b->>'factura_id' = 'fc000000-0000-0000-0000-00000000000c'), 0,
  '14 · sin ningún intento, NO es un pendiente accionable (no hay contabilización retroactiva masiva)');

-- Pendientes del ledger de empresa ahora: F7B, F7C, F7D(CxP inactiva→ se
-- reactivó, sigue pendiente), FC-a, FC-b, y las dos de la fase de concurrencia.
SELECT public.factura('cccc0000-0000-0000-0000-000000000001', 'Concurrencia: dos reprocesos', 210);
SELECT public.factura('cccc0000-0000-0000-0000-000000000002', 'Concurrencia: reproceso y anulación', 220);
DELETE FROM public.conta_mapeo_cuentas WHERE company_id = :A::uuid AND project_id IS NULL AND evento = 'gasto_otros';
SELECT public.aprobar_id('cccc0000-0000-0000-0000-000000000001');
SELECT public.aprobar_id('cccc0000-0000-0000-0000-000000000002');
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
VALUES (:A::uuid, NULL, 'gasto_otros', 'c0000000-0000-0000-0000-00000000a002');

CREATE TEMP TABLE bandeja_total AS
  SELECT (b->>'total_filas')::bigint AS total, count(*) OVER () AS filas
    FROM public.bandeja_como(:UA::uuid, NULL, NULL, NULL, 100, 0) b LIMIT 1;
SELECT public.chk((SELECT total FROM bandeja_total), (SELECT filas FROM bandeja_total),
  '14 · total_filas coincide con las filas reales');
SELECT public.chk((SELECT count(*) FROM public.bandeja_como(:UA::uuid, NULL, NULL, NULL, 2, 0)), 2,
  '14 · paginación: una página de 2');
SELECT public.chk(
  (SELECT count(*) FROM (
     SELECT b->>'factura_id' FROM public.bandeja_como(:UA::uuid, NULL, NULL, NULL, 2, 0) b
     INTERSECT
     SELECT b->>'factura_id' FROM public.bandeja_como(:UA::uuid, NULL, NULL, NULL, 2, 2) b) x), 0,
  '14 · y la segunda página no repite la primera');
SELECT public.chk(
  (SELECT count(*) FROM public.bandeja_como(:UA::uuid, NULL, 'cuenta_invalida') b
    WHERE b->>'codigo' <> 'cuenta_invalida'), 0,
  '14 · el filtro por motivo filtra en servidor');
SELECT public.chk(
  (SELECT count(*) FROM public.bandeja_como(:UA::uuid, NULL, NULL, 'agrupadora')), 1,
  '14 · la búsqueda por concepto filtra en servidor');
SELECT public.chk_falla($$SELECT * FROM public.bandeja_como('a0a0a0a0-0000-0000-0000-00000000000a', NULL, 'cualquier_cosa')$$,
  'Filtro de motivo', '14 · un filtro desconocido se rechaza');
SELECT public.chk(
  (SELECT count(*) FROM public.bandeja_como(:UA::uuid) b WHERE b->>'project_id' IS NOT NULL), 0,
  '14 · la bandeja de EMPRESA no mezcla facturas de proyectos');

SELECT 'INVARIANTES OK' AS resultado;
