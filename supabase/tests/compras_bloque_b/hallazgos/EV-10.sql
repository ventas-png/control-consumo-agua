\set ON_ERROR_STOP on
-- ============================================================================
-- EV-10 · Referencias entre empresas que seguían abiertas fuera del circuito protegido:
--         activos_fijos.proveedor_id, gastos_condominio.proveedor_id y ordenes_compra.obra_id.
--
-- CAUSA RAÍZ
--   Las políticas de INSERT solo comprueban `company_id = mi empresa` en la FILA NUEVA; nada
--   comprobaba que el proveedor / la obra / el proyecto REFERENCIADOS fueran de esa empresa.
--   Un activo, un gasto (que contabiliza con trg_conta_gastos) y una orden de la empresa C
--   quedaban apuntando al proveedor, al proyecto o a la obra de la empresa D.
--
-- COMPORTAMIENTO ESPERADO
--   a. activos_fijos: el proveedor y el proyecto son de la empresa del activo.
--   b. gastos_condominio: el proveedor y el proyecto son de la empresa del gasto.
--   c. ordenes_compra.obra_id: la obra es de la empresa de la orden y, si la orden es de un
--      proyecto, de ese proyecto (como ya exige el trigger del contrato).
--   d. Solo se verifica la referencia que NACE o CAMBIA: una fila histórica inconsistente no
--      queda bloqueada para sus ediciones ajenas (DEP-6), y quitar o corregir la referencia mala
--      siempre se puede.
--   e. Vale para TODOS los caminos, también el de sistema (una referencia entre empresas no
--      tiene un uso legítimo).
--   f. LEGÍTIMO: lo propio sigue funcionando (activo/gasto con proveedor y proyecto de la
--      empresa, activo sin proveedor, orden con la obra de su proyecto, orden de empresa sin
--      proyecto con una obra de la empresa).
--
-- Ids propios: fa710000-0000-0000-0000-0000000000XX
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set D1  '''d1d1d1d1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set PD  '''e3000000-0000-0000-0000-0000000000d1'''
\set OBRA_D  '''fa710000-0000-0000-0000-0000000000d1'''
\set OBRA_C1 '''fa710000-0000-0000-0000-0000000000c1'''
\set OBRA_C2 '''fa710000-0000-0000-0000-0000000000c2'''

CREATE OR REPLACE FUNCTION public.h10_falla(p_sql text, p_estado text, p_patron text, p_msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_estado AND SQLERRM ~ p_patron THEN
      RAISE NOTICE '✓ % (%)', p_msg, left(SQLERRM, 80);
      RETURN;
    END IF;
    RAISE EXCEPTION '% — falló con % «%», y se esperaba % «%»', p_msg, SQLSTATE, left(SQLERRM, 240), p_estado, p_patron;
  END;
  RAISE EXCEPTION '% — NO falló, y tenía que fallar', p_msg;
END;
$$;

-- ── Datos (superusuario, sin disparar triggers) ─────────────────────────────
SET session_replication_role = replica;
INSERT INTO proveedores (id,company_id,nombre,nit,pais,alcance,estado) VALUES
  ('fa710000-0000-0000-0000-0000000000d2', :D, 'EV10 otro proveedor de D', '7100001-1', 'GT', 'empresa', 'autorizado');
INSERT INTO obras_mejoras (id,company_id,project_id,titulo) VALUES
  ('fa710000-0000-0000-0000-0000000000d1', :D, :D1, 'EV10 obra de D'),
  ('fa710000-0000-0000-0000-0000000000c1', :C, :C1, 'EV10 obra de C1'),
  ('fa710000-0000-0000-0000-0000000000c2', :C, :C2, 'EV10 obra de C2');
-- Filas HISTÓRICAS ya inconsistentes (de antes del control): no deben quedar bloqueadas por cambios ajenos.
INSERT INTO activos_fijos (id,company_id,codigo,nombre,costo,valor_residual,vida_util_meses,proveedor_id) VALUES
  ('fa710000-0000-0000-0000-0000000000a9', :C, 'EV10-AF-H', 'EV10 activo histórico', 100, 0, 12, :PD);
INSERT INTO gastos_condominio (id,company_id,project_id,concepto,monto,fecha,proveedor_id) VALUES
  ('fa710000-0000-0000-0000-0000000000b9', :C, :C1, 'EV10 gasto histórico', 10, CURRENT_DATE, :PD);
INSERT INTO ordenes_compra (id,company_id,project_id,proveedor_id,proveedor_nombre,concepto,obra_id) VALUES
  ('fa710000-0000-0000-0000-0000000000e9', :C, :C1, :P1, 'x', 'EV10 orden histórica con obra de D', 'fa710000-0000-0000-0000-0000000000d1');
RESET session_replication_role;

SELECT public.como(:UA::uuid);
SET ROLE authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- a · activos_fijos
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.h10_falla($$ INSERT INTO public.activos_fijos (company_id,codigo,nombre,costo,valor_residual,vida_util_meses,proveedor_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','EV10-AF-1','x',100,0,12,'e3000000-0000-0000-0000-0000000000d1') $$,
  '23514', '^COMPRAS_ALCANCE_PROVEEDOR: ', '[EV-10a1] un activo de C no lleva el proveedor de D');
SELECT public.h10_falla($$ INSERT INTO public.activos_fijos (company_id,project_id,codigo,nombre,costo,valor_residual,vida_util_meses)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','d1d1d1d1-0000-0000-0000-000000000001','EV10-AF-2','x',100,0,12) $$,
  '23514', '^COMPRAS_ALCANCE_PROYECTO: ', '[EV-10a2] un activo de C no cuelga del proyecto de D');
INSERT INTO public.activos_fijos (id,company_id,project_id,codigo,nombre,costo,valor_residual,vida_util_meses,proveedor_id)
VALUES ('fa710000-0000-0000-0000-0000000000a1', :C, :C1, 'EV10-AF-3', 'activo legítimo', 100, 0, 12, :P1);
INSERT INTO public.activos_fijos (id,company_id,codigo,nombre,costo,valor_residual,vida_util_meses)
VALUES ('fa710000-0000-0000-0000-0000000000a2', :C, 'EV10-AF-4', 'activo sin proveedor', 100, 0, 12);
SELECT public.chk((SELECT count(*) FROM public.activos_fijos WHERE id IN ('fa710000-0000-0000-0000-0000000000a1','fa710000-0000-0000-0000-0000000000a2')), 2,
  '[EV-10a3] LEGÍTIMO: el activo con proveedor y proyecto de la empresa, y el activo sin proveedor, se crean');

-- ═══════════════════════════════════════════════════════════════════════════
-- b · gastos_condominio
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.h10_falla($$ INSERT INTO public.gastos_condominio (company_id,project_id,concepto,monto,fecha,proveedor_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','x',10,CURRENT_DATE,'e3000000-0000-0000-0000-0000000000d1') $$,
  '23514', '^COMPRAS_ALCANCE_PROVEEDOR: ', '[EV-10b1] un gasto de C no lleva el proveedor de D');
SELECT public.h10_falla($$ INSERT INTO public.gastos_condominio (company_id,project_id,concepto,monto,fecha)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','d1d1d1d1-0000-0000-0000-000000000001','x',10,CURRENT_DATE) $$,
  '23514', '^COMPRAS_ALCANCE_PROYECTO: ', '[EV-10b2] un gasto de C no se contabiliza en el proyecto de D');
INSERT INTO public.gastos_condominio (id,company_id,project_id,concepto,monto,fecha,proveedor_id)
VALUES ('fa710000-0000-0000-0000-0000000000b1', :C, :C1, 'EV10 gasto legítimo', 10, CURRENT_DATE, :P1);
SELECT public.chk((SELECT count(*) FROM public.gastos_condominio WHERE id = 'fa710000-0000-0000-0000-0000000000b1'), 1,
  '[EV-10b3] LEGÍTIMO: el gasto con proveedor y proyecto de la empresa se crea');

-- ═══════════════════════════════════════════════════════════════════════════
-- c · ordenes_compra.obra_id
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.h10_falla($$ INSERT INTO public.ordenes_compra (company_id,project_id,proveedor_id,proveedor_nombre,concepto,obra_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','x','x','fa710000-0000-0000-0000-0000000000d1') $$,
  '23514', '^COMPRAS_ALCANCE_OBRA: la obra de la orden de compra no pertenece a la empresa', '[EV-10c1] una orden de C no lleva la obra de D');
SELECT public.h10_falla($$ INSERT INTO public.ordenes_compra (company_id,project_id,proveedor_id,proveedor_nombre,concepto,obra_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','x','x','fa710000-0000-0000-0000-0000000000c2') $$,
  '23514', '^COMPRAS_ALCANCE_OBRA: la obra es de otro proyecto', '[EV-10c2] una orden del proyecto C1 no lleva la obra del proyecto C2');
INSERT INTO public.ordenes_compra (id,company_id,project_id,proveedor_id,proveedor_nombre,concepto,obra_id)
VALUES ('fa710000-0000-0000-0000-0000000000e1', :C, :C1, :P1, 'x', 'EV10 orden con su obra', :OBRA_C1);
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id = 'fa710000-0000-0000-0000-0000000000e1' AND obra_id = 'fa710000-0000-0000-0000-0000000000c1'), 1,
  '[EV-10c3] LEGÍTIMO: la orden de un proyecto con la obra de ese proyecto se crea');
INSERT INTO public.ordenes_compra (id,company_id,project_id,proveedor_id,proveedor_nombre,concepto,obra_id)
VALUES ('fa710000-0000-0000-0000-0000000000e2', :C, NULL, :P1, 'x', 'EV10 orden de empresa con una obra de la empresa', :OBRA_C2);
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id = 'fa710000-0000-0000-0000-0000000000e2'), 1,
  '[EV-10c4] LEGÍTIMO: la orden de la contabilidad de la empresa (sin proyecto) puede llevar una obra de la empresa');

-- UPDATE: cambiar la obra de un borrador propio
SELECT public.h10_falla($$ UPDATE public.ordenes_compra SET obra_id = 'fa710000-0000-0000-0000-0000000000d1' WHERE id = 'fa710000-0000-0000-0000-0000000000e1' $$,
  '23514', '^COMPRAS_ALCANCE_OBRA: ', '[EV-10c5] UPDATE: cambiar la obra de una orden propia por la de D se rechaza');
UPDATE public.ordenes_compra SET obra_id = NULL WHERE id = 'fa710000-0000-0000-0000-0000000000e1';
UPDATE public.ordenes_compra SET obra_id = 'fa710000-0000-0000-0000-0000000000c1' WHERE id = 'fa710000-0000-0000-0000-0000000000e1';
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id = 'fa710000-0000-0000-0000-0000000000e1' AND obra_id = 'fa710000-0000-0000-0000-0000000000c1'), 1,
  '[EV-10c6] LEGÍTIMO: quitar la obra y volver a ponerle la de su proyecto');

-- ═══════════════════════════════════════════════════════════════════════════
-- d · Solo lo que nace o cambia: las filas HISTÓRICAS inconsistentes no quedan bloqueadas
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE public.activos_fijos SET nombre = 'EV10 activo histórico (editado)', costo = 120 WHERE id = 'fa710000-0000-0000-0000-0000000000a9';
UPDATE public.activos_fijos SET proveedor_id = 'e3000000-0000-0000-0000-0000000000d1' WHERE id = 'fa710000-0000-0000-0000-0000000000a9';   -- reenviado sin cambio
UPDATE public.activos_fijos SET project_id = :C1 WHERE id = 'fa710000-0000-0000-0000-0000000000a9';                                         -- cambia OTRA referencia
SELECT public.chk((SELECT count(*) FROM public.activos_fijos WHERE id = 'fa710000-0000-0000-0000-0000000000a9' AND costo = 120 AND project_id = 'c1c1c1c1-0000-0000-0000-000000000001'), 1,
  '[EV-10d1] el activo histórico con proveedor ajeno se edita, se reenvía igual y cambia de proyecto sin revalidar el proveedor');
SELECT public.h10_falla($$ UPDATE public.activos_fijos SET proveedor_id = 'fa710000-0000-0000-0000-0000000000d2' WHERE id = 'fa710000-0000-0000-0000-0000000000a9' $$,
  '23514', '^COMPRAS_ALCANCE_PROVEEDOR: ', '[EV-10d2] pero cambiarle el proveedor a OTRO proveedor de otra empresa sí se rechaza');
UPDATE public.activos_fijos SET proveedor_id = :P1 WHERE id = 'fa710000-0000-0000-0000-0000000000a9';
SELECT public.chk((SELECT count(*) FROM public.activos_fijos WHERE id = 'fa710000-0000-0000-0000-0000000000a9' AND proveedor_id = 'e3000000-0000-0000-0000-000000000001'), 1,
  '[EV-10d3] y corregirlo al proveedor propio siempre se puede');
UPDATE public.gastos_condominio SET concepto = 'EV10 gasto histórico (editado)', monto = 11 WHERE id = 'fa710000-0000-0000-0000-0000000000b9';
SELECT public.chk((SELECT count(*) FROM public.gastos_condominio WHERE id = 'fa710000-0000-0000-0000-0000000000b9' AND monto = 11), 1,
  '[EV-10d4] el gasto histórico con proveedor ajeno se edita sin revalidar el proveedor');
UPDATE public.ordenes_compra SET concepto = 'EV10 orden histórica (editada)' WHERE id = 'fa710000-0000-0000-0000-0000000000e9';
UPDATE public.ordenes_compra SET obra_id = 'fa710000-0000-0000-0000-0000000000d1' WHERE id = 'fa710000-0000-0000-0000-0000000000e9';        -- reenviada sin cambio
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id = 'fa710000-0000-0000-0000-0000000000e9' AND concepto LIKE '%(editada)'), 1,
  '[EV-10d5] la orden histórica con obra ajena se edita y se reenvía sin revalidar');
UPDATE public.ordenes_compra SET obra_id = NULL WHERE id = 'fa710000-0000-0000-0000-0000000000e9';
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id = 'fa710000-0000-0000-0000-0000000000e9' AND obra_id IS NULL), 1,
  '[EV-10d6] y se le puede quitar la obra ajena');
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- e · También para el camino de sistema (sin sesión de usuario / superusuario)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.h10_falla($$ INSERT INTO public.activos_fijos (company_id,codigo,nombre,costo,valor_residual,vida_util_meses,proveedor_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','EV10-AF-5','x',100,0,12,'e3000000-0000-0000-0000-0000000000d1') $$,
  '23514', '^COMPRAS_ALCANCE_PROVEEDOR: ', '[EV-10e1] sin sesión de usuario tampoco se crea un activo con el proveedor de otra empresa');
SELECT public.h10_falla($$ INSERT INTO public.ordenes_compra (company_id,project_id,proveedor_id,proveedor_nombre,concepto,obra_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','x','x','fa710000-0000-0000-0000-0000000000d1') $$,
  '23514', '^COMPRAS_ALCANCE_OBRA: ', '[EV-10e2] ni una orden con la obra de otra empresa');

SELECT 'EV-10 · todas las aserciones pasaron' AS resultado;
