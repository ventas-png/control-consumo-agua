\set ON_ERROR_STOP on
-- ============================================================================
-- [EV-06] Los sellos de actor y de fecha los pone el servidor, en la transición, y nadie más.
--
-- HALLAZGO  aprobada_por/at de la OC, de la orden de pago y de la factura, pagada_at,
--           match_forzado_por, registrada_at (y emitida_at/cerrada_at/anulada_at) solo se sellaban
--           en la transición: antes (INSERT, o un UPDATE previo) y después (UPDATE directo) los
--           reescribía cualquiera con «edit».
-- CAUSA     (1) los INSERT no anulaban los campos de sello; (2) un UPDATE que no pasa por el
--           trigger de la transición (`UPDATE OF estado`) los reescribía; (3) en la transición
--           `emitida_at`, `cerrada_at`, `registrada_at` y `anulada_at` se sellaban con
--           COALESCE(valor del cliente, now()): ganaba el valor del navegador. `emitida_at`
--           decide además si anular la última recepción devuelve la orden a «emitida» o a
--           «aprobada».
-- ESPERADO  Los sellos nacen vacíos (lo del cliente no cuenta); un sello vacío no se adelanta;
--           uno puesto no se reescribe ni se borra (error explícito); en la transición queda el
--           del servidor aunque el cliente mande otro; sin sesión de usuario (mantenimiento) el
--           camino del sistema sigue pudiendo escribirlos.
-- DEPENDE   la migración 20261027000800 (pieza EV-06)
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

-- ── a · Orden: un INSERT con sellos ajenos nace sin sellos ──────────────────
SELECT public.como(:UC::uuid);   -- UC: solo ver/crear/editar/eliminar
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, aprobada_por, aprobada_at, emitida_at, cerrada_at, created_at)
VALUES ('fa406001-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'borrador con sellos forjados', :UA::uuid, '2020-01-01 00:00+00', '2020-01-02 00:00+00', '2020-01-03 00:00+00', '2019-01-01 00:00+00');
RESET ROLE;
SELECT public.chk_bool((SELECT aprobada_por IS NULL AND aprobada_at IS NULL AND emitida_at IS NULL AND cerrada_at IS NULL
                          FROM public.ordenes_compra WHERE id = 'fa406001-0000-0000-0000-000000000001'), true,
  '[EV-06a] un borrador insertado con aprobada_por/at, emitida_at y cerrada_at ajenos nace sin ellos');
SELECT public.chk_bool((SELECT created_at > now() - interval '1 hour' FROM public.ordenes_compra WHERE id = 'fa406001-0000-0000-0000-000000000001'), true,
  '[EV-06a] y la fecha de captura (created_at) es la del servidor, no la que mandó el navegador');

-- ── b · Un UPDATE previo no adelanta el sello: cancelar directo no lo deja ──
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET aprobada_por = :UA::uuid, aprobada_at = '2020-01-01 00:00+00' WHERE id = 'fa406001-0000-0000-0000-000000000001';
UPDATE public.ordenes_compra SET emitida_at = '2020-01-02 00:00+00', cerrada_at = '2020-01-03 00:00+00' WHERE id = 'fa406001-0000-0000-0000-000000000001';
SELECT public.como(:US::uuid);
UPDATE public.ordenes_compra SET estado = 'cancelada', motivo_anulacion = 'sin aprobar nunca' WHERE id = 'fa406001-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'cancelada' AND aprobada_por IS NULL AND aprobada_at IS NULL AND emitida_at IS NULL AND cerrada_at IS NULL
                          FROM public.ordenes_compra WHERE id = 'fa406001-0000-0000-0000-000000000001'), true,
  '[EV-06b] una orden jamás aprobada, cancelada directo, no conserva un «aprobada_por/at» forjado antes');

