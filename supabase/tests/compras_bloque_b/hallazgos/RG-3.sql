\set ON_ERROR_STOP on
-- ============================================================================
-- RG-3 · Borrar un proyecto con una orden de pago APROBADA o PAGADA falla con
--        COMPRAS_PAGO_INMUTABLE (la llave ordenes_pago.project_id es ON DELETE SET NULL).
--
-- CAUSA RAÍZ
--   Al eliminar un proyecto, el motor corre `UPDATE ONLY ordenes_pago SET project_id = NULL` sobre cada
--   orden del proyecto. compras_tg_orden_pago_controles (20261027000100) es BEFORE INSERT OR UPDATE completo
--   y, fuera de borrador, rechaza cualquier cambio de proyecto: no distingue la acción referencial de una
--   edición. La cabecera de 20261027000200 afirma que la purga de proyecto «no se bloquea», pero solo se
--   probó con ordenes_compra (ON DELETE CASCADE). Antes del PR, el DELETE funcionaba.
--   (En el orden de disparo por omisión, la orden en BORRADOR con factura sobrevive de casualidad: la llave
--   de facturas_proveedor se dispara antes y deja la factura con proyecto NULL; con el orden contrario la
--   revalidación de la factura también la rechaza. Se prueba con las dos.)
--
-- COMPORTAMIENTO ESPERADO
--   a. Eliminar el proyecto (sin sesión de usuario: soporte / proceso) funciona con la orden APROBADA y con la
--      PAGADA, y la orden queda ahí —mismo estado, monto, factura, contraseña— con project_id en NULL: la
--      purga suelta el proyecto, no toca el pago ni la factura.
--   b. Lo mismo cuando la orden liquida una CONTRASEÑA.
--   c. LEGÍTIMO: el candado de inmutabilidad sigue intacto con el proyecto VIVO: nadie mueve una orden no
--      borrador de proyecto ni le pone project_id NULL; tampoco cambia su monto.
--   d. El resultado no depende del orden en que el motor dispara las llaves (borrador y pagada con el orden
--      de facturas_proveedor / ordenes_pago invertido).
--   e. La purga de una EMPRESA con factura, contraseña y orden de pago pagadas sigue funcionando.
--
-- Ids propios: fa800030-0000-0000-0000-0000000000XX
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

RESET ROLE;
BEGIN;

-- ── Ayuda local (se va con el ROLLBACK): el SQL DEBE PASAR; si falla, el mensaje lleva la etiqueta ──
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

-- ════════ Preparación (sin sesión de usuario: el camino de soporte y de los procesos) ════════
-- Los proyectos se insertan sin disparar triggers de usuario (tope de proyectos del plan, siembra contable): lo que se prueba es la purga.
SELECT set_config('request.jwt.claim.sub', '', false);

-- ════════ a · la orden APROBADA / PAGADA no frena la purga del proyecto ════════
-- Proyecto 1: factura aprobada + orden de pago APROBADA.
SET LOCAL session_replication_role = replica;   -- sin el tope de proyectos del plan ni la siembra contable: no es lo que se prueba
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa800030-0000-0000-0000-0000000000a1', :C, 'RG3 · proyecto con orden aprobada');
SET LOCAL session_replication_role = origin;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa800030-0000-0000-0000-0000000000b1', :C, 'fa800030-0000-0000-0000-0000000000a1', :P1, 'RG3-F1', 'RG3 factura 1', 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa800030-0000-0000-0000-0000000000b1';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('fa800030-0000-0000-0000-0000000000c1', :C, 'fa800030-0000-0000-0000-0000000000a1', :P1, 'fa800030-0000-0000-0000-0000000000b1', 100);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa800030-0000-0000-0000-0000000000c1';
-- Montaje: el estado de partida es el que se dice y NO hay asientos publicados (un asiento publicado bloquea
-- la purga por otro motivo —CONTA_INMUTABLE—, anterior al PR y ajeno a este hallazgo).
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa800030-0000-0000-0000-0000000000c1'), 'aprobada', '[RG-3m] montaje: la orden del proyecto 1 está aprobada');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE project_id = 'fa800030-0000-0000-0000-0000000000a1'),
  0, '[RG-3m] montaje: ningún asiento del proyecto 1 (la contabilización quedó pendiente, sin cuenta)');

