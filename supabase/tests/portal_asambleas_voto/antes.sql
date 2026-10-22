-- ============================================================================
-- CONTROL PREVIO: el estado de ANTES de 20261105000000 (con 20261104000120, el
-- candado de plan ya corregido), sobre el mismo padrón.
--
-- Reproduce, una por una, las causas por las que el portal no podía votar:
--   · el modelo: lo que listaba (asambleas_digital) no puede tener puntos
--   · el payload: `asamblea_id` no es columna de votos_asamblea
--   · el RLS: el propietario no lee la asamblea ni escribe su voto
--   · el vocabulario: 'favor' entra en la tabla junto a 'a_favor'
--   · los RPC del portal no existen
-- Si algo de esto no se reproduce, el padrón no prueba lo que dice.
-- ============================================================================
\set ON_ERROR_STOP on

SELECT pv.chk(to_regprocedure('public.portal_votar_punto(uuid,uuid,text)') IS NULL, true,
  'antes · no existe portal_votar_punto');
SELECT pv.chk(to_regprocedure('public.portal_asambleas_unidad(uuid)') IS NULL, true,
  'antes · no existe portal_asambleas_unidad');

-- El modelo: puntos_asamblea.asamblea_id es FK a asambleas; un punto de una
-- asamblea DIGITAL no puede existir, así que el portal nunca encontraba uno.
SELECT pv.chk(pv.intenta(
  'INSERT INTO public.puntos_asamblea (asamblea_id, titulo, tipo) VALUES ($1, ''Punto digital'', ''votacion'')',
  pv.id('ASA_DIG')), '23503',
  'antes · un punto no puede colgar de una asamblea digital (FK a asambleas)');

-- El vocabulario: sin CHECK, el 'favor' del portal viejo entra igual.
SELECT pv.chk(pv.intenta(
  'INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES ($1, $2, ''favor'')',
  pv.id('PUN_V'), pv.id('U_P')), 'ok:1',
  'antes · votos_asamblea acepta ''favor'' junto a ''a_favor'' (sin CHECK)');

SELECT pv.como('PROP'); SET ROLE authenticated;
SELECT pv.chk((SELECT count(*)::int FROM public.asambleas WHERE project_id = pv.id('A1')), 0,
  'antes · PROP (propietario en A1) no lee ninguna asamblea de su condominio');
SELECT pv.chk((SELECT count(*)::int FROM public.puntos_asamblea WHERE asamblea_id = pv.id('ASA_CUR')), 0,
  'antes · PROP no lee los puntos de la asamblea en curso');
-- El payload exacto del portal viejo.
SELECT pv.chk(pv.intenta(
  'INSERT INTO public.votos_asamblea (punto_id, asamblea_id, unidad_id, voto) VALUES ($1, $1, $2, $3)',
  pv.id('PUN_V'), pv.id('U_P'), 'favor'), '42703',
  'antes · el voto del portal manda asamblea_id, que votos_asamblea no tiene (42703)');
-- Aun sin esa columna y con el vocabulario del panel, el RLS lo rechaza.
SELECT pv.chk(pv.intenta(
  'INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES ($1, $2, $3)',
  pv.id('PUN_V'), pv.id('U_P'), 'a_favor'), '42501',
  'antes · sin asamblea_id, el RLS rechaza el voto del propietario de U_P (42501)');
RESET ROLE;