-- ── c · Orden ya emitida: el sello puesto no se reescribe ni se borra ───────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa406002-0000-0000-0000-000000000001', 'fa406102-0000-0000-0000-000000000001', :P1::uuid, 'servicio', 10, 100, 0);
RESET ROLE;
SELECT public.chk_uuid((SELECT aprobada_por FROM public.ordenes_compra WHERE id = 'fa406002-0000-0000-0000-000000000001'), :UA::uuid,
  '[EV-06c] preparación: la aprobó UA y el servidor lo selló');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET aprobada_por = 'c0c0c0c0-0000-0000-0000-00000000000d' WHERE id = 'fa406002-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06c] quién aprobó una orden emitida no se reescribe');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET aprobada_at = '2020-01-01 00:00+00' WHERE id = 'fa406002-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06c] ni cuándo se aprobó');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET aprobada_por = 'c0c0c0c0-0000-0000-0000-00000000000d', aprobada_at = '2020-01-01 00:00+00' WHERE id = 'fa406002-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06c] ni las dos a la vez (la reproducción del hallazgo)');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET aprobada_por = NULL, aprobada_at = NULL WHERE id = 'fa406002-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06c] ni se borra el sello (la llave del no-borrado es aprobada_at)');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET emitida_at = '2020-01-02 00:00+00' WHERE id = 'fa406002-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06c] ni la fecha de emisión');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET created_at = '2019-01-01 00:00+00' WHERE id = 'fa406002-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06c] ni la fecha de captura');
SELECT public.como(:UA::uuid);   -- el administrador tampoco reescribe el rastro
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET aprobada_por = 'c0c0c0c0-0000-0000-0000-00000000001a', aprobada_at = '2020-01-01 00:00+00' WHERE id = 'fa406002-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06c] ni el administrador de la empresa reescribe quién aprobó y cuándo');
SELECT public.como(:UC::uuid);
UPDATE public.ordenes_compra SET cerrada_at = '2020-01-03 00:00+00' WHERE id = 'fa406002-0000-0000-0000-000000000001';   -- aún sin cerrar: el cliente no lo adelanta
UPDATE public.ordenes_compra SET aprobada_por = aprobada_por, aprobada_at = aprobada_at, concepto = 'concepto editado' WHERE id = 'fa406002-0000-0000-0000-000000000001';   -- reenviar lo mismo sí pasa
RESET ROLE;
SELECT public.chk_bool((SELECT aprobada_por = :UA::uuid AND aprobada_at > now() - interval '1 hour' AND emitida_at > now() - interval '1 hour' AND cerrada_at IS NULL
                          FROM public.ordenes_compra WHERE id = 'fa406002-0000-0000-0000-000000000001'), true,
  '[EV-06c] los sellos siguen siendo los del servidor y un cerrada_at adelantado se ignora');

-- ── d · En la transición queda el sello del servidor, no el del cliente ─────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa406003-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'se aprueba con sellos del cliente');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES ('fa406103-0000-0000-0000-000000000001', :C::uuid, 'fa406003-0000-0000-0000-000000000001', 1, 'Renglón', 'servicio', 'servicios', 10, 'servicio', 100);
SELECT public.como(:UQ::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada', aprobada_por = :UA::uuid, aprobada_at = '2000-01-01 00:00+00' WHERE id = 'fa406003-0000-0000-0000-000000000001';
SELECT public.como(:US::uuid);
UPDATE public.ordenes_compra SET estado = 'emitida', emitida_at = '2020-01-02 00:00+00' WHERE id = 'fa406003-0000-0000-0000-000000000001';
UPDATE public.ordenes_compra SET estado = 'cerrada', cerrada_at = '2020-01-03 00:00+00' WHERE id = 'fa406003-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_bool((SELECT aprobada_por = :UQ::uuid AND aprobada_at > now() - interval '1 hour' AND emitida_at > now() - interval '1 hour' AND cerrada_at > now() - interval '1 hour'
                          FROM public.ordenes_compra WHERE id = 'fa406003-0000-0000-0000-000000000001'), true,
  '[EV-06d] aprobar (UQ), emitir y cerrar con sellos del cliente en el mismo UPDATE: quedan UQ y la hora del servidor');

-- emitida_at no es cosmética: decide a dónde vuelve la orden al anular su última recepción.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa406004-0000-0000-0000-000000000001', 'fa406104-0000-0000-0000-000000000001', :P1::uuid, 'servicio', 10, 100, 0, NULL, false);   -- aprobada, NO emitida
SELECT public.como(:UC::uuid);
UPDATE public.ordenes_compra SET emitida_at = now() WHERE id = 'fa406004-0000-0000-0000-000000000001';           -- «la emití» sin emitirla
SELECT public.como(:UA::uuid);
SELECT public.ce_recepcion('fa406204-0000-0000-0000-000000000001', 'fa406004-0000-0000-0000-000000000001', 'fa406104-0000-0000-0000-000000000001', 10, 'servicio');
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa406204-0000-0000-0000-000000000001';
UPDATE public.recepciones SET estado = 'anulada', motivo_anulacion = 'prueba' WHERE id = 'fa406204-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa406004-0000-0000-0000-000000000001'), 'aprobada',
  '[EV-06d] una orden jamás emitida vuelve a «aprobada» (no a «emitida») al anular su recepción');

