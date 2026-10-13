-- ============================================================================
-- [CONC-01] ORDEN CANÓNICO DE BLOQUEO AL PAGAR Y AL ANULAR UN PAGO HECHO
--
-- Hallazgo: pagar toma factura → folio contable; anular una orden YA pagada tomaba folio →
--   asiento original → factura (trg_conta_ordenes_pago antes de trg_cxp_orden_saldo, y el
--   BEFORE de controles salía sin bloquear). Dos operaciones legítimas sobre la misma factura
--   (o sobre contraseñas que comparten una) se interbloqueaban (40P01), y el que PAGABA podía
--   quedar «pagada» SIN asiento (el EXCEPTION WHEN OTHERS de conta_generar_asiento lo tragó).
-- Causa raíz: no había un orden único de bloqueo; el BEFORE de la orden de pago no tomaba, en
--   anular, las filas que el AFTER pide después del folio.
-- Comportamiento esperado: en las dos transiciones que mueven saldo y libro (aprobada → pagada
--   y pagada → anulada) la transacción ya tiene bloqueadas, ANTES de pedir el folio contable:
--     contraseña de pago  →  facturas (por id)  →  asientos vivos del pago
--   Con ese orden dos operaciones simultáneas se serializan sin ciclo.
-- Esta prueba lo comprueba en UNA sesión y de forma determinista, con una SONDA: un trigger de
--   prueba sobre conta_folios que, en el instante en que alguien pide el folio, anota qué filas
--   (factura, contraseña, asiento original) tiene ya bloqueadas la transacción (xmax = la
--   propia transacción). El entrelazado real de dos sesiones está en CONC-01.conc.sh.
-- También ejercita los casos LEGÍTIMOS: pagar y anular por factura y por contraseña, liberar
--   el saldo y volver a pagar, y el reintento por doble clic.
-- Ids propios: fa1 01NNN-0000-0000-0000-… (grupo pagos_asiento, K=1). Los datos de montaje se
-- confirman (cada escenario de sonda corre en BEGIN … ROLLBACK).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

-- La sonda: solo anota el PRIMER pedido de folio de la transacción.
CREATE OR REPLACE FUNCTION public.fa1_c01_sonda() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_me xid := pg_current_xact_id()::xid;
  v_f  uuid := nullif(current_setting('fa1.c01_f', true), '')::uuid;
  v_k  uuid := nullif(current_setting('fa1.c01_k', true), '')::uuid;
  v_a  uuid := nullif(current_setting('fa1.c01_a', true), '')::uuid;
BEGIN
  IF COALESCE(current_setting('fa1.c01_sonda', true), '') <> '' THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('fa1.c01_sonda',
    'F=' || COALESCE((SELECT (xmax = v_me)::text FROM public.facturas_proveedor WHERE id = v_f), 'n/a')
    || ',K=' || COALESCE((SELECT (xmax = v_me)::text FROM public.contrasenas_pago WHERE id = v_k), 'n/a')
    || ',A=' || COALESCE((SELECT (xmax = v_me)::text FROM public.conta_asientos WHERE id = v_a), 'n/a'), true);
  RETURN NEW;
END;
$$;

-- ── Montaje (confirmado): factura F1 de 1 000 con el pago 1 (600) PAGADO y el pago 2 (400) aprobado;
--    factura F2 de 1 000 con la contraseña K1 (600) pagada y la contraseña K2 (400) aprobada.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa101001-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'FA1-C01-1001', 'CONC-01 directa', 1000),
       ('fa101002-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'FA1-C01-1002', 'CONC-01 contraseñas', 1000);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id IN ('fa101001-0000-0000-0000-000000000001', 'fa101002-0000-0000-0000-000000000001');
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto) VALUES
  ('fa101001-0000-0000-0000-0000000000a1', :C::uuid, :C1::uuid, :P1::uuid, 'fa101001-0000-0000-0000-000000000001', 600),
  ('fa101001-0000-0000-0000-0000000000a2', :C::uuid, :C1::uuid, :P1::uuid, 'fa101001-0000-0000-0000-000000000001', 400);
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada) VALUES
  ('fa101002-0000-0000-0000-0000000000b1', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE),
  ('fa101002-0000-0000-0000-0000000000b2', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto) VALUES
  (:C::uuid, 'fa101002-0000-0000-0000-0000000000b1', 'fa101002-0000-0000-0000-000000000001', 600),
  (:C::uuid, 'fa101002-0000-0000-0000-0000000000b2', 'fa101002-0000-0000-0000-000000000001', 400);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto) VALUES
  ('fa101002-0000-0000-0000-0000000000a1', :C::uuid, :C1::uuid, :P1::uuid, 'fa101002-0000-0000-0000-0000000000b1', 600),
  ('fa101002-0000-0000-0000-0000000000a2', :C::uuid, :C1::uuid, :P1::uuid, 'fa101002-0000-0000-0000-0000000000b2', 400);