SELECT public.h8_debe_pasar($$ DELETE FROM public.projects WHERE id = 'fa800030-0000-0000-0000-0000000000a1' $$,
  '[RG-3a] eliminar el proyecto con una orden de pago APROBADA funciona (no COMPRAS_PAGO_INMUTABLE)');
SELECT public.chk((SELECT count(*) FROM public.projects WHERE id = 'fa800030-0000-0000-0000-0000000000a1'), 0, '[RG-3a] el proyecto ya no existe');
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE id = 'fa800030-0000-0000-0000-0000000000c1' AND project_id IS NULL
                      AND estado = 'aprobada' AND monto = 100 AND factura_id = 'fa800030-0000-0000-0000-0000000000b1'), 1,
  '[RG-3a] la orden sigue ahí: aprobada, de 100, de su factura, solo sin proyecto');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa800030-0000-0000-0000-0000000000b1' AND project_id IS NULL
                      AND estado = 'aprobada' AND monto_pagado = 0), 1,
  '[RG-3a] la factura sigue aprobada y sin pagos, solo sin proyecto');

-- Proyecto 2: factura aprobada + orden de pago PAGADA.
SET LOCAL session_replication_role = replica;   -- sin el tope de proyectos del plan ni la siembra contable: no es lo que se prueba
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa800030-0000-0000-0000-0000000000a2', :C, 'RG3 · proyecto con orden pagada');
SET LOCAL session_replication_role = origin;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa800030-0000-0000-0000-0000000000b2', :C, 'fa800030-0000-0000-0000-0000000000a2', :P1, 'RG3-F2', 'RG3 factura 2', 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa800030-0000-0000-0000-0000000000b2';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('fa800030-0000-0000-0000-0000000000c2', :C, 'fa800030-0000-0000-0000-0000000000a2', :P1, 'fa800030-0000-0000-0000-0000000000b2', 100);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa800030-0000-0000-0000-0000000000c2';
UPDATE public.ordenes_pago SET estado = 'pagada'   WHERE id = 'fa800030-0000-0000-0000-0000000000c2';
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa800030-0000-0000-0000-0000000000c2'), 'pagada', '[RG-3m] montaje: la orden del proyecto 2 está pagada');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE project_id = 'fa800030-0000-0000-0000-0000000000a2'),
  0, '[RG-3m] montaje: ningún asiento del proyecto 2');

SELECT public.h8_debe_pasar($$ DELETE FROM public.projects WHERE id = 'fa800030-0000-0000-0000-0000000000a2' $$,
  '[RG-3a2] eliminar el proyecto con una orden de pago PAGADA funciona (no COMPRAS_PAGO_INMUTABLE)');
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE id = 'fa800030-0000-0000-0000-0000000000c2' AND project_id IS NULL
                      AND estado = 'pagada' AND monto = 100), 1,
  '[RG-3a2] la orden pagada sigue ahí, pagada y de 100, solo sin proyecto');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa800030-0000-0000-0000-0000000000b2' AND project_id IS NULL
                      AND estado = 'pagada' AND monto_pagado = 100), 1,
  '[RG-3a2] la factura sigue pagada por 100 (el pago no se deshizo), solo sin proyecto');

