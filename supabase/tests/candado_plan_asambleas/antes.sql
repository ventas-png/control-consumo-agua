-- ============================================================================
-- CONTROL PREVIO: el estado de ANTES de 20261104000650, sobre el mismo padrón.
--
-- Reproduce el fallo: con el candado de 20260602000010 (que busca la empresa en
-- asambleas_digital), NADIE da de alta puntos ni votos, ni siquiera el admin de
-- una empresa cuyo plan incluye asambleas_digitales. Y prueba que la causa es
-- el candado y nada más: sin él, esas mismas altas entran.
--
-- Si esto no se reproduce, el padrón no prueba lo que dice: la suite de después
-- pasaría igual sin la migración.
-- ============================================================================
\set ON_ERROR_STOP on

SELECT cp.chk(position('asambleas_digital.id = puntos_asamblea.asamblea_id' IN with_check) > 0, true,
  'antes · puntos_asamblea_feature_gate liga asamblea_id a la fila de afuera (asambleas_digital.id = puntos_asamblea.asamblea_id)')
FROM pg_policies WHERE tablename = 'puntos_asamblea' AND policyname = 'puntos_asamblea_feature_gate';

SELECT cp.como('ADM_A'); SET ROLE authenticated;
SELECT cp.chk(cp.convoca('A'), true,
  'antes · ADM_A SÍ convoca una asamblea (asambleas no tiene candado de plan)');
SELECT cp.chk(cp.agrega_punto('ASA_A'), false,
  'antes · ADM_A (plan con asambleas_digitales) NO agrega un punto a su asamblea');
SELECT cp.chk(cp.vota('PUN_A', 'U_A'), false,
  'antes · ADM_A NO registra un voto');
SELECT cp.chk(cp.vota_upsert('PUN_A', 'U_A'), false,
  'antes · ADM_A NO registra un voto con el upsert del panel');
SELECT cp.chk(cp.vota_upsert('PUN_A', 'U_A2'), false,
  'antes · ADM_A NO cambia un voto ya registrado (el upsert choca con el candado de INSERT)');
RESET ROLE;

SELECT cp.como('ADM_B'); SET ROLE authenticated;
SELECT cp.chk(cp.agrega_punto('ASA_B'), false,
  'antes · ADM_B (trial) NO agrega un punto');
RESET ROLE;

SELECT cp.como('STF_A'); SET ROLE authenticated;
SELECT cp.chk(cp.agrega_punto('ASA_A'), false,
  'antes · STF_A (con permiso del tab) NO agrega un punto');
SELECT cp.chk(cp.vota('PUN_A', 'U_A'), false,
  'antes · STF_A NO registra un voto');
RESET ROLE;

-- La causa es el candado y nada más: sin las dos RESTRICTIVAS, las mismas
-- altas entran. Se deshace al final.
BEGIN;
DROP POLICY puntos_asamblea_feature_gate ON public.puntos_asamblea;
DROP POLICY votos_asamblea_feature_gate ON public.votos_asamblea;
SELECT cp.como('ADM_A'); SET ROLE authenticated;
SELECT cp.chk(cp.agrega_punto('ASA_A'), true,
  'antes · sin el candado, ADM_A SÍ agrega el punto: el candado es la única causa');
SELECT cp.chk(cp.vota_upsert('PUN_A', 'U_A'), true,
  'antes · sin el candado, ADM_A SÍ registra el voto');
RESET ROLE;
ROLLBACK;