UPDATE public.ordenes_pago SET estado = 'aprobada'
 WHERE id IN ('fa101001-0000-0000-0000-0000000000a1', 'fa101001-0000-0000-0000-0000000000a2',
              'fa101002-0000-0000-0000-0000000000a1', 'fa101002-0000-0000-0000-0000000000a2');
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE
 WHERE id IN ('fa101001-0000-0000-0000-0000000000a1', 'fa101002-0000-0000-0000-0000000000a1');
RESET ROLE;
SELECT public.chk_txt((SELECT string_agg(estado || '/' || monto_pagado, ',' ORDER BY numero_factura) FROM public.facturas_proveedor WHERE id IN ('fa101001-0000-0000-0000-000000000001', 'fa101002-0000-0000-0000-000000000001')),
  'pagada_parcial/600.00,pagada_parcial/600.00', '[CONC-01] montaje: dos facturas de 1 000 con 600 pagados cada una');

-- ═══ A · El orden de los triggers: el bloqueo va ANTES de los controles (que ya bloquean la factura) ═══
SELECT public.chk_bool(
  (SELECT array_position(array_agg(tgname::text ORDER BY tgname::text COLLATE "C"), 'trg_compras_orden_pago_bloqueo')
        < array_position(array_agg(tgname::text ORDER BY tgname::text COLLATE "C"), 'trg_compras_orden_pago_controles')
     FROM pg_trigger WHERE tgrelid = 'public.ordenes_pago'::regclass AND NOT tgisinternal AND (tgtype & 2) = 2 AND tgenabled <> 'D'),
  true, '[CONC-01a] existe el trigger BEFORE de bloqueo y dispara antes que los controles de la orden de pago');

-- ═══ B · ANULAR un pago hecho por factura: factura y asiento original ya bloqueados al pedir el folio ═══
BEGIN;
CREATE TRIGGER fa1_c01_sonda BEFORE UPDATE ON public.conta_folios FOR EACH ROW EXECUTE FUNCTION public.fa1_c01_sonda();
SELECT set_config('fa1.c01_sonda', '', true), set_config('fa1.c01_f', 'fa101001-0000-0000-0000-000000000001', true), set_config('fa1.c01_k', '', true),
       set_config('fa1.c01_a', (SELECT id::text FROM public.conta_asientos WHERE origen_id = 'fa101001-0000-0000-0000-0000000000a1' AND origen_evento = 'orden_pago_pagada'), true);
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa101001-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt(current_setting('fa1.c01_sonda', true), 'F=true,K=n/a,A=true',
  '[CONC-01b] anular un pago hecho: la factura y el asiento original ya estaban bloqueados cuando se pidió el folio');
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa101001-0000-0000-0000-000000000001'), 'aprobada/0.00',
  '[CONC-01b] …y la anulación sigue funcionando: la factura recupera su saldo');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa101001-0000-0000-0000-0000000000a1' AND origen_evento = 'orden_pago_pagada_revertido' AND estado = 'publicado'), 1,
  '[CONC-01b] …con su asiento de reverso');
-- Libera el saldo: el pago se puede volver a hacer, una sola vez.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('fa101001-0000-0000-0000-0000000000a3', :C::uuid, :C1::uuid, :P1::uuid, 'fa101001-0000-0000-0000-000000000001', 600);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa101001-0000-0000-0000-0000000000a3';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa101001-0000-0000-0000-0000000000a3';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa101001-0000-0000-0000-0000000000a3';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa101001-0000-0000-0000-0000000000a3' AND origen_evento = 'orden_pago_pagada' AND estado = 'publicado'), 1,
  '[CONC-01b] …y el saldo liberado se paga de nuevo con UN asiento (el doble clic no duplica)');
ROLLBACK;

-- ═══ C · PAGAR por factura: la factura ya bloqueada al pedir el folio (no cambia: ya era así) ═══
BEGIN;
CREATE TRIGGER fa1_c01_sonda BEFORE UPDATE ON public.conta_folios FOR EACH ROW EXECUTE FUNCTION public.fa1_c01_sonda();
SELECT set_config('fa1.c01_sonda', '', true), set_config('fa1.c01_f', 'fa101001-0000-0000-0000-000000000001', true), set_config('fa1.c01_k', '', true), set_config('fa1.c01_a', '', true);
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa101001-0000-0000-0000-0000000000a2';
RESET ROLE;
SELECT public.chk_txt(current_setting('fa1.c01_sonda', true), 'F=true,K=n/a,A=n/a',
  '[CONC-01c] pagar por factura: la factura ya estaba bloqueada cuando se pidió el folio');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa101001-0000-0000-0000-0000000000a2' AND origen_evento = 'orden_pago_pagada' AND estado = 'publicado'), 1,
  '[CONC-01c] …y el pago deja su asiento publicado');
