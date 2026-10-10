\set ON_ERROR_STOP on
-- ============================================================================
-- DEP-5 · Borrar un proyecto con una orden de pago APROBADA o PAGADA ahora falla por la acción SET NULL
--         (COMPRAS_PAGO_INMUTABLE); la cabecera de 20261027000200 afirma que la cascada de proyecto no se bloquea.
--
-- CAUSA RAÍZ (la misma de RG-3, aquí por el camino del ADMINISTRADOR con sesión de usuario)
--   ordenes_pago_project_id_fkey es ON DELETE SET NULL y su UPDATE dispara el trigger BEFORE INSERT OR UPDATE
--   completo compras_tg_orden_pago_controles (20261027000100), que no distingue una acción referencial: lanza
--   COMPRAS_PAGO_INMUTABLE para aprobada, pagada (y anulada). La política projects_delete deja borrar el proyecto
--   al administrador / propietario de la empresa. El mensaje es engañoso: quien solo borra un proyecto lee
--   «la orden de pago ya no está en borrador y no cambia de … proyecto».
--
-- COMPORTAMIENTO ESPERADO
--   a. El administrador (rol authenticated, JWT con su id) elimina el proyecto con una orden de pago APROBADA
--      por él: el proyecto desaparece y la orden queda con sus SELLOS INTACTOS (aprobada_por, aprobada_at)
--      y con project_id NULL.
--   b. Idem con una orden PAGADA (pagada_at intacto) cuya factura queda PAGADA PARCIAL.
--   c. Idem con una orden en BORRADOR (ya pasaba: se protege de que deje de pasar).
--   d. Una orden ANULADA: ningún trigger de 20261027000000…0700 la bloquea. (Hoy la bloquea, como antes del PR,
--      cxp_proteger_orden —CXP_INMUTABLE, de 20260611—: es preexistente y se reporta aparte, no se prueba como bueno.)
--   e. LEGÍTIMO: el administrador no puede quitar el proyecto a una orden viva de un proyecto vivo.
--
-- Ids propios: fa800050-0000-0000-0000-0000000000XX
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

RESET ROLE;
BEGIN;

CREATE OR REPLACE FUNCTION public.h8_debe_pasar(p_sql text, p_msg text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_n bigint;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '% — FALLÓ y tenía que pasar: %', p_msg, SQLERRM;
  END;
  IF v_n = 0 THEN
    RAISE EXCEPTION '% — pasó pero NO afectó ninguna fila (falso verde: filtro de RLS o id equivocado)', p_msg;
  END IF;
  RAISE NOTICE '✓ %', p_msg;
END;
$$;
-- Pasa si el SQL funciona o si falla por un motivo que NO sea el prohibido.
CREATE OR REPLACE FUNCTION public.h8_no_bloquea(p_sql text, p_prohibido text, p_msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~ p_prohibido THEN
      RAISE EXCEPTION '% — lo bloqueó el control que no debe: %', p_msg, SQLERRM;
    END IF;
    RAISE NOTICE '✓ % (falló por otro motivo, preexistente: %)', p_msg, left(SQLERRM, 60);
    RETURN;
  END;
  RAISE NOTICE '✓ % (pasó)', p_msg;
END;
$$;

-- Cada bloque monta SU proyecto (insertado sin el tope del plan) con el administrador asignado.
-- Se monta como sistema (sin sesión) y las transiciones de la orden las hace el administrador.

-- ════════ a · orden APROBADA por el administrador ════════
SELECT set_config('request.jwt.claim.sub', '', false);
SET LOCAL session_replication_role = replica;   -- sin el tope de proyectos del plan ni la siembra contable: no es lo que se prueba
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa800050-0000-0000-0000-0000000000a1', :C, 'DEP5 · proyecto con orden aprobada');
SET LOCAL session_replication_role = origin;
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (:UA::uuid, 'fa800050-0000-0000-0000-0000000000a1', 'total');
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa800050-0000-0000-0000-0000000000b1', :C, 'fa800050-0000-0000-0000-0000000000a1', :P1, 'DEP5-F1', 'DEP5 factura 1', 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa800050-0000-0000-0000-0000000000b1';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('fa800050-0000-0000-0000-0000000000c1', :C, 'fa800050-0000-0000-0000-0000000000a1', :P1, 'fa800050-0000-0000-0000-0000000000b1', 100);

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa800050-0000-0000-0000-0000000000c1';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE id = 'fa800050-0000-0000-0000-0000000000c1' AND estado = 'aprobada' AND aprobada_por = :UA::uuid AND aprobada_at IS NOT NULL), 1,
  '[DEP-5m] montaje: el administrador aprobó la orden y el servidor selló su firma');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE project_id = 'fa800050-0000-0000-0000-0000000000a1'), 0,
  '[DEP-5m] montaje: ningún asiento del proyecto (la contabilización quedó pendiente, sin cuenta)');

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.h8_debe_pasar($$ DELETE FROM public.projects WHERE id = 'fa800050-0000-0000-0000-0000000000a1' $$,
  '[DEP-5a] el administrador elimina el proyecto con una orden de pago APROBADA (no COMPRAS_PAGO_INMUTABLE)');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.projects WHERE id = 'fa800050-0000-0000-0000-0000000000a1'), 0, '[DEP-5a] el proyecto ya no existe');
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE id = 'fa800050-0000-0000-0000-0000000000c1' AND project_id IS NULL AND estado = 'aprobada'
                      AND monto = 100 AND aprobada_por = :UA::uuid AND aprobada_at IS NOT NULL), 1,
  '[DEP-5a] la orden sigue aprobada, de 100, con la firma de quien la aprobó intacta, solo sin proyecto');