-- ── e · La orden que nace ya aprobada/emitida (0700) sigue sellada por el servidor ──
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado, aprobada_por, aprobada_at)
VALUES ('fa406005-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'nace aprobada', 'aprobada', :UA::uuid, '2000-01-01 00:00+00');
SELECT public.como(:UA::uuid);
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado, aprobada_por, aprobada_at, emitida_at, cerrada_at)
VALUES ('fa406006-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'nace emitida', 'emitida', :UQ::uuid, '2000-01-01 00:00+00', '2000-01-02 00:00+00', '2000-01-03 00:00+00');
RESET ROLE;
SELECT public.chk_bool((SELECT aprobada_por = :UQ::uuid AND aprobada_at > now() - interval '1 hour' FROM public.ordenes_compra WHERE id = 'fa406005-0000-0000-0000-000000000001'), true,
  '[EV-06e] la orden que nace «aprobada» la sella quien la inserta (UQ), no el que dijo el cliente');
SELECT public.chk_bool((SELECT aprobada_por = :UA::uuid AND aprobada_at > now() - interval '1 hour' AND emitida_at > now() - interval '1 hour' AND cerrada_at IS NULL
                          FROM public.ordenes_compra WHERE id = 'fa406006-0000-0000-0000-000000000001'), true,
  '[EV-06e] la que nace «emitida» queda con aprobada_por UA, emitida_at del servidor y sin cerrada_at');

-- ── f · Recepción: registrada_at/anulada_at ─────────────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa406007-0000-0000-0000-000000000001', 'fa406107-0000-0000-0000-000000000001', :P1::uuid, 'servicio', 10, 100, 0);
SELECT public.como(:UC::uuid);
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por, registrada_at, anulada_at, motivo_anulacion, created_at)
VALUES ('fa406207-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, 'fa406007-0000-0000-0000-000000000001', 'servicio', :UO::uuid,
        '2020-01-01 00:00+00', '2020-01-02 00:00+00', 'motivo previo', '2019-01-01 00:00+00');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
VALUES (:C::uuid, 'fa406207-0000-0000-0000-000000000001', 'fa406107-0000-0000-0000-000000000001', 10);
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'borrador' AND registrada_at IS NULL AND anulada_at IS NULL AND motivo_anulacion IS NULL AND created_at > now() - interval '1 hour'
                          FROM public.recepciones WHERE id = 'fa406207-0000-0000-0000-000000000001'), true,
  '[EV-06f] una recepción insertada con registrada_at/anulada_at/motivo ajenos nace sin ellos');
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.recepciones SET estado = 'registrada', registrada_at = '2020-05-05 00:00+00' WHERE id = 'fa406207-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'registrada' AND registrada_at > now() - interval '1 hour' AND recibido_por = :UO::uuid
                          FROM public.recepciones WHERE id = 'fa406207-0000-0000-0000-000000000001'), true,
  '[EV-06f] registrar con un registrada_at del cliente deja la hora del servidor (y el responsable declarado, UO)');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.recepciones SET registrada_at = '2020-01-01 00:00+00' WHERE id = 'fa406207-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06f] la hora de registro de una recepción registrada no se reescribe (la llave del no-borrado)');
SELECT public.chk_falla($$ UPDATE public.recepciones SET registrada_at = NULL WHERE id = 'fa406207-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06f] ni se borra');
UPDATE public.recepciones SET anulada_at = '2001-01-01 00:00+00' WHERE id = 'fa406207-0000-0000-0000-000000000001';   -- aún sin anular: se ignora
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'anulada', motivo_anulacion = 'devuelta por el proveedor', anulada_at = '2001-01-01 00:00+00' WHERE id = 'fa406207-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'anulada' AND anulada_at > now() - interval '1 hour' AND motivo_anulacion = 'devuelta por el proveedor'
                          FROM public.recepciones WHERE id = 'fa406207-0000-0000-0000-000000000001'), true,
  '[EV-06f] anular con un anulada_at del cliente deja la hora del servidor y el motivo que se dio');

