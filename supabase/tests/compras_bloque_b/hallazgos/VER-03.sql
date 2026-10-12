\set ON_ERROR_STOP on
-- ============================================================================
-- [VER-03] Los sellos de actor, las fechas y lo que ya tiene asiento no se reescriben DESPUÉS
-- con solo «edit».
--
-- HALLAZGO  Los sellos solo se fijaban en la transición; después los reescribía cualquiera con
--           «edit», sin rastro: total y aprobador de una orden emitida; aprobador, hora y
--           «forzado por» de una factura aprobada; responsable, fecha y hora de una recepción
--           registrada; fecha de pago, referencia y método de una orden de pago pagada (mientras
--           el asiento seguía en la fecha original).
-- CAUSA     Los triggers de la transición eran `UPDATE OF estado` y nada protegía esas columnas
--           una vez puestas; las fechas/referencias que el asiento consumió seguían editables.
-- ESPERADO  Error explícito al intentar reescribirlas (el documento y su asiento no pueden
--           discrepar sin rastro); los pasos legítimos antes del sello (editar el borrador,
--           pagar con fecha/referencia/método, doble clic) y los caminos del sistema siguen.
-- DEPENDE   la migración 20261027000800 (pieza EV-05), la migración 20261027000800 (pieza EV-06) y la migración 20261027000800 (pieza VER-03)
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UB  '''c0c0c0c0-0000-0000-0000-00000000000b'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UQ  '''c0c0c0c0-0000-0000-0000-00000000001a'''
\set US  '''c0c0c0c0-0000-0000-0000-00000000001b'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

-- ── a · Orden emitida: total y aprobador (la reproducción del hallazgo) ─────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa403001-0000-0000-0000-000000000001', 'fa403101-0000-0000-0000-000000000001', :P1::uuid, 'servicio', 10, 10, 0);   -- 100
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'emitida' AND total = 100 AND aprobada_por = :UA::uuid FROM public.ordenes_compra WHERE id = 'fa403001-0000-0000-0000-000000000001'), true,
  '[VER-03a] preparación: orden emitida de 100 aprobada por UA');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET total = 1, subtotal = 1 WHERE id = 'fa403001-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_IMPORTES_INMUTABLES', '[VER-03a] el total de una orden emitida no se edita (los renglones suman 100)');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET aprobada_por = 'c0c0c0c0-0000-0000-0000-00000000001a', aprobada_at = now() - interval '60 days' WHERE id = 'fa403001-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[VER-03a] ni su aprobador ni la fecha en que se aprobó');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET total = 1, subtotal = 1, aprobada_por = 'c0c0c0c0-0000-0000-0000-00000000001a', aprobada_at = now() - interval '60 days' WHERE id = 'fa403001-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO|COMPRAS_OC_IMPORTES_INMUTABLES', '[VER-03a] ni todo junto (el UPDATE exacto del hallazgo)');
RESET ROLE;
SELECT public.chk_bool((SELECT total = 100 AND subtotal = 100 AND aprobada_por = :UA::uuid AND aprobada_at > now() - interval '1 hour' FROM public.ordenes_compra WHERE id = 'fa403001-0000-0000-0000-000000000001'), true,
  '[VER-03a] la orden conserva su total, su aprobador y su fecha');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = 'fa403001-0000-0000-0000-000000000001'), 3,
  '[VER-03a] y el rastro de eventos sigue siendo el de los tres pasos (sin cambios sin registrar)');