ROLLBACK;

-- ═══ D · ANULAR un pago hecho por CONTRASEÑA: contraseña, factura y asiento ya bloqueados al pedir el folio ═══
BEGIN;
CREATE TRIGGER fa1_c01_sonda BEFORE UPDATE ON public.conta_folios FOR EACH ROW EXECUTE FUNCTION public.fa1_c01_sonda();
SELECT set_config('fa1.c01_sonda', '', true), set_config('fa1.c01_f', 'fa101002-0000-0000-0000-000000000001', true), set_config('fa1.c01_k', 'fa101002-0000-0000-0000-0000000000b1', true),
       set_config('fa1.c01_a', (SELECT id::text FROM public.conta_asientos WHERE origen_id = 'fa101002-0000-0000-0000-0000000000a1' AND origen_evento = 'orden_pago_pagada'), true);
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa101002-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt(current_setting('fa1.c01_sonda', true), 'F=true,K=true,A=true',
  '[CONC-01d] anular un pago de contraseña: contraseña, factura y asiento original ya estaban bloqueados cuando se pidió el folio');
SELECT public.chk_txt((SELECT estado FROM public.contrasenas_pago WHERE id = 'fa101002-0000-0000-0000-0000000000b1'), 'emitida',
  '[CONC-01d] …y la anulación sigue funcionando: la contraseña vuelve a emitida');
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa101002-0000-0000-0000-000000000001'), 'aprobada/0.00',
  '[CONC-01d] …y la factura recupera su saldo');
ROLLBACK;

-- ═══ E · PAGAR por CONTRASEÑA: la contraseña (antes de las facturas) y las facturas, bloqueadas al pedir el folio ═══
BEGIN;
CREATE TRIGGER fa1_c01_sonda BEFORE UPDATE ON public.conta_folios FOR EACH ROW EXECUTE FUNCTION public.fa1_c01_sonda();
SELECT set_config('fa1.c01_sonda', '', true), set_config('fa1.c01_f', 'fa101002-0000-0000-0000-000000000001', true), set_config('fa1.c01_k', 'fa101002-0000-0000-0000-0000000000b2', true), set_config('fa1.c01_a', '', true);
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa101002-0000-0000-0000-0000000000a2';
RESET ROLE;
SELECT public.chk_txt(current_setting('fa1.c01_sonda', true), 'F=true,K=true,A=n/a',
  '[CONC-01e] pagar por contraseña: la contraseña y la factura ya estaban bloqueadas cuando se pidió el folio (antes la contraseña se tocaba DESPUÉS del folio)');
SELECT public.chk_txt((SELECT estado FROM public.contrasenas_pago WHERE id = 'fa101002-0000-0000-0000-0000000000b2'), 'pagada',
  '[CONC-01e] …y el pago sigue funcionando: la contraseña queda pagada');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa101002-0000-0000-0000-0000000000a2' AND origen_evento = 'orden_pago_pagada' AND estado = 'publicado'), 1,
  '[CONC-01e] …con su asiento publicado');
ROLLBACK;

-- ═══ F · Un proceso SIN sesión de usuario (service_role) sigue pudiendo pagar y anular ═══
BEGIN;
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa101001-0000-0000-0000-0000000000a2';
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa101001-0000-0000-0000-0000000000a1';
SELECT public.chk_txt((SELECT string_agg(estado, ',' ORDER BY id) FROM public.ordenes_pago WHERE id IN ('fa101001-0000-0000-0000-0000000000a1', 'fa101001-0000-0000-0000-0000000000a2')),
  'anulada,pagada', '[CONC-01f] sin sesión de usuario (proceso de sistema): se paga una orden y se anula otra');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id IN ('fa101001-0000-0000-0000-0000000000a1', 'fa101001-0000-0000-0000-0000000000a2')
                    AND ((origen_evento = 'orden_pago_pagada' AND estado = 'publicado' AND anulado_por_id IS NULL AND origen_id = 'fa101001-0000-0000-0000-0000000000a2')
                      OR (origen_evento = 'orden_pago_pagada_revertido' AND estado = 'publicado' AND origen_id = 'fa101001-0000-0000-0000-0000000000a1'))), 2,
  '[CONC-01f] …cada una con su asiento (el pago) o su reverso (la anulación)');
ROLLBACK;

\echo 'CONC-01: todas las comprobaciones pasaron'