-- ── g · Factura: aprobada_por/at y match_forzado_por ────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa406008-0000-0000-0000-000000000001', 'fa406108-0000-0000-0000-000000000001', :P1::uuid, 'servicio', 10, 100, 0);
SELECT public.ce_recepcion('fa406208-0000-0000-0000-000000000001', 'fa406008-0000-0000-0000-000000000001', 'fa406108-0000-0000-0000-000000000001', 10, 'servicio');
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa406208-0000-0000-0000-000000000001';
SELECT public.como(:UC::uuid);
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, monto_total, aprobada_por, aprobada_at, match_forzado_por, match_justificacion, created_at)
VALUES ('fa406308-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'fa406008-0000-0000-0000-000000000001', 'FA4-06-0001', 'Factura con sellos forjados', 1,
        :UQ::uuid, '2020-01-01 00:00+00', :UA::uuid, 'autorizado por gerencia', '2019-01-01 00:00+00');
INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto)
VALUES (:C::uuid, 'fa406308-0000-0000-0000-000000000001', 'fa406108-0000-0000-0000-000000000001', 1, 'Renglón', 10, 100, 0);
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'registrada' AND aprobada_por IS NULL AND aprobada_at IS NULL AND match_forzado_por IS NULL AND created_at > now() - interval '1 hour'
                          FROM public.facturas_proveedor WHERE id = 'fa406308-0000-0000-0000-000000000001'), true,
  '[EV-06g] una factura insertada con aprobador, hora y «forzado por» ajenos nace sin ellos');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET aprobada_por = :UQ::uuid, aprobada_at = '2020-01-01 00:00+00', match_forzado_por = :UA::uuid WHERE id = 'fa406308-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_bool((SELECT aprobada_por IS NULL AND aprobada_at IS NULL AND match_forzado_por IS NULL FROM public.facturas_proveedor WHERE id = 'fa406308-0000-0000-0000-000000000001'), true,
  '[EV-06g] un UPDATE previo a la aprobación tampoco adelanta los sellos');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa406308-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'aprobada' AND aprobada_por = :UA::uuid AND aprobada_at > now() - interval '1 hour' AND match_forzado_por IS NULL
                          FROM public.facturas_proveedor WHERE id = 'fa406308-0000-0000-0000-000000000001'), true,
  '[EV-06g] aprobar la factura la sella UA con la hora del servidor');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET aprobada_por = 'c0c0c0c0-0000-0000-0000-00000000001a' WHERE id = 'fa406308-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06g] quién aprobó la factura no se reescribe');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET aprobada_at = '2020-01-01 00:00+00' WHERE id = 'fa406308-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06g] ni cuándo');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET aprobada_por = NULL WHERE id = 'fa406308-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06g] ni se borra el aprobador');
UPDATE public.facturas_proveedor SET match_forzado_por = 'c0c0c0c0-0000-0000-0000-00000000000a' WHERE id = 'fa406308-0000-0000-0000-000000000001';   -- no hubo excepción: no se inventa
RESET ROLE;
SELECT public.chk_bool((SELECT aprobada_por = :UA::uuid AND match_forzado_por IS NULL FROM public.facturas_proveedor WHERE id = 'fa406308-0000-0000-0000-000000000001'), true,
  '[EV-06g] y una factura que cuadró no acepta un «forzado por» inventado después');

-- Factura aprobada CON excepción (precio +20 %): quién la forzó queda sellado.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa406009-0000-0000-0000-000000000001', 'fa406109-0000-0000-0000-000000000001', :P1::uuid, 'servicio', 10, 100, 0);
SELECT public.ce_recepcion('fa406209-0000-0000-0000-000000000001', 'fa406009-0000-0000-0000-000000000001', 'fa406109-0000-0000-0000-000000000001', 10, 'servicio');
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa406209-0000-0000-0000-000000000001';
SELECT public.ce_factura('fa406309-0000-0000-0000-000000000001', 'fa406009-0000-0000-0000-000000000001', 'fa406109-0000-0000-0000-000000000001', :P1::uuid, 'FA4-06-0002', 10, 120, 0);
UPDATE public.facturas_proveedor SET estado = 'aprobada', match_forzado_por = :UB::uuid, match_justificacion = 'Alza pactada por escrito con el proveedor.' WHERE id = 'fa406309-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_bool((SELECT aprobada_por = :UA::uuid AND match_forzado_por = :UA::uuid AND match_justificacion = 'Alza pactada por escrito con el proveedor.'
                          FROM public.facturas_proveedor WHERE id = 'fa406309-0000-0000-0000-000000000001'), true,
  '[EV-06g] aprobar con excepción: el autorizador es quien ejecuta (UA), no el que declaró el cliente (UB)');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET match_forzado_por = 'c0c0c0c0-0000-0000-0000-00000000000b' WHERE id = 'fa406309-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06g] quién forzó el cuadre no se reasigna después');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET match_forzado_por = NULL WHERE id = 'fa406309-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06g] ni se borra (la excepción quedaría sin autorizador)');
