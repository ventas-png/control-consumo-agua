-- ============================================================================
-- [CONC-04] UN PAGO NO SE CONFIRMA SIN SU ASIENTO, NI UNA ANULACIÓN SIN SU REVERSO
--
-- Hallazgo: conta_generar_asiento y conta_reversar_automatico terminan en
--   EXCEPTION WHEN OTHERS → RAISE WARNING → RETURN NULL. Para las órdenes de pago no hay
--   bandeja de pendientes ni reproceso: el pago queda «pagada» (y la factura con su monto
--   pagado) SIN asiento, o la orden queda «anulada» con el asiento original vivo.
-- Causa raíz: el trigger del pago (conta_tg_ordenes_pago) invoca al generador/reversador y
--   NO verifica su postcondición; el error contable queda oculto tras una operación «exitosa».
-- Comportamiento esperado (criterio del dueño: ningún error contable se esconde dejando el
--   pago exitoso): si la contabilidad OPERA (tiene catálogo) y el asiento no quedó —sea por
--   falta de mapeo, cuenta no válida, espera de bloqueo, interbloqueo o cualquier excepción—
--   el pago FALLA entero con COMPRAS_PAGO_SIN_ASIENTO; si la anulación deja un asiento del pago
--   publicado sin reverso, FALLA entera con COMPRAS_PAGO_REVERSO_FALLIDO. Se mantienen:
--   · libro sin catálogo (aún no opera): se paga/anula sin asiento (decisión a confirmar);
--   · moneda extranjera sin tipo de cambio del mes: se paga con el asiento en BORRADOR
--     pendiente de tipo de cambio (diseño #904); al ANULAR ese pago, el borrador se anula;
--   · periodo cerrado: el asiento se fecha hoy y se publica (no es una omisión);
--   · la idempotencia (ON CONFLICT) del asiento y el doble clic;
--   · un pago histórico «pagada» sin asiento puede anularse (no hay nada que revertir).
-- El caso de concurrencia (espera de bloqueo real) está en CONC-04.conc.sh.
--
-- Cada escenario corre en su propia transacción y la deshace (ROLLBACK): nada queda. Las
-- averías se simulan con un trigger de prueba que lanza una excepción al insertar el asiento
-- (la «excepción cualquiera» que el EXCEPTION WHEN OTHERS se traga).
-- Ids propios: fa1 04NNN-0000-0000-0000-… (grupo pagos_asiento, K=1).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

-- Factura aprobada de `p_monto` + una orden de pago APROBADA lista para pagar (SECURITY INVOKER:
-- corre con la sesión que la llama). Ids: factura …0001, orden …00a1, con el número p_k.
CREATE OR REPLACE FUNCTION public.fa1_c04_preparar(p_k integer, p_proj uuid, p_monto numeric DEFAULT 100, p_moneda text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_f uuid := ('fa1' || lpad(p_k::text, 5, '0') || '-0000-0000-0000-000000000001')::uuid;
  v_o uuid := ('fa1' || lpad(p_k::text, 5, '0') || '-0000-0000-0000-0000000000a1')::uuid;
BEGIN
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, moneda)
  VALUES (v_f, 'cccccccc-cccc-cccc-cccc-cccccccccccc', p_proj, 'e3000000-0000-0000-0000-000000000001', 'FA1-C04-' || p_k, 'CONC-04', p_monto, p_moneda);
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = v_f;
  INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, metodo_pago)
  VALUES (v_o, 'cccccccc-cccc-cccc-cccc-cccccccccccc', p_proj, 'e3000000-0000-0000-0000-000000000001', v_f, p_monto, 'transferencia');
  UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = v_o;
END;
$$;
-- Avería de prueba: el libro lanza una excepción al insertar un asiento automático de ese evento.
CREATE OR REPLACE FUNCTION public.fa1_c04_averia() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'FA1 avería simulada del libro (%)', NEW.origen_evento;
END;
$$;

-- ═══ A · LEGÍTIMO: pagar con el mapeo completo deja UN asiento publicado, y el doble clic no lo duplica ═══
BEGIN;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa1_c04_preparar(4001, :C2::uuid, 100);
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104001-0000-0000-0000-0000000000a1';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104001-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa104001-0000-0000-0000-0000000000a1'), 'pagada',
  '[CONC-04a] pagar con el mapeo completo: la orden queda pagada');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'ordenes_pago' AND origen_id = 'fa104001-0000-0000-0000-0000000000a1'
                    AND origen_evento = 'orden_pago_pagada' AND estado = 'publicado' AND total_debe = 100 AND total_haber = 100), 1,
  '[CONC-04a] …con UN asiento publicado y cuadrado (el reintento por doble clic no lo duplicó)');
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa104001-0000-0000-0000-000000000001'), 'pagada/100.00',
  '[CONC-04a] …y la factura queda pagada');