-- ════════ b · la orden que liquida una contraseña ════════
-- Proyecto 3: factura aprobada + contraseña emitida con su partida + orden de pago PAGADA contra la contraseña.
SET LOCAL session_replication_role = replica;   -- sin el tope de proyectos del plan ni la siembra contable: no es lo que se prueba
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa800030-0000-0000-0000-0000000000a3', :C, 'RG3 · proyecto con contraseña pagada');
SET LOCAL session_replication_role = origin;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa800030-0000-0000-0000-0000000000b3', :C, 'fa800030-0000-0000-0000-0000000000a3', :P1, 'RG3-F3', 'RG3 factura 3', 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa800030-0000-0000-0000-0000000000b3';
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa800030-0000-0000-0000-0000000000d3', :C, 'fa800030-0000-0000-0000-0000000000a3', :P1, current_date + 30);
SELECT set_config('conta.allow_system_write', 'on', true);
UPDATE public.contrasenas_pago SET numero = 'T30-' || right(id::text, 8) WHERE id::text LIKE 'fa800030%' AND numero LIKE 'CP-%';
SELECT set_config('conta.allow_system_write', 'off', true);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C, 'fa800030-0000-0000-0000-0000000000d3', 'fa800030-0000-0000-0000-0000000000b3', 100);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa800030-0000-0000-0000-0000000000c3', :C, 'fa800030-0000-0000-0000-0000000000a3', :P1, 'fa800030-0000-0000-0000-0000000000d3', 100);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa800030-0000-0000-0000-0000000000c3';
UPDATE public.ordenes_pago SET estado = 'pagada'   WHERE id = 'fa800030-0000-0000-0000-0000000000c3';
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa800030-0000-0000-0000-0000000000c3'), 'pagada', '[RG-3m] montaje: la orden del proyecto 3 (contraseña) está pagada');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE project_id = 'fa800030-0000-0000-0000-0000000000a3'),
  0, '[RG-3m] montaje: ningún asiento del proyecto 3');

SELECT public.h8_debe_pasar($$ DELETE FROM public.projects WHERE id = 'fa800030-0000-0000-0000-0000000000a3' $$,
  '[RG-3b] eliminar el proyecto con una orden de pago PAGADA contra una contraseña funciona');
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE id = 'fa800030-0000-0000-0000-0000000000c3' AND project_id IS NULL
                      AND estado = 'pagada' AND contrasena_pago_id = 'fa800030-0000-0000-0000-0000000000d3' AND monto = 100), 1,
  '[RG-3b] la orden sigue ahí ligada a su contraseña, solo sin proyecto');
SELECT public.chk((SELECT count(*) FROM public.contrasenas_pago WHERE id = 'fa800030-0000-0000-0000-0000000000d3' AND project_id IS NULL AND estado = 'pagada'), 1,
  '[RG-3b] la contraseña sigue pagada, solo sin proyecto');

-- ════════ c · LEGÍTIMO: con el proyecto VIVO el candado de inmutabilidad sigue puesto ════════
-- Proyecto 5: queda VIVO (para probar que el candado sigue puesto), asignado al administrador.
SET LOCAL session_replication_role = replica;   -- sin el tope de proyectos del plan ni la siembra contable: no es lo que se prueba
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa800030-0000-0000-0000-0000000000a5', :C, 'RG3 · proyecto vivo');
SET LOCAL session_replication_role = origin;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa800030-0000-0000-0000-0000000000b5', :C, 'fa800030-0000-0000-0000-0000000000a5', :P1, 'RG3-F5', 'RG3 factura 5', 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa800030-0000-0000-0000-0000000000b5';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('fa800030-0000-0000-0000-0000000000c5', :C, 'fa800030-0000-0000-0000-0000000000a5', :P1, 'fa800030-0000-0000-0000-0000000000b5', 100);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa800030-0000-0000-0000-0000000000c5';
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
VALUES ('c0c0c0c0-0000-0000-0000-00000000000a', 'fa800030-0000-0000-0000-0000000000a5', 'total');
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET project_id = NULL WHERE id = 'fa800030-0000-0000-0000-0000000000c5' $$,
  'COMPRAS_PAGO_INMUTABLE', '[RG-3c] con el proyecto vivo, a una orden aprobada no se le quita el proyecto (sin sesión)');
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001' WHERE id = 'fa800030-0000-0000-0000-0000000000c5' $$,
  'COMPRAS_PAGO_INMUTABLE', '[RG-3c] una orden aprobada no se muda a otro proyecto de la empresa (sin sesión)');
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET monto = 50 WHERE id = 'fa800030-0000-0000-0000-0000000000c5' $$,
  'COMPRAS_PAGO_INMUTABLE', '[RG-3c] una orden aprobada no cambia de monto');
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET project_id = NULL, monto = 50 WHERE id = 'fa800030-0000-0000-0000-0000000000c5' $$,
  'COMPRAS_PAGO_INMUTABLE', '[RG-3c] quitar el proyecto Y cambiar el monto en la misma sentencia tampoco pasa');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET project_id = NULL WHERE id = 'fa800030-0000-0000-0000-0000000000c5' $$,
  'COMPRAS_PAGO_INMUTABLE', '[RG-3c] ni el administrador le quita el proyecto a una orden aprobada de un proyecto vivo');
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001' WHERE id = 'fa800030-0000-0000-0000-0000000000c5' $$,
  'COMPRAS_PAGO_INMUTABLE', '[RG-3c] ni el administrador la muda de proyecto');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