RESET ROLE;

-- ── h · Orden de pago: el INSERT no admite aprobador, hora de aprobación ni de pago ──
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, solicitada_por, aprobada_por, aprobada_at, pagada_at, created_at)
VALUES ('fa406401-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'fa406308-0000-0000-0000-000000000001', 100,
        :UA::uuid, :UA::uuid, '2020-01-01 00:00+00', '2020-01-02 00:00+00', '2019-01-01 00:00+00');
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'borrador' AND solicitada_por = :UC::uuid AND aprobada_por IS NULL AND aprobada_at IS NULL AND pagada_at IS NULL AND created_at > now() - interval '1 hour'
                          FROM public.ordenes_pago WHERE id = 'fa406401-0000-0000-0000-000000000001'), true,
  '[EV-06h] una orden de pago insertada con aprobador y horas de aprobación/pago ajenos nace sin ellos (y solicitada_por = quien la captura)');
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa406401-0000-0000-0000-000000000001';   -- borrador → anulada, sin pasar por aprobada
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'anulada' AND aprobada_por IS NULL AND aprobada_at IS NULL AND pagada_at IS NULL
                          FROM public.ordenes_pago WHERE id = 'fa406401-0000-0000-0000-000000000001'), true,
  '[EV-06h] una orden jamás aprobada ni pagada, anulada, no conserva sellos de aprobación o de pago');
-- La vía legítima sigue sellando.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, solicitada_por)
VALUES ('fa406402-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'fa406308-0000-0000-0000-000000000001', 1000, :UC::uuid);
SELECT public.como(:UQ::uuid);
UPDATE public.ordenes_pago SET estado = 'aprobada', aprobada_por = :UA::uuid, aprobada_at = '2000-01-01 00:00+00' WHERE id = 'fa406402-0000-0000-0000-000000000001';
SELECT public.como(:US::uuid);
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE, pagada_at = '2000-01-01 00:00+00' WHERE id = 'fa406402-0000-0000-0000-000000000001';
SELECT public.como(:UC::uuid);
DO $$ BEGIN
  UPDATE public.ordenes_pago SET aprobada_por = 'c0c0c0c0-0000-0000-0000-00000000000d', aprobada_at = '2020-01-01 00:00+00', pagada_at = '2020-01-02 00:00+00' WHERE id = 'fa406402-0000-0000-0000-000000000001';
EXCEPTION WHEN OTHERS THEN NULL;   -- revertir en silencio (0100) o rechazar: ambos valen; lo que importa es que no cambie
END $$;
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET created_at = '2019-01-01 00:00+00' WHERE id = 'fa406402-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06h] la fecha de captura de la orden de pago no se reescribe');
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'pagada' AND solicitada_por = :UA::uuid AND aprobada_por = :UQ::uuid AND aprobada_at > now() - interval '1 hour' AND pagada_at > now() - interval '1 hour'
                          FROM public.ordenes_pago WHERE id = 'fa406402-0000-0000-0000-000000000001'), true,
  '[EV-06h] camino legítimo: solicita UA, aprueba UQ, paga US; las horas son del servidor y nadie las reescribe después');

-- ── j · Contraseña de pago: pagada_at y motivo_anulacion ───────────────────
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada, pagada_at, motivo_anulacion, created_at, created_by)
VALUES ('fa406501-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE, '2020-01-01 00:00+00', 'motivo previo', '2019-01-01 00:00+00', :UA::uuid);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa406501-0000-0000-0000-000000000001', 'fa406309-0000-0000-0000-000000000001', 1200);
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa406502-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
UPDATE public.contrasenas_pago SET pagada_at = '2020-01-01 00:00+00' WHERE id = 'fa406501-0000-0000-0000-000000000001';   -- aún sin pagar: se ignora
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'emitida' AND pagada_at IS NULL AND motivo_anulacion IS NULL AND created_at > now() - interval '1 hour' AND created_by = :UC::uuid
                          FROM public.contrasenas_pago WHERE id = 'fa406501-0000-0000-0000-000000000001'), true,
  '[EV-06j] una contraseña insertada con pagada_at, motivo y «creada por» ajenos nace sin ellos (creada por UC), y un UPDATE previo no adelanta pagada_at');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.contrasenas_pago SET created_by = 'c0c0c0c0-0000-0000-0000-00000000001a' WHERE id = 'fa406501-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06j] quién emitió la contraseña no se reasigna');
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa406403-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'fa406501-0000-0000-0000-000000000001', 1200);
SELECT public.como(:UQ::uuid);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa406403-0000-0000-0000-000000000001';
SELECT public.como(:US::uuid);
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa406403-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'pagada' AND pagada_at > now() - interval '1 hour' FROM public.contrasenas_pago WHERE id = 'fa406501-0000-0000-0000-000000000001'), true,
  '[EV-06j] camino legítimo: al pagarse su orden de pago, la contraseña queda «pagada» con la hora del servidor');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.contrasenas_pago SET pagada_at = '2020-01-01 00:00+00' WHERE id = 'fa406501-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06j] la hora de pago de una contraseña pagada no se reescribe');