ROLLBACK;

-- ═══ B · LEGÍTIMO: anular un pago con asiento lo revierte con un asiento propio ═══
BEGIN;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa1_c04_preparar(4002, :C2::uuid, 100);
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104002-0000-0000-0000-0000000000a1';
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa104002-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa104002-0000-0000-0000-0000000000a1'), 'anulada',
  '[CONC-04b] anular un pago con asiento: la orden queda anulada');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa104002-0000-0000-0000-0000000000a1'
                    AND origen_evento = 'orden_pago_pagada_revertido' AND estado = 'publicado'), 1,
  '[CONC-04b] …con su asiento de reverso publicado');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa104002-0000-0000-0000-0000000000a1'
                    AND origen_evento = 'orden_pago_pagada' AND estado = 'publicado' AND anulado_por_id IS NOT NULL), 1,
  '[CONC-04b] …y el asiento original marcado como reversado');
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa104002-0000-0000-0000-000000000001'), 'aprobada/0.00',
  '[CONC-04b] …y la factura recupera su saldo');
ROLLBACK;

-- ═══ C · FALTA el mapeo de CxP: el pago NO se confirma ═══
BEGIN;
DELETE FROM public.conta_mapeo_cuentas WHERE company_id = :C::uuid AND project_id = :C2::uuid AND evento = 'cxp_proveedores';
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa1_c04_preparar(4003, :C2::uuid, 100);
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104003-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_PAGO_SIN_ASIENTO.*cxp_proveedores', '[CONC-04c] sin el mapeo de CxP el pago NO se confirma (y el error dice cuál falta)');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa104003-0000-0000-0000-0000000000a1'), 'aprobada',
  '[CONC-04c] …la orden sigue aprobada');
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa104003-0000-0000-0000-000000000001'), 'aprobada/0.00',
  '[CONC-04c] …y la factura no se movió');
ROLLBACK;

-- ═══ D · FALTA el mapeo del método de pago ═══
BEGIN;
DELETE FROM public.conta_mapeo_cuentas WHERE company_id = :C::uuid AND project_id = :C2::uuid AND evento = 'metodo_transferencia';
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa1_c04_preparar(4004, :C2::uuid, 100);
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104004-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_PAGO_SIN_ASIENTO.*metodo_transferencia', '[CONC-04d] sin el mapeo del método de pago el pago NO se confirma');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa104004-0000-0000-0000-0000000000a1'), 'aprobada', '[CONC-04d] …la orden sigue aprobada');
ROLLBACK;

-- ═══ E · La cuenta mapeada está INACTIVA o dejó de ser de DETALLE: el asiento no es válido ═══
BEGIN;
UPDATE public.conta_cuentas SET activa = false
 WHERE id = (SELECT cuenta_id FROM public.conta_mapeo_cuentas WHERE company_id = :C::uuid AND project_id = :C2::uuid AND evento = 'metodo_transferencia');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa1_c04_preparar(4005, :C2::uuid, 100);
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104005-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_PAGO_SIN_ASIENTO.*cuentas no válidas', '[CONC-04e] con la cuenta mapeada inactiva el pago NO se confirma (conta_publicar_asiento tampoco la admite)');
RESET ROLE;
ROLLBACK;
BEGIN;
UPDATE public.conta_cuentas SET es_detalle = false
 WHERE id = (SELECT cuenta_id FROM public.conta_mapeo_cuentas WHERE company_id = :C::uuid AND project_id = :C2::uuid AND evento = 'cxp_proveedores');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa1_c04_preparar(4006, :C2::uuid, 100);
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104006-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_PAGO_SIN_ASIENTO.*cuentas no válidas', '[CONC-04e] con la cuenta mapeada convertida en agrupadora el pago NO se confirma');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa104006-0000-0000-0000-0000000000a1'), 'aprobada', '[CONC-04e] …la orden sigue aprobada');
ROLLBACK;