-- ════════ b · orden PAGADA por el administrador (factura pagada parcial) ════════
SELECT set_config('request.jwt.claim.sub', '', false);
SET LOCAL session_replication_role = replica;   -- sin el tope de proyectos del plan ni la siembra contable: no es lo que se prueba
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa800050-0000-0000-0000-0000000000a2', :C, 'DEP5 · proyecto con orden pagada');
SET LOCAL session_replication_role = origin;
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (:UA::uuid, 'fa800050-0000-0000-0000-0000000000a2', 'total');
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa800050-0000-0000-0000-0000000000b2', :C, 'fa800050-0000-0000-0000-0000000000a2', :P1, 'DEP5-F2', 'DEP5 factura 2', 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa800050-0000-0000-0000-0000000000b2';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('fa800050-0000-0000-0000-0000000000c2', :C, 'fa800050-0000-0000-0000-0000000000a2', :P1, 'fa800050-0000-0000-0000-0000000000b2', 40);

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa800050-0000-0000-0000-0000000000c2';
UPDATE public.ordenes_pago SET estado = 'pagada'   WHERE id = 'fa800050-0000-0000-0000-0000000000c2';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago o JOIN public.facturas_proveedor f ON f.id = o.factura_id
                    WHERE o.id = 'fa800050-0000-0000-0000-0000000000c2' AND o.estado = 'pagada' AND o.pagada_at IS NOT NULL
                      AND f.estado = 'pagada_parcial' AND f.monto_pagado = 40), 1,
  '[DEP-5m] montaje: orden pagada por 40 y factura pagada parcial');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE project_id = 'fa800050-0000-0000-0000-0000000000a2'), 0,
  '[DEP-5m] montaje: ningún asiento del proyecto 2');

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.h8_debe_pasar($$ DELETE FROM public.projects WHERE id = 'fa800050-0000-0000-0000-0000000000a2' $$,
  '[DEP-5b] el administrador elimina el proyecto con una orden de pago PAGADA (no COMPRAS_PAGO_INMUTABLE)');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE id = 'fa800050-0000-0000-0000-0000000000c2' AND project_id IS NULL AND estado = 'pagada'
                      AND monto = 40 AND pagada_at IS NOT NULL AND aprobada_por = :UA::uuid), 1,
  '[DEP-5b] la orden sigue pagada por 40 con sus fechas y su firma intactas, solo sin proyecto');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa800050-0000-0000-0000-0000000000b2' AND project_id IS NULL
                      AND estado = 'pagada_parcial' AND monto_pagado = 40), 1,
  '[DEP-5b] la factura sigue pagada parcial por 40, solo sin proyecto');