-- ── Circuito completo sobre la orden B (recepción → factura con excepción → pago) ──
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa403002-0000-0000-0000-000000000001', 'fa403102-0000-0000-0000-000000000001', :P1::uuid, 'servicio', 10, 100, 120);
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por, fecha)
VALUES ('fa403201-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, 'fa403002-0000-0000-0000-000000000001', 'servicio', :UO::uuid, date_trunc('month', CURRENT_DATE)::date);   -- el periodo contable abierto es el del mes en curso
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
VALUES (:C::uuid, 'fa403201-0000-0000-0000-000000000001', 'fa403102-0000-0000-0000-000000000001', 10);
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa403201-0000-0000-0000-000000000001';
SELECT public.como(:UA::uuid);
SELECT public.ce_factura('fa403301-0000-0000-0000-000000000001', 'fa403002-0000-0000-0000-000000000001', 'fa403102-0000-0000-0000-000000000001', :P1::uuid, 'FA4-03-0001', 10, 120, 120);   -- precio +20 %
SELECT public.como(:UC::uuid);
UPDATE public.facturas_proveedor SET match_justificacion = 'Alza pactada por escrito con el proveedor.' WHERE id = 'fa403301-0000-0000-0000-000000000001';   -- se escribe ANTES de aprobar: sigue permitido
SELECT public.como(:UA::uuid);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa403301-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'aprobada' AND aprobada_por = :UA::uuid AND match_forzado_por = :UA::uuid AND match_justificacion = 'Alza pactada por escrito con el proveedor.'
                          FROM public.facturas_proveedor WHERE id = 'fa403301-0000-0000-0000-000000000001'), true,
  '[VER-03b] preparación: factura aprobada con excepción; la justificación escrita antes de aprobar quedó, y UA es aprobador y autorizador');

-- ── b · Factura aprobada: aprobador, hora, «forzado por» y justificación ────
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET aprobada_por = 'c0c0c0c0-0000-0000-0000-00000000001a' WHERE id = 'fa403301-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[VER-03b] el aprobador de una factura aprobada no se cambia');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET aprobada_at = '2020-01-01' WHERE id = 'fa403301-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[VER-03b] ni la hora de aprobación');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET match_forzado_por = 'c0c0c0c0-0000-0000-0000-00000000000b' WHERE id = 'fa403301-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[VER-03b] ni quién forzó el cuadre');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET match_justificacion = 'autorizado por gerencia' WHERE id = 'fa403301-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[VER-03b] ni la justificación con que se aprobó');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET aprobada_por = 'c0c0c0c0-0000-0000-0000-00000000001a', aprobada_at = '2020-01-01',
                                 match_forzado_por = 'c0c0c0c0-0000-0000-0000-00000000000b', match_justificacion = 'autorizado por gerencia'
                           WHERE id = 'fa403301-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[VER-03b] ni todo junto (el UPDATE exacto del hallazgo)');
RESET ROLE;
SELECT public.chk_bool((SELECT aprobada_por = :UA::uuid AND aprobada_at > now() - interval '1 hour' AND match_forzado_por = :UA::uuid AND match_justificacion = 'Alza pactada por escrito con el proveedor.'
                          FROM public.facturas_proveedor WHERE id = 'fa403301-0000-0000-0000-000000000001'), true,
  '[VER-03b] la factura conserva aprobador, hora, autorizador y justificación originales');

-- ── c · Recepción registrada: responsable, fecha y hora de registro ─────────
SELECT public.chk_bool((SELECT a.fecha = r.fecha FROM public.conta_asientos a JOIN public.recepciones r ON r.id = a.origen_id
                         WHERE a.origen_tabla = 'recepciones' AND a.origen_evento = 'recepcion_registrada' AND r.id = 'fa403201-0000-0000-0000-000000000001'), true,
  '[VER-03c] preparación: el asiento de la recepción lleva la fecha de la recepción');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.recepciones SET recibido_por = 'c0c0c0c0-0000-0000-0000-00000000001a' WHERE id = 'fa403201-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[VER-03c] quien firmó la conformidad de un servicio registrado no se reasigna');
SELECT public.chk_falla($$ UPDATE public.recepciones SET fecha = current_date - 400 WHERE id = 'fa403201-0000-0000-0000-000000000001' $$,
  'COMPRAS_RECEPCION_REGISTRADA_INMUTABLE|COMPRAS_RECEPCION_IDENTIDAD', '[VER-03c] ni su fecha (la del asiento, el kardex y los activos)');
SELECT public.chk_falla($$ UPDATE public.recepciones SET registrada_at = now() - interval '400 days' WHERE id = 'fa403201-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[VER-03c] ni la hora en que se registró');
SELECT public.chk_falla($$ UPDATE public.recepciones SET recibido_por = 'c0c0c0c0-0000-0000-0000-00000000001a', fecha = current_date - 400, registrada_at = now() - interval '400 days'
                           WHERE id = 'fa403201-0000-0000-0000-000000000001' $$,
  'COMPRAS_RECEPCION_REGISTRADA_INMUTABLE|COMPRAS_RECEPCION_IDENTIDAD|COMPRAS_SELLO_FIJO', '[VER-03c] ni todo junto (el UPDATE exacto del hallazgo)');