-- ═══ F · «Excepción cualquiera» al generar el asiento (la que se traga el EXCEPTION WHEN OTHERS) ═══
BEGIN;
CREATE TRIGGER fa1_c04_averia_pago BEFORE INSERT ON public.conta_asientos
  FOR EACH ROW WHEN (NEW.origen_evento = 'orden_pago_pagada') EXECUTE FUNCTION public.fa1_c04_averia();
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa1_c04_preparar(4007, :C2::uuid, 100);
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104007-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_PAGO_SIN_ASIENTO', '[CONC-04f] una excepción al generar el asiento ya no se esconde: el pago NO se confirma');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa104007-0000-0000-0000-0000000000a1'), 'aprobada', '[CONC-04f] …la orden sigue aprobada');
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa104007-0000-0000-0000-000000000001'), 'aprobada/0.00',
  '[CONC-04f] …y la factura no se movió');
ROLLBACK;

-- ═══ G · El mismo control para un proceso SIN sesión de usuario (service_role / sistema) ═══
BEGIN;
DELETE FROM public.conta_mapeo_cuentas WHERE company_id = :C::uuid AND project_id = :C2::uuid AND evento = 'cxp_proveedores';
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa1_c04_preparar(4008, :C2::uuid, 100);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104008-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_PAGO_SIN_ASIENTO', '[CONC-04g] un proceso sin sesión de usuario tampoco puede dejar un pago sin asiento');
ROLLBACK;

-- ═══ H · Contabilidad SIN catálogo (aún no opera): se paga y se anula sin asiento (como las facturas) ═══
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.conta_mapeo_cuentas WHERE company_id = :C::uuid AND project_id = :C2::uuid;
DELETE FROM public.conta_cuentas WHERE company_id = :C::uuid AND project_id = :C2::uuid;
SET LOCAL session_replication_role = origin;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa1_c04_preparar(4009, :C2::uuid, 100);
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104009-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa104009-0000-0000-0000-0000000000a1'), 'pagada',
  '[CONC-04h] una contabilidad sin catálogo aún no opera: el pago se confirma');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa104009-0000-0000-0000-0000000000a1'), 0,
  '[CONC-04h] …sin asiento (no hay libro que lo reciba)');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa104009-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa104009-0000-0000-0000-0000000000a1'), 'anulada',
  '[CONC-04h] …y anularlo también');
ROLLBACK;

-- ═══ I · Periodo cerrado: NO es una omisión; el asiento se publica fechado hoy ═══
BEGIN;
INSERT INTO public.cierres_mensuales (company_id, project_id, periodo, estado)
VALUES (:C::uuid, :C2::uuid, to_char(CURRENT_DATE - 40, 'YYYY-MM'), 'cerrado');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa1_c04_preparar(4010, :C2::uuid, 100);
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE - 40 WHERE id = 'fa104010-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || fecha FROM public.conta_asientos WHERE origen_id = 'fa104010-0000-0000-0000-0000000000a1' AND origen_evento = 'orden_pago_pagada'),
  'publicado/' || CURRENT_DATE, '[CONC-04i] pago con fecha en un periodo cerrado: el asiento se publica fechado hoy');
ROLLBACK;

-- ═══ J · Moneda extranjera: con tipo de cambio del mes, publicado; sin él, borrador pendiente (diseño #904) ═══
BEGIN;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa1_c04_preparar(4011, :C2::uuid, 100, 'USD');
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104011-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || total_debe FROM public.conta_asientos WHERE origen_id = 'fa104011-0000-0000-0000-0000000000a1' AND origen_evento = 'orden_pago_pagada'),
  'publicado/775.00', '[CONC-04j] USD con tipo de cambio del mes (7.75): asiento publicado por 775');
ROLLBACK;
BEGIN;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa1_c04_preparar(4012, :C2::uuid, 100, 'USD');
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE - 70 WHERE id = 'fa104012-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || tipo_cambio_pendiente FROM public.conta_asientos WHERE origen_id = 'fa104012-0000-0000-0000-0000000000a1' AND origen_evento = 'orden_pago_pagada'),
  'borrador/true', '[CONC-04j] USD sin tipo de cambio del mes: el pago se confirma con el asiento en BORRADOR pendiente (visible; diseño vigente)');
-- Anular ese pago: el borrador pendiente NO puede quedar vivo (se publicaría después como egreso de una orden anulada).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa104012-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.conta_asientos WHERE origen_id = 'fa104012-0000-0000-0000-0000000000a1' AND origen_evento = 'orden_pago_pagada'),
  'anulado', '[CONC-04j] anular un pago cuyo asiento era un borrador pendiente de tipo de cambio: el borrador queda ANULADO');
INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, moneda_base, periodo, tasa)
VALUES (:C::uuid, 'USD', 'GTQ', to_char(CURRENT_DATE - 70, 'YYYY-MM'), 7.700000);
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT * FROM public.conta_publicar_asiento((SELECT id FROM public.conta_asientos WHERE origen_id = 'fa104012-0000-0000-0000-0000000000a1' AND origen_evento = 'orden_pago_pagada')) $$,
  'Solo un borrador puede publicarse', '[CONC-04j] …y aunque luego se configure el tipo de cambio, ese asiento ya no puede publicarse');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa104012-0000-0000-0000-0000000000a1' AND estado = 'publicado'), 0,
  '[CONC-04j] …no queda ningún asiento publicado de un pago anulado');
ROLLBACK;

-- ═══ K · El REVERSO falla (excepción cualquiera): la anulación NO se confirma ═══
BEGIN;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa1_c04_preparar(4013, :C2::uuid, 100);
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104013-0000-0000-0000-0000000000a1';
RESET ROLE;
CREATE TRIGGER fa1_c04_averia_reverso BEFORE INSERT ON public.conta_asientos
  FOR EACH ROW WHEN (NEW.origen_evento = 'orden_pago_pagada_revertido') EXECUTE FUNCTION public.fa1_c04_averia();
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa104013-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_PAGO_REVERSO_FALLIDO', '[CONC-04k] si el reverso no se registra, la anulación NO se confirma');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa104013-0000-0000-0000-0000000000a1'), 'pagada', '[CONC-04k] …la orden sigue pagada');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa104013-0000-0000-0000-0000000000a1'
                    AND origen_evento = 'orden_pago_pagada' AND estado = 'publicado' AND anulado_por_id IS NULL), 1,
  '[CONC-04k] …con su asiento original vivo (consistente con la orden)');
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa104013-0000-0000-0000-000000000001'), 'pagada/100.00',
  '[CONC-04k] …y la factura sigue pagada');
ROLLBACK;

-- ═══ L · El reverso del DIFERENCIAL cambiario falla: tampoco se confirma la anulación ═══
BEGIN;
INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, moneda_base, periodo, tasa)
VALUES (:C::uuid, 'USD', 'GTQ', to_char(CURRENT_DATE - 62, 'YYYY-MM'), 9.000000);
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
SELECT :C::uuid, :C2::uuid, 'diferencial_cambiario',
       (SELECT id FROM public.conta_cuentas WHERE company_id = :C::uuid AND project_id = :C2::uuid AND tipo = 'gasto' AND es_detalle AND activa ORDER BY codigo LIMIT 1);
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, moneda, fecha_emision)
VALUES ('fa104014-0000-0000-0000-000000000001', :C::uuid, :C2::uuid, :P1::uuid, 'FA1-C04-4014', 'CONC-04 diferencial', 100, 'USD', CURRENT_DATE - 62);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa104014-0000-0000-0000-000000000001';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, metodo_pago)
VALUES ('fa104014-0000-0000-0000-0000000000a1', :C::uuid, :C2::uuid, :P1::uuid, 'fa104014-0000-0000-0000-000000000001', 100, 'transferencia');
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa104014-0000-0000-0000-0000000000a1';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104014-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa104014-0000-0000-0000-0000000000a1' AND origen_evento = 'diferencial_cambiario' AND estado = 'publicado'), 1,
  '[CONC-04l] preparación: el pago en USD (factura a 9.00, pago a 7.75) generó su diferencial cambiario publicado');
CREATE TRIGGER fa1_c04_averia_dif BEFORE INSERT ON public.conta_asientos
  FOR EACH ROW WHEN (NEW.origen_evento = 'diferencial_cambiario_revertido') EXECUTE FUNCTION public.fa1_c04_averia();
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa104014-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_PAGO_REVERSO_FALLIDO.*diferencial_cambiario', '[CONC-04l] si el reverso del diferencial no se registra, la anulación NO se confirma');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa104014-0000-0000-0000-0000000000a1'), 'pagada', '[CONC-04l] …la orden sigue pagada');
ROLLBACK;

-- ═══ M · Un pago HISTÓRICO «pagada» sin asiento (libro que opera) SÍ puede anularse: no hay nada que revertir ═══
BEGIN;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa1_c04_preparar(4015, :C2::uuid, 100);
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104015-0000-0000-0000-0000000000a1';
RESET ROLE;
SET LOCAL session_replication_role = replica;      -- emula el dato histórico: pagada, pero sin su asiento
DELETE FROM public.conta_asiento_lineas WHERE asiento_id IN (SELECT id FROM public.conta_asientos WHERE origen_id = 'fa104015-0000-0000-0000-0000000000a1');
DELETE FROM public.conta_asientos WHERE origen_id = 'fa104015-0000-0000-0000-0000000000a1';
SET LOCAL session_replication_role = origin;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa104015-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa104015-0000-0000-0000-0000000000a1'), 'anulada',
  '[CONC-04m] un pago histórico sin asiento se puede anular (el control no atrapa al usuario)');
