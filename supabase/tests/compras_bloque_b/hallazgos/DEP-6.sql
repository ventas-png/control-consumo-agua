\set ON_ERROR_STOP on
-- ============================================================================
-- DEP-6 · El trigger de alcance revalida TODAS las referencias cuando cambia una sola: una fila histórica
--         con proveedor (o proyecto) ajeno no se puede mover de proyecto (o de proveedor) aunque lo otro no cambie.
--
-- CAUSA RAÍZ
--   compras_tg_alcance_documento (20261027000000) sale temprano solo si NO cambia ninguna de las tres columnas
--   (company_id, project_id, proveedor_id); si cambia UNA, llama a compras_alcance_verificar con las TRES. Una fila
--   que ya traía un proveedor ajeno (dato histórico) falla con COMPRAS_ALCANCE_PROVEEDOR al cambiarle solo el
--   proyecto. Contradice la cabecera de 0000 («solo se evalúan cuando la fila nace o cambia lo que referencia»).
--   Alcance mayor: la purga de un PROYECTO es un UPDATE que cambia SOLO project_id (ON DELETE SET NULL); con una
--   factura / contraseña / orden de pago histórica de proveedor ajeno en el proyecto, la purga falla.
--
-- COMPORTAMIENTO ESPERADO
--   a. Se verifica SOLO la referencia que cambia (proyecto si cambió project_id, proveedor si cambió proveedor_id),
--      en las cuatro tablas con el trigger (ordenes_compra, facturas_proveedor, contrasenas_pago, ordenes_pago).
--   b. LEGÍTIMO / no se relaja nada de lo nuevo: una fila NUEVA inconsistente se sigue rechazando; lo que CAMBIA se
--      sigue verificando (proyecto ajeno, proveedor ajeno); mover la EMPRESA verifica las dos referencias.
--   c. La purga de un proyecto con documentos históricos de proveedor ajeno funciona.
--
-- Ids propios: fa800060-0000-0000-0000-0000000000XX
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set D1  '''d1d1d1d1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set P2  '''e3000000-0000-0000-0000-000000000002'''
\set PD  '''e3000000-0000-0000-0000-0000000000d1'''
\set PD2 '''fa800060-0000-0000-0000-0000000000d2'''

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

-- ── Datos históricos (superusuario, sin disparar triggers: así llegaron antes de los controles) ──
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance, estado, codigo)
VALUES (:PD2::uuid, :D::uuid, 'DEP6 proveedor 2 de D', '8300060-6', 'GT', 'empresa', 'autorizado', 'DEP6-PD2');
SET LOCAL session_replication_role = replica;
-- H1: orden de C con proveedor de D. H2: orden de C con PROYECTO de D (proveedor propio).
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado) VALUES
  ('fa800060-0000-0000-0000-0000000000a1', :C, :C1, :PD, 'x', 'DEP6 H1 histórica (proveedor ajeno)', 'borrador'),
  ('fa800060-0000-0000-0000-0000000000a2', :C, :D1, :P1, 'x', 'DEP6 H2 histórica (proyecto ajeno)', 'borrador');
-- Factura y contraseña de C con proveedor de D.
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado) VALUES
  ('fa800060-0000-0000-0000-0000000000b1', :C, :C1, :PD, 'DEP6-F1', 'DEP6 factura histórica (proveedor ajeno)', 100, 'registrada');
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada, estado) VALUES
  ('fa800060-0000-0000-0000-0000000000d1', :C, :C1, :PD, current_date + 30, 'emitida');
SELECT set_config('conta.allow_system_write', 'on', true);
UPDATE public.contrasenas_pago SET numero = 'T60-' || right(id::text, 8) WHERE id::text LIKE 'fa800060%' AND numero LIKE 'CP-%';
SELECT set_config('conta.allow_system_write', 'off', true);
SET LOCAL session_replication_role = origin;

-- ════════ a · orden de compra: solo se verifica lo que cambia ════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.h8_debe_pasar($$ UPDATE public.ordenes_compra SET concepto = 'editado' WHERE id = 'fa800060-0000-0000-0000-0000000000a1' $$,
  '[DEP-6a] control: editar el concepto de la orden histórica (no toca referencias) pasa');
SELECT public.h8_debe_pasar($$ UPDATE public.ordenes_compra SET proveedor_id = 'e3000000-0000-0000-0000-0000000000d1', concepto = 'editado 2' WHERE id = 'fa800060-0000-0000-0000-0000000000a1' $$,
  '[DEP-6a] control: reenviar el mismo proveedor ajeno sin cambiarlo pasa');
SELECT public.h8_debe_pasar($$ UPDATE public.ordenes_compra SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001' WHERE id = 'fa800060-0000-0000-0000-0000000000a1' $$,
  '[DEP-6a] mover de proyecto (C1 → C2 de la misma empresa) una orden histórica de proveedor ajeno NO revalida el proveedor');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id = 'fa800060-0000-0000-0000-0000000000a1'
                      AND project_id = 'c2c2c2c2-0000-0000-0000-000000000001' AND proveedor_id = 'e3000000-0000-0000-0000-0000000000d1'), 1,
  '[DEP-6a] la orden quedó en C2 y conserva su proveedor histórico (no se inventó ni se borró nada)');

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
-- lo que SÍ cambia se sigue verificando
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET project_id = 'd1d1d1d1-0000-0000-0000-000000000001' WHERE id = 'fa800060-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_ALCANCE_PROYECTO', '[DEP-6b] mover la orden a un proyecto de OTRA empresa se sigue rechazando');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET proveedor_id = 'fa800060-0000-0000-0000-0000000000d2' WHERE id = 'fa800060-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_ALCANCE_PROVEEDOR', '[DEP-6b] cambiar el proveedor a otro proveedor de OTRA empresa se sigue rechazando');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET project_id = 'd1d1d1d1-0000-0000-0000-000000000001', proveedor_id = 'e3000000-0000-0000-0000-000000000002' WHERE id = 'fa800060-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_ALCANCE_PROYECTO', '[DEP-6b] cambiar proyecto ajeno y proveedor propio a la vez: el proyecto ajeno se rechaza');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET project_id = 'c1c1c1c1-0000-0000-0000-000000000001', proveedor_id = 'fa800060-0000-0000-0000-0000000000d2' WHERE id = 'fa800060-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_ALCANCE_PROVEEDOR', '[DEP-6b] cambiar proyecto propio y proveedor ajeno a la vez: el proveedor ajeno se rechaza');
-- y se puede CORREGIR el dato histórico: poner un proveedor propio
SELECT public.h8_debe_pasar($$ UPDATE public.ordenes_compra SET proveedor_id = 'e3000000-0000-0000-0000-000000000002' WHERE id = 'fa800060-0000-0000-0000-0000000000a1' $$,
  '[DEP-6b] LEGÍTIMO: corregir el proveedor histórico por uno de la empresa funciona');
RESET ROLE;
-- la fila histórica con PROYECTO ajeno (el administrador de C no la ve: se opera como sistema, el alcance aplica igual)
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.h8_debe_pasar($$ UPDATE public.ordenes_compra SET proveedor_id = 'e3000000-0000-0000-0000-000000000002' WHERE id = 'fa800060-0000-0000-0000-0000000000a2' $$,
  '[DEP-6c] cambiar el proveedor (propio) de una orden histórica de PROYECTO ajeno NO revalida el proyecto');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET proveedor_id = 'e3000000-0000-0000-0000-0000000000d1' WHERE id = 'fa800060-0000-0000-0000-0000000000a2' $$,
  'COMPRAS_ALCANCE_PROVEEDOR', '[DEP-6c] y cambiar ese proveedor a uno ajeno se rechaza');
SELECT public.h8_debe_pasar($$ UPDATE public.ordenes_compra SET project_id = 'c1c1c1c1-0000-0000-0000-000000000001' WHERE id = 'fa800060-0000-0000-0000-0000000000a2' $$,
  '[DEP-6c] LEGÍTIMO: corregir el proyecto histórico por uno de la empresa funciona');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
-- filas NUEVAS inconsistentes: se siguen rechazando
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-0000000000d1','x','x') $$,
  'COMPRAS_ALCANCE_PROVEEDOR', '[DEP-6d] una orden NUEVA con proveedor ajeno se sigue rechazando');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','d1d1d1d1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','x','x') $$,
  'COMPRAS_ALCANCE_PROYECTO', '[DEP-6d] una orden NUEVA con proyecto ajeno se sigue rechazando');
RESET ROLE;

-- mover la EMPRESA verifica las dos referencias (ambas deben ser de la empresa nueva)
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa800060-0000-0000-0000-0000000000a3', :C, :C1, :P1, 'x', 'DEP6 limpia con proyecto'),
       ('fa800060-0000-0000-0000-0000000000a4', :C, NULL, :P1, 'x', 'DEP6 limpia sin proyecto');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET company_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' WHERE id = 'fa800060-0000-0000-0000-0000000000a3' $$,
  'COMPRAS_ALCANCE_PROYECTO', '[DEP-6e] mover la orden a otra EMPRESA revalida el proyecto');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET company_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' WHERE id = 'fa800060-0000-0000-0000-0000000000a4' $$,
  'COMPRAS_ALCANCE_PROVEEDOR', '[DEP-6e] mover la orden a otra EMPRESA revalida el proveedor (aunque el proveedor no haya cambiado)');

-- ════════ f · factura y contraseña (mismo trigger, otras tablas) ════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.h8_debe_pasar($$ UPDATE public.facturas_proveedor SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001' WHERE id = 'fa800060-0000-0000-0000-0000000000b1' $$,
  '[DEP-6f] mover de proyecto una factura registrada histórica de proveedor ajeno NO revalida el proveedor');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET project_id = 'd1d1d1d1-0000-0000-0000-000000000001' WHERE id = 'fa800060-0000-0000-0000-0000000000b1' $$,
  'COMPRAS_ALCANCE_PROYECTO', '[DEP-6f] y mover esa factura a un proyecto ajeno se rechaza');
SELECT public.h8_debe_pasar($$ UPDATE public.contrasenas_pago SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001' WHERE id = 'fa800060-0000-0000-0000-0000000000d1' $$,
  '[DEP-6g] mover de proyecto una contraseña histórica de proveedor ajeno NO revalida el proveedor');
SELECT public.chk_falla($$ UPDATE public.contrasenas_pago SET project_id = 'd1d1d1d1-0000-0000-0000-000000000001' WHERE id = 'fa800060-0000-0000-0000-0000000000d1' $$,
  'COMPRAS_ALCANCE_PROYECTO', '[DEP-6g] y mover esa contraseña a un proyecto ajeno se rechaza');
RESET ROLE;

-- ════════ h · la purga de un proyecto con documentos históricos de proveedor ajeno ════════
-- La acción referencial de la purga (ON DELETE SET NULL) cambia SOLO project_id: no debe revalidar el proveedor.
SELECT set_config('request.jwt.claim.sub', '', false);
SET LOCAL session_replication_role = replica;   -- sin el tope de proyectos del plan ni la siembra contable: no es lo que se prueba
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa800060-0000-0000-0000-0000000000f1', :C, 'DEP6 · proyecto a purgar');
SET LOCAL session_replication_role = origin;
SET LOCAL session_replication_role = replica;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado) VALUES
  ('fa800060-0000-0000-0000-0000000000b2', :C, 'fa800060-0000-0000-0000-0000000000f1', :PD, 'DEP6-F2', 'DEP6 factura histórica en el proyecto a purgar', 100, 'registrada');
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada, estado) VALUES
  ('fa800060-0000-0000-0000-0000000000d3', :C, 'fa800060-0000-0000-0000-0000000000f1', :PD, current_date + 30, 'emitida');
SELECT set_config('conta.allow_system_write', 'on', true);
UPDATE public.contrasenas_pago SET numero = 'T60-' || right(id::text, 8) WHERE id::text LIKE 'fa800060%' AND numero LIKE 'CP-%';
SELECT set_config('conta.allow_system_write', 'off', true);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, estado) VALUES
  ('fa800060-0000-0000-0000-0000000000c3', :C, 'fa800060-0000-0000-0000-0000000000f1', :PD, 'fa800060-0000-0000-0000-0000000000b2', 100, 'borrador');
SET LOCAL session_replication_role = origin;
SELECT public.h8_debe_pasar($$ DELETE FROM public.projects WHERE id = 'fa800060-0000-0000-0000-0000000000f1' $$,
  '[DEP-6h] eliminar un proyecto con factura, contraseña y orden de pago (borrador) históricas de proveedor ajeno funciona');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa800060-0000-0000-0000-0000000000b2' AND project_id IS NULL)
                + (SELECT count(*) FROM public.contrasenas_pago WHERE id = 'fa800060-0000-0000-0000-0000000000d3' AND project_id IS NULL)
                + (SELECT count(*) FROM public.ordenes_pago WHERE id = 'fa800060-0000-0000-0000-0000000000c3' AND project_id IS NULL), 3,
  '[DEP-6h] los tres documentos siguen ahí, solo sin proyecto');

ROLLBACK;