-- ════════ c · orden en BORRADOR ════════
SELECT set_config('request.jwt.claim.sub', '', false);
SET LOCAL session_replication_role = replica;   -- sin el tope de proyectos del plan ni la siembra contable: no es lo que se prueba
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa800050-0000-0000-0000-0000000000a3', :C, 'DEP5 · proyecto con orden en borrador');
SET LOCAL session_replication_role = origin;
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (:UA::uuid, 'fa800050-0000-0000-0000-0000000000a3', 'total');
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa800050-0000-0000-0000-0000000000b3', :C, 'fa800050-0000-0000-0000-0000000000a3', :P1, 'DEP5-F3', 'DEP5 factura 3', 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa800050-0000-0000-0000-0000000000b3';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('fa800050-0000-0000-0000-0000000000c3', :C, 'fa800050-0000-0000-0000-0000000000a3', :P1, 'fa800050-0000-0000-0000-0000000000b3', 100);
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.h8_debe_pasar($$ DELETE FROM public.projects WHERE id = 'fa800050-0000-0000-0000-0000000000a3' $$,
  '[DEP-5c] el administrador elimina el proyecto con una orden en BORRADOR');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE id = 'fa800050-0000-0000-0000-0000000000c3' AND project_id IS NULL AND estado = 'borrador'), 1,
  '[DEP-5c] la orden en borrador sigue ahí, solo sin proyecto');

-- ════════ d · orden ANULADA: ningún trigger de 0000…0700 la bloquea ════════
SELECT set_config('request.jwt.claim.sub', '', false);
SET LOCAL session_replication_role = replica;   -- sin el tope de proyectos del plan ni la siembra contable: no es lo que se prueba
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa800050-0000-0000-0000-0000000000a4', :C, 'DEP5 · proyecto con orden anulada');
SET LOCAL session_replication_role = origin;
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (:UA::uuid, 'fa800050-0000-0000-0000-0000000000a4', 'total');
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa800050-0000-0000-0000-0000000000b4', :C, 'fa800050-0000-0000-0000-0000000000a4', :P1, 'DEP5-F4', 'DEP5 factura 4', 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa800050-0000-0000-0000-0000000000b4';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('fa800050-0000-0000-0000-0000000000c4', :C, 'fa800050-0000-0000-0000-0000000000a4', :P1, 'fa800050-0000-0000-0000-0000000000b4', 100);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa800050-0000-0000-0000-0000000000c4';
UPDATE public.ordenes_pago SET estado = 'anulada'  WHERE id = 'fa800050-0000-0000-0000-0000000000c4';
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.h8_no_bloquea($$ DELETE FROM public.projects WHERE id = 'fa800050-0000-0000-0000-0000000000a4' $$,
  'COMPRAS_[A-Z_]+:',
  '[DEP-5d] eliminar el proyecto con una orden ANULADA no lo frena ningún control COMPRAS_* del circuito (CXP_INMUTABLE de cxp_proteger_orden es anterior al PR)');
RESET ROLE;

-- ════════ e · LEGÍTIMO: con el proyecto VIVO, ni el administrador le quita el proyecto a una orden viva ════════
SELECT set_config('request.jwt.claim.sub', '', false);
SET LOCAL session_replication_role = replica;   -- sin el tope de proyectos del plan ni la siembra contable: no es lo que se prueba
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa800050-0000-0000-0000-0000000000a5', :C, 'DEP5 · proyecto vivo');
SET LOCAL session_replication_role = origin;
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (:UA::uuid, 'fa800050-0000-0000-0000-0000000000a5', 'total');
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa800050-0000-0000-0000-0000000000b5', :C, 'fa800050-0000-0000-0000-0000000000a5', :P1, 'DEP5-F5', 'DEP5 factura 5', 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa800050-0000-0000-0000-0000000000b5';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('fa800050-0000-0000-0000-0000000000c5', :C, 'fa800050-0000-0000-0000-0000000000a5', :P1, 'fa800050-0000-0000-0000-0000000000b5', 100);
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa800050-0000-0000-0000-0000000000c5';
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET project_id = NULL WHERE id = 'fa800050-0000-0000-0000-0000000000c5' $$,
  'COMPRAS_PAGO_INMUTABLE', '[DEP-5e] el administrador no le quita el proyecto a una orden aprobada de un proyecto vivo');
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET project_id = NULL, aprobada_por = NULL WHERE id = 'fa800050-0000-0000-0000-0000000000c5' $$,
  'COMPRAS_PAGO_INMUTABLE', '[DEP-5e] ni aprovechando para borrar de paso la firma de quien aprobó');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE id = 'fa800050-0000-0000-0000-0000000000c5' AND project_id = 'fa800050-0000-0000-0000-0000000000a5'
                      AND aprobada_por = :UA::uuid), 1, '[DEP-5e] la orden quedó intacta');

ROLLBACK;