-- Reenviar la misma fila no es un cambio.
UPDATE public.recepciones SET recibido_por = recibido_por, fecha = fecha, notas = 'nota añadida' WHERE id = 'fa403201-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_bool((SELECT r.recibido_por = :UO::uuid AND r.fecha = date_trunc('month', CURRENT_DATE)::date AND r.registrada_at > now() - interval '1 hour' AND a.fecha = r.fecha
                          FROM public.recepciones r JOIN public.conta_asientos a ON a.origen_id = r.id AND a.origen_tabla = 'recepciones' AND a.origen_evento = 'recepcion_registrada'
                         WHERE r.id = 'fa403201-0000-0000-0000-000000000001'), true,
  '[VER-03c] la recepción conserva responsable, fecha y hora, y sigue coincidiendo con su asiento');

-- ── d · Orden de pago pagada: fecha, referencia y método ────────────────────
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, metodo_pago, referencia, fecha_pago)
VALUES ('fa403401-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'fa403301-0000-0000-0000-000000000001', 1320, 'cheque', 'REF-BORRADOR', CURRENT_DATE - 5);
-- Antes de pagar siguen siendo editables.
UPDATE public.ordenes_pago SET metodo_pago = 'transferencia', referencia = 'REF-EDITADA', fecha_pago = CURRENT_DATE - 4 WHERE id = 'fa403401-0000-0000-0000-000000000001';
SELECT public.como(:UQ::uuid);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa403401-0000-0000-0000-000000000001';
UPDATE public.ordenes_pago SET referencia = 'REF-ANTES-DE-PAGAR', metodo_pago = 'deposito' WHERE id = 'fa403401-0000-0000-0000-000000000001';
SELECT public.como(:US::uuid);
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE, referencia = 'REF-ORIG-001', metodo_pago = 'transferencia' WHERE id = 'fa403401-0000-0000-0000-000000000001';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE, referencia = 'REF-ORIG-001', metodo_pago = 'transferencia' WHERE id = 'fa403401-0000-0000-0000-000000000001';   -- doble clic: lo mismo no es un cambio
RESET ROLE;
SELECT public.chk_bool((SELECT o.estado = 'pagada' AND a.fecha = CURRENT_DATE AND a.concepto LIKE '%REF-ORIG-001%'
                          FROM public.ordenes_pago o JOIN public.conta_asientos a ON a.origen_id = o.id AND a.origen_tabla = 'ordenes_pago' AND a.origen_evento = 'orden_pago_pagada' AND a.estado = 'publicado'
                         WHERE o.id = 'fa403401-0000-0000-0000-000000000001'), true,
  '[VER-03d] preparación: pagada el día de hoy con REF-ORIG-001; el asiento lleva esa fecha y esa referencia (y el doble clic no duplicó nada)');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'ordenes_pago' AND origen_id = 'fa403401-0000-0000-0000-000000000001' AND origen_evento = 'orden_pago_pagada'), 1,
  '[VER-03d] un solo asiento de pago');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET fecha_pago = current_date - 90 WHERE id = 'fa403401-0000-0000-0000-000000000001' $$,
  'COMPRAS_PAGO_PAGADA_INMUTABLE', '[VER-03d] la fecha de pago de una orden pagada no se cambia (el asiento quedaría en otra fecha)');
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET referencia = 'OTRA' WHERE id = 'fa403401-0000-0000-0000-000000000001' $$,
  'COMPRAS_PAGO_PAGADA_INMUTABLE', '[VER-03d] ni la referencia');
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET metodo_pago = 'efectivo' WHERE id = 'fa403401-0000-0000-0000-000000000001' $$,
  'COMPRAS_PAGO_PAGADA_INMUTABLE', '[VER-03d] ni el método (el asiento usó la cuenta de la transferencia)');
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET fecha_pago = current_date - 90, referencia = 'OTRA', metodo_pago = 'efectivo' WHERE id = 'fa403401-0000-0000-0000-000000000001' $$,
  'COMPRAS_PAGO_PAGADA_INMUTABLE', '[VER-03d] ni los tres a la vez (el UPDATE exacto del hallazgo)');
