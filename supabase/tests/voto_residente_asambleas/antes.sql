-- ============================================================================
-- CONTROL PREVIO: el estado de ANTES de 20261104000060, sobre el mismo padrón.
--
-- Reproduce lo que rompía el portal en la base: el residente no ve ninguna
-- asamblea, ni puntos, ni el voto de su propia unidad, y su voto se rechaza.
-- Y votos_asamblea acepta cualquier texto como voto ('favor', 'contra' del
-- portal viejo se mezclaban con 'a_favor', 'en_contra' del panel).
-- El staff, en cambio, ya vota (el candado de plan de 20261104000050 está):
-- el residente es lo único que falta.
--
-- Si esto no se reproduce, el padrón no prueba lo que dice: la suite de después
-- pasaría igual sin la migración.
-- ============================================================================
\set ON_ERROR_STOP on

SELECT vr.como('PROP'); SET ROLE authenticated;
SELECT vr.chk(vr.ve('asambleas'), 0,
  'antes · PROP (propietaria de U1 en A1) NO ve ninguna asamblea');
SELECT vr.chk(vr.ve('puntos_asamblea'), 0,
  'antes · PROP NO ve ningún punto');
SELECT vr.chk(vr.ve('votos_asamblea'), 0,
  'antes · PROP NO ve ni el voto de su propia unidad');
SELECT vr.chk(vr.vota('PUN_CV', 'U1'), false,
  'antes · PROP NO vota por U1 en un punto de votación de una asamblea en curso');
RESET ROLE;

SELECT vr.como('INQ'); SET ROLE authenticated;
SELECT vr.chk(vr.ve('asambleas'), 0,
  'antes · INQ (arrendatario de U1) NO ve ninguna asamblea');
RESET ROLE;

SELECT vr.chk(to_regprocedure('public.portal_conteo_votos_asambleas(uuid[])') IS NULL, true,
  'antes · no existe una lectura de resultados para el portal');

SELECT vr.chk(vr.vota_valor('PUN_PV', 'U2', 'favor'), 'ok:1',
  'antes · votos_asamblea acepta ''favor'' (el valor del portal viejo) sin CHECK');

SELECT vr.como('STF_A'); SET ROLE authenticated;
SELECT vr.chk(vr.vota_upsert('PUN_CV', 'U4'), true,
  'antes · STF_A (staff con Votaciones) SÍ registra un voto: sólo falta el residente');
SELECT vr.chk(vr.ve('asambleas'), 5,
  'antes · STF_A ve las cinco asambleas de A');
RESET ROLE;