ROLLBACK;

-- ═══ N · Idempotencia: si el asiento del pago YA existe vivo, pagar no lo duplica ni se rechaza ═══
BEGIN;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa1_c04_preparar(4016, :C2::uuid, 100);
RESET ROLE;
SELECT public.conta_generar_asiento(:C::uuid, :C2::uuid, 'ordenes_pago', 'fa104016-0000-0000-0000-0000000000a1', 'orden_pago_pagada', CURRENT_DATE,
  'FA1 asiento previo', 'egreso', 'GTQ',
  jsonb_build_array(jsonb_build_object('evento', 'cxp_proveedores', 'debe', 100), jsonb_build_object('evento', 'metodo_transferencia', 'haber', 100)));
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104016-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa104016-0000-0000-0000-0000000000a1'), 'pagada',
  '[CONC-04n] con el asiento ya existente (ON CONFLICT) el pago se confirma');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa104016-0000-0000-0000-0000000000a1' AND origen_evento = 'orden_pago_pagada' AND estado <> 'anulado'), 1,
  '[CONC-04n] …y sigue habiendo UN solo asiento (no se duplicó)');
ROLLBACK;

-- ═══ O · Contraseña de pago: sin asiento no se paga; con asiento se paga y se anula ═══
BEGIN;
DELETE FROM public.conta_mapeo_cuentas WHERE company_id = :C::uuid AND project_id = :C2::uuid AND evento = 'cxp_proveedores';
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa104017-0000-0000-0000-000000000001', :C::uuid, :C2::uuid, :P1::uuid, 'FA1-C04-4017', 'CONC-04 contraseña', 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa104017-0000-0000-0000-000000000001';
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa104017-0000-0000-0000-0000000000b1', :C::uuid, :C2::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa104017-0000-0000-0000-0000000000b1', 'fa104017-0000-0000-0000-000000000001', 100);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa104017-0000-0000-0000-0000000000a1', :C::uuid, :C2::uuid, :P1::uuid, 'fa104017-0000-0000-0000-0000000000b1', 100);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa104017-0000-0000-0000-0000000000a1';
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104017-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_PAGO_SIN_ASIENTO', '[CONC-04o] pago por contraseña sin el mapeo de CxP: NO se confirma');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.contrasenas_pago WHERE id = 'fa104017-0000-0000-0000-0000000000b1'), 'emitida',
  '[CONC-04o] …y la contraseña sigue emitida');
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa104017-0000-0000-0000-000000000001'), 'aprobada/0.00',
  '[CONC-04o] …y su factura sin pagar');
ROLLBACK;
BEGIN;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa104018-0000-0000-0000-000000000001', :C::uuid, :C2::uuid, :P1::uuid, 'FA1-C04-4018', 'CONC-04 contraseña', 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa104018-0000-0000-0000-000000000001';
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa104018-0000-0000-0000-0000000000b1', :C::uuid, :C2::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa104018-0000-0000-0000-0000000000b1', 'fa104018-0000-0000-0000-000000000001', 100);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa104018-0000-0000-0000-0000000000a1', :C::uuid, :C2::uuid, :P1::uuid, 'fa104018-0000-0000-0000-0000000000b1', 100);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa104018-0000-0000-0000-0000000000a1';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa104018-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.contrasenas_pago WHERE id = 'fa104018-0000-0000-0000-0000000000b1'), 'pagada', '[CONC-04o] pago por contraseña con el mapeo completo: la contraseña queda pagada');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa104018-0000-0000-0000-0000000000a1' AND origen_evento = 'orden_pago_pagada' AND estado = 'publicado'), 1,
  '[CONC-04o] …con su asiento publicado');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa104018-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.contrasenas_pago WHERE id = 'fa104018-0000-0000-0000-0000000000b1'), 'emitida', '[CONC-04o] anular ese pago devuelve la contraseña a emitida');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa104018-0000-0000-0000-0000000000a1' AND origen_evento = 'orden_pago_pagada_revertido' AND estado = 'publicado'), 1,
  '[CONC-04o] …con su reverso publicado');
ROLLBACK;

\echo 'CONC-04: todas las comprobaciones pasaron'