SELECT public.como(:US::uuid);
UPDATE public.contrasenas_pago SET estado = 'anulada', motivo_anulacion = 'Error de captura' WHERE id = 'fa406502-0000-0000-0000-000000000001';
SELECT public.como(:UC::uuid);
SELECT public.chk_falla($$ UPDATE public.contrasenas_pago SET motivo_anulacion = 'Otro motivo' WHERE id = 'fa406502-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06j] el motivo con que se anuló una contraseña no se reescribe');
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || motivo_anulacion FROM public.contrasenas_pago WHERE id = 'fa406502-0000-0000-0000-000000000001'), 'anulada/Error de captura',
  '[EV-06j] anular con motivo funciona y el motivo se conserva');

-- ── i · Mantenimiento sin sesión de usuario: el camino del sistema sigue escribiendo sellos ──
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, aprobada_por, aprobada_at, created_at)
VALUES ('fa406010-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'carga histórica sin sesión', :UA::uuid, '2020-01-01 00:00+00', '2019-06-01 00:00+00');
UPDATE public.ordenes_compra SET emitida_at = '2020-01-02 00:00+00' WHERE id = 'fa406002-0000-0000-0000-000000000001';
SELECT public.chk_bool((SELECT aprobada_por = :UA::uuid AND aprobada_at = '2020-01-01 00:00+00' AND created_at = '2019-06-01 00:00+00' FROM public.ordenes_compra WHERE id = 'fa406010-0000-0000-0000-000000000001'), true,
  '[EV-06k] sin sesión de usuario (carga histórica, service_role) el INSERT conserva los sellos que se mandan');
SELECT public.chk_bool((SELECT emitida_at = '2020-01-02 00:00+00' FROM public.ordenes_compra WHERE id = 'fa406002-0000-0000-0000-000000000001'), true,
  '[EV-06k] y un UPDATE de mantenimiento sin sesión puede corregir un sello');

-- ── l · Eliminar a un usuario que aprobó/recibió: la limpieza del motor (ON DELETE SET NULL) no se bloquea ──
-- (aun si quien lo elimina lo hace con una sesión de usuario: no es una persona reescribiendo un sello)
INSERT INTO auth.users (id) VALUES ('fa406f01-0000-0000-0000-000000000001');
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE public.ordenes_compra     SET aprobada_por      = 'fa406f01-0000-0000-0000-000000000001' WHERE id = 'fa406002-0000-0000-0000-000000000001';
UPDATE public.facturas_proveedor SET match_forzado_por = 'fa406f01-0000-0000-0000-000000000001' WHERE id = 'fa406309-0000-0000-0000-000000000001';
UPDATE public.recepciones        SET recibido_por      = 'fa406f01-0000-0000-0000-000000000001' WHERE id = 'fa406207-0000-0000-0000-000000000001';
SELECT public.como(:UA::uuid);
DELETE FROM auth.users WHERE id = 'fa406f01-0000-0000-0000-000000000001';
SELECT public.chk_bool((SELECT o.aprobada_por IS NULL AND f.match_forzado_por IS NULL AND r.recibido_por IS NULL
                          FROM public.ordenes_compra o, public.facturas_proveedor f, public.recepciones r
                         WHERE o.id = 'fa406002-0000-0000-0000-000000000001' AND f.id = 'fa406309-0000-0000-0000-000000000001' AND r.id = 'fa406207-0000-0000-0000-000000000001'), true,
  '[EV-06l] eliminar al usuario deja en NULL su aprobación/autorización/recepción (el motor no choca con los sellos fijos)');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET aprobada_por = NULL WHERE id = 'fa406003-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-06l] pero borrar el sello de un aprobador que SIGUE existiendo sí se rechaza');
RESET ROLE;
SELECT public.como(:UA::uuid);