SELECT public.como(:US::uuid);
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = current_date - 1 WHERE id = 'fa403401-0000-0000-0000-000000000001' $$,
  'COMPRAS_PAGO_PAGADA_INMUTABLE', '[VER-03d] reintentar el pago con OTRA fecha tampoco la reescribe');
RESET ROLE;
SELECT public.chk_bool((SELECT o.fecha_pago = CURRENT_DATE AND o.referencia = 'REF-ORIG-001' AND o.metodo_pago = 'transferencia' AND o.pagada_at > now() - interval '1 hour'
                          FROM public.ordenes_pago o WHERE o.id = 'fa403401-0000-0000-0000-000000000001'), true,
  '[VER-03d] la orden pagada conserva fecha, referencia y método');

-- Anular el pago es el camino para corregirlo: sigue funcionando y revierte el asiento.
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa403401-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'ordenes_pago' AND origen_id = 'fa403401-0000-0000-0000-000000000001' AND origen_evento = 'orden_pago_pagada_revertido'), 1,
  '[VER-03d] anular la orden pagada sigue funcionando y revierte su asiento');

-- ── e · Recepción: editable en borrador; registrar fija la fecha; anular con motivo ──
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa403003-0000-0000-0000-000000000001', 'fa403103-0000-0000-0000-000000000001', :P1::uuid, 'servicio', 10, 100, 0);
SELECT public.ce_recepcion('fa403202-0000-0000-0000-000000000001', 'fa403003-0000-0000-0000-000000000001', 'fa403103-0000-0000-0000-000000000001', 10, 'servicio');
SELECT public.como(:UC::uuid);
UPDATE public.recepciones SET recibido_por = :UO::uuid, fecha = date_trunc('month', CURRENT_DATE)::date WHERE id = 'fa403202-0000-0000-0000-000000000001';   -- borrador: se corrige
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'registrada', fecha = CURRENT_DATE, recibido_por = :UQ::uuid WHERE id = 'fa403202-0000-0000-0000-000000000001';   -- y se puede ajustar en el mismo paso que la registra
RESET ROLE;
SELECT public.chk_bool((SELECT r.estado = 'registrada' AND r.recibido_por = :UQ::uuid AND r.fecha = CURRENT_DATE AND a.fecha = CURRENT_DATE
                          FROM public.recepciones r JOIN public.conta_asientos a ON a.origen_id = r.id AND a.origen_tabla = 'recepciones' AND a.origen_evento = 'recepcion_registrada'
                         WHERE r.id = 'fa403202-0000-0000-0000-000000000001'), true,
  '[VER-03e] editar el borrador y fijar responsable/fecha al registrar funciona; el asiento lleva la fecha final');
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.recepciones SET estado = 'anulada', motivo_anulacion = 'Llegó incompleto' WHERE id = 'fa403202-0000-0000-0000-000000000001';
SELECT public.como(:UC::uuid);
SELECT public.chk_falla($$ UPDATE public.recepciones SET motivo_anulacion = 'Otro motivo' WHERE id = 'fa403202-0000-0000-0000-000000000001' $$,
  'COMPRAS_RECEPCION_REGISTRADA_INMUTABLE', '[VER-03e] el motivo con que se anuló una recepción no se reescribe');
SELECT public.chk_falla($$ UPDATE public.recepciones SET fecha = current_date - 30 WHERE id = 'fa403202-0000-0000-0000-000000000001' $$,
  'COMPRAS_RECEPCION_REGISTRADA_INMUTABLE|COMPRAS_RECEPCION_IDENTIDAD', '[VER-03e] ni la fecha de una recepción anulada');
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || motivo_anulacion FROM public.recepciones WHERE id = 'fa403202-0000-0000-0000-000000000001'),
  'anulada/Llegó incompleto', '[VER-03e] anulada con su motivo original');

-- ── f · Mantenimiento sin sesión de usuario: el camino del sistema no se bloquea ──
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE public.recepciones SET fecha = CURRENT_DATE - 1 WHERE id = 'fa403201-0000-0000-0000-000000000001';
SELECT public.chk_bool((SELECT fecha = CURRENT_DATE - 1 FROM public.recepciones WHERE id = 'fa403201-0000-0000-0000-000000000001'), true,
  '[VER-03f] sin sesión de usuario (mantenimiento) la corrección de un dato registrado sigue siendo posible');
SELECT public.como(:UA::uuid);