-- y el flujo normal de esa misma orden sigue: pagarla con el proyecto vivo funciona y respeta el saldo
SELECT public.h8_debe_pasar($$ UPDATE public.ordenes_pago SET estado = 'pagada' WHERE id = 'fa800030-0000-0000-0000-0000000000c5' $$,
  '[RG-3c] LEGÍTIMO: la orden aprobada de un proyecto vivo se sigue pagando');
SELECT public.chk_num((SELECT monto_pagado FROM public.facturas_proveedor WHERE id = 'fa800030-0000-0000-0000-0000000000b5'), 100,
  '[RG-3c] LEGÍTIMO: y la factura queda pagada por 100');

ROLLBACK;

-- ════════ d · el resultado no depende del orden en que el motor dispara las llaves ════════
-- Se invierte, DENTRO de una transacción que se deshace, el orden de las dos llaves hacia projects: la de
-- ordenes_pago se recrea y pasa a dispararse ANTES de la de facturas_proveedor (los disparadores de
-- integridad referencial se ordenan por NOMBRE, RI_ConstraintTrigger_a_<oid>, comparado como texto).
-- Así la orden se pone en NULL con la factura todavía en su proyecto, que es lo que en el orden por
-- omisión solo la casualidad evita para el borrador.
BEGIN;
DO $$
DECLARE
  v_def_op text := pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'ordenes_pago_project_id_fkey' AND conrelid = 'public.ordenes_pago'::regclass));
  v_def_fp text := pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'facturas_proveedor_project_id_fkey' AND conrelid = 'public.facturas_proveedor'::regclass));
  v_ok     boolean := false;
  v_i      integer := 0;
BEGIN
  WHILE NOT v_ok AND v_i < 8 LOOP
    ALTER TABLE public.ordenes_pago DROP CONSTRAINT ordenes_pago_project_id_fkey;
    EXECUTE 'ALTER TABLE public.ordenes_pago ADD CONSTRAINT ordenes_pago_project_id_fkey ' || v_def_op;
    ALTER TABLE public.facturas_proveedor DROP CONSTRAINT facturas_proveedor_project_id_fkey;
    EXECUTE 'ALTER TABLE public.facturas_proveedor ADD CONSTRAINT facturas_proveedor_project_id_fkey ' || v_def_fp;
    SELECT (SELECT t.tgname FROM pg_trigger t JOIN pg_constraint c ON c.oid = t.tgconstraint JOIN pg_proc p ON p.oid = t.tgfoid
             WHERE t.tgrelid = 'public.projects'::regclass AND c.conname = 'ordenes_pago_project_id_fkey' AND p.proname = 'RI_FKey_setnull_del')
         < (SELECT t.tgname FROM pg_trigger t JOIN pg_constraint c ON c.oid = t.tgconstraint JOIN pg_proc p ON p.oid = t.tgfoid
             WHERE t.tgrelid = 'public.projects'::regclass AND c.conname = 'facturas_proveedor_project_id_fkey' AND p.proname = 'RI_FKey_setnull_del')
      INTO v_ok;
    v_i := v_i + 1;
  END LOOP;
END $$;

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

SELECT public.chk_bool(
  (SELECT t.tgname FROM pg_trigger t JOIN pg_constraint c ON c.oid = t.tgconstraint JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.projects'::regclass AND c.conname = 'ordenes_pago_project_id_fkey' AND p.proname = 'RI_FKey_setnull_del')
  <
  (SELECT t.tgname FROM pg_trigger t JOIN pg_constraint c ON c.oid = t.tgconstraint JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.projects'::regclass AND c.conname = 'facturas_proveedor_project_id_fkey' AND p.proname = 'RI_FKey_setnull_del'),
  true, '[RG-3d] montaje: la llave de ordenes_pago se dispara antes que la de facturas_proveedor');

SELECT set_config('request.jwt.claim.sub', '', false);
-- Proyecto 4: orden en BORRADOR contra factura aprobada.
SET LOCAL session_replication_role = replica;   -- sin el tope de proyectos del plan ni la siembra contable: no es lo que se prueba
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa800030-0000-0000-0000-0000000000a4', :C, 'RG3 · proyecto con orden en borrador');
SET LOCAL session_replication_role = origin;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa800030-0000-0000-0000-0000000000b4', :C, 'fa800030-0000-0000-0000-0000000000a4', :P1, 'RG3-F4', 'RG3 factura 4', 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa800030-0000-0000-0000-0000000000b4';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('fa800030-0000-0000-0000-0000000000c4', :C, 'fa800030-0000-0000-0000-0000000000a4', :P1, 'fa800030-0000-0000-0000-0000000000b4', 100);
-- Proyecto 6: orden PAGADA.
SET LOCAL session_replication_role = replica;   -- sin el tope de proyectos del plan ni la siembra contable: no es lo que se prueba
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa800030-0000-0000-0000-0000000000a6', :C, 'RG3 · proyecto con orden pagada (orden invertido)');
SET LOCAL session_replication_role = origin;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa800030-0000-0000-0000-0000000000b6', :C, 'fa800030-0000-0000-0000-0000000000a6', :P1, 'RG3-F6', 'RG3 factura 6', 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa800030-0000-0000-0000-0000000000b6';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('fa800030-0000-0000-0000-0000000000c6', :C, 'fa800030-0000-0000-0000-0000000000a6', :P1, 'fa800030-0000-0000-0000-0000000000b6', 100);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa800030-0000-0000-0000-0000000000c6';
UPDATE public.ordenes_pago SET estado = 'pagada'   WHERE id = 'fa800030-0000-0000-0000-0000000000c6';

-- Proyecto 7: orden en BORRADOR contra una CONTRASEÑA emitida (con su partida).
SET LOCAL session_replication_role = replica;   -- sin el tope de proyectos del plan ni la siembra contable: no es lo que se prueba
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa800030-0000-0000-0000-0000000000a7', :C, 'RG3 · proyecto con orden en borrador contra contraseña');
SET LOCAL session_replication_role = origin;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa800030-0000-0000-0000-0000000000b7', :C, 'fa800030-0000-0000-0000-0000000000a7', :P1, 'RG3-F7', 'RG3 factura 7', 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa800030-0000-0000-0000-0000000000b7';
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa800030-0000-0000-0000-0000000000d7', :C, 'fa800030-0000-0000-0000-0000000000a7', :P1, current_date + 30);
SELECT set_config('conta.allow_system_write', 'on', true);
UPDATE public.contrasenas_pago SET numero = 'T30-' || right(id::text, 8) WHERE id::text LIKE 'fa800030%' AND numero LIKE 'CP-%';
SELECT set_config('conta.allow_system_write', 'off', true);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C, 'fa800030-0000-0000-0000-0000000000d7', 'fa800030-0000-0000-0000-0000000000b7', 100);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa800030-0000-0000-0000-0000000000c7', :C, 'fa800030-0000-0000-0000-0000000000a7', :P1, 'fa800030-0000-0000-0000-0000000000d7', 100);

SELECT public.h8_debe_pasar($$ DELETE FROM public.projects WHERE id = 'fa800030-0000-0000-0000-0000000000a7' $$,
  '[RG-3d] eliminar el proyecto con una orden en BORRADOR contra una contraseña funciona también con las llaves en el orden contrario (ningún trigger de orden de pago revalida la contabilidad de la contraseña)');
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE id = 'fa800030-0000-0000-0000-0000000000c7' AND project_id IS NULL AND estado = 'borrador' AND monto = 100), 1,
  '[RG-3d] la orden en borrador contra la contraseña sigue ahí, solo sin proyecto');
SELECT public.h8_debe_pasar($$ DELETE FROM public.projects WHERE id = 'fa800030-0000-0000-0000-0000000000a4' $$,
  '[RG-3d] eliminar el proyecto con una orden en BORRADOR funciona también con las llaves en el orden contrario');
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE id = 'fa800030-0000-0000-0000-0000000000c4' AND project_id IS NULL AND estado = 'borrador' AND monto = 100), 1,
  '[RG-3d] la orden en borrador sigue ahí, solo sin proyecto');
SELECT public.h8_debe_pasar($$ DELETE FROM public.projects WHERE id = 'fa800030-0000-0000-0000-0000000000a6' $$,
  '[RG-3d] eliminar el proyecto con una orden PAGADA funciona también con las llaves en el orden contrario');
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE id = 'fa800030-0000-0000-0000-0000000000c6' AND project_id IS NULL AND estado = 'pagada' AND monto = 100), 1,
  '[RG-3d] la orden pagada sigue ahí, solo sin proyecto');
ROLLBACK;

-- ════════ e · la purga de una EMPRESA con factura, contraseña y orden de pago pagadas ════════
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
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.companies (id, nombre, default_currency) VALUES ('fa800030-0000-0000-0000-0000000000e1', 'RG3 empresa efímera', 'gtq');
SET LOCAL session_replication_role = replica;   -- sin el tope de proyectos del plan ni la siembra contable: no es lo que se prueba
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa800030-0000-0000-0000-0000000000e2', 'fa800030-0000-0000-0000-0000000000e1', 'RG3 proyecto de la empresa efímera');
SET LOCAL session_replication_role = origin;
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance, estado, codigo)
VALUES ('fa800030-0000-0000-0000-0000000000e3', 'fa800030-0000-0000-0000-0000000000e1', 'RG3 proveedor efímero', '8300030-3', 'GT', 'empresa', 'autorizado', 'RG3-P');
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa800030-0000-0000-0000-0000000000e4', 'fa800030-0000-0000-0000-0000000000e1', 'fa800030-0000-0000-0000-0000000000e2', 'fa800030-0000-0000-0000-0000000000e3', 'RG3-FE', 'RG3 factura efímera', 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa800030-0000-0000-0000-0000000000e4';
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa800030-0000-0000-0000-0000000000e6', 'fa800030-0000-0000-0000-0000000000e1', 'fa800030-0000-0000-0000-0000000000e2', 'fa800030-0000-0000-0000-0000000000e3', current_date + 30);
SELECT set_config('conta.allow_system_write', 'on', true);
UPDATE public.contrasenas_pago SET numero = 'T30-' || right(id::text, 8) WHERE id::text LIKE 'fa800030%' AND numero LIKE 'CP-%';
SELECT set_config('conta.allow_system_write', 'off', true);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES ('fa800030-0000-0000-0000-0000000000e1', 'fa800030-0000-0000-0000-0000000000e6', 'fa800030-0000-0000-0000-0000000000e4', 100);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa800030-0000-0000-0000-0000000000e5', 'fa800030-0000-0000-0000-0000000000e1', 'fa800030-0000-0000-0000-0000000000e2', 'fa800030-0000-0000-0000-0000000000e3', 'fa800030-0000-0000-0000-0000000000e6', 100);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa800030-0000-0000-0000-0000000000e5';
UPDATE public.ordenes_pago SET estado = 'pagada'   WHERE id = 'fa800030-0000-0000-0000-0000000000e5';
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa800030-0000-0000-0000-0000000000e5'), 'pagada', '[RG-3m] montaje: la orden de la empresa efímera está pagada');
SELECT public.h8_debe_pasar($$ DELETE FROM public.companies WHERE id = 'fa800030-0000-0000-0000-0000000000e1' $$,
  '[RG-3e] eliminar una empresa con factura, contraseña y orden de pago pagadas funciona');
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago WHERE company_id = 'fa800030-0000-0000-0000-0000000000e1')
                + (SELECT count(*) FROM public.facturas_proveedor WHERE company_id = 'fa800030-0000-0000-0000-0000000000e1')
                + (SELECT count(*) FROM public.contrasenas_pago WHERE company_id = 'fa800030-0000-0000-0000-0000000000e1')
                + (SELECT count(*) FROM public.projects WHERE company_id = 'fa800030-0000-0000-0000-0000000000e1'), 0,
  '[RG-3e] no queda nada de la empresa eliminada');
ROLLBACK;
