-- ============================================================================
-- INVARIANTES de 20261105000000 sobre el padrón (fixture.sql).
--
-- El propietario ve las asambleas clásicas de SU condominio con sus puntos y
-- vota, una vez por unidad propia, en los puntos de votación de una asamblea
-- en curso de una empresa con la feature. Nadie más vota por ese camino, y
-- nadie ve el voto de otra unidad: sólo los totales de las finalizadas.
-- ============================================================================
\set ON_ERROR_STOP on

-- ── Lo que ve el propietario ────────────────────────────────────────────────
SELECT pv.como('PROP'); SET ROLE authenticated;
SELECT pv.chk((SELECT count(*)::int FROM pv.asambleas('U_P')), 4,
  'PROP ve las 4 asambleas de A1 (en curso, programada, finalizada y cancelada)');
SELECT pv.chk(pv.asamblea('U_P', 'ASA_A2') IS NULL AND pv.asamblea('U_P', 'ASA_C') IS NULL, true,
  'PROP no ve asambleas de otro condominio (A2) ni de otra empresa (C1)');
SELECT pv.chk((SELECT array_agg(p->>'titulo' ORDER BY ord)
                 FROM jsonb_array_elements(pv.asamblea('U_P', 'ASA_CUR')->'puntos') WITH ORDINALITY AS t(p, ord)),
              ARRAY['Informe de la administración', 'Aprobación del presupuesto'],
  'la asamblea en curso trae sus 2 puntos, en el orden del día');
SELECT pv.chk(pv.punto('U_P', 'PUN_V')->>'mi_voto', NULL,
  'mi_voto es el de U_P (nulo), no el de U_O que ya votó en ese punto');
SELECT pv.chk(pv.punto('U_P', 'PUN_V')->'conteo', 'null'::jsonb,
  'con la asamblea en curso no sale el conteo parcial');
SELECT pv.chk(pv.asamblea('U_P', 'ASA_CUR')->'acta', 'null'::jsonb,
  'el acta en borrador de una asamblea en curso no sale');
SELECT pv.chk(pv.asamblea('U_P', 'ASA_FIN')->>'acta', 'Acta firmada',
  'el acta de la finalizada sí sale');
SELECT pv.chk(pv.punto('U_P', 'PUN_FIN')->'conteo', '{"a_favor": 1, "en_contra": 1, "abstencion": 0}'::jsonb,
  'la finalizada trae los TOTALES del punto de votación');
SELECT pv.chk(pv.punto('U_P', 'PUN_FIN')->>'resultado', 'Rechazado',
  'y el resultado del punto');
-- Por las tablas, el residente sigue sin leer el voto de otra unidad.
SELECT pv.chk((SELECT count(*)::int FROM public.votos_asamblea), 0,
  'PROP no lee filas de votos_asamblea directamente');
SELECT pv.chk((SELECT count(*)::int FROM public.asambleas), 0,
  'PROP no lee asambleas directamente: la lectura pasa por el RPC');
RESET ROLE;

-- ── El voto ─────────────────────────────────────────────────────────────────
SELECT pv.como('PROP'); SET ROLE authenticated;
SELECT pv.chk(pv.vota('PUN_V', 'U_P', 'favor'), '22023',
  'PROP no vota con el vocabulario viejo (''favor'')');
SELECT pv.chk(pv.vota('PUN_I', 'U_P', 'a_favor'), '22023',
  'PROP no vota en un punto informativo');
SELECT pv.chk(pv.vota('PUN_PROG', 'U_P', 'a_favor'), '22023',
  'PROP no vota en una asamblea programada');
SELECT pv.chk(pv.vota('PUN_FIN', 'U_P', 'a_favor'), '22023',
  'PROP no vota en una asamblea finalizada');
SELECT pv.chk(pv.vota('PUN_A2', 'U_P', 'a_favor'), '42501',
  'PROP no vota con U_P en un punto de otro condominio (A2)');
SELECT pv.chk(pv.vota('PUN_C', 'U_P', 'a_favor'), '42501',
  'PROP no vota con U_P en un punto de otra empresa (C1)');
SELECT pv.chk(pv.vota('PUN_V', 'U_O', 'a_favor'), '42501',
  'PROP no vota por una unidad que no es suya (U_O)');
SELECT pv.chk(pv.vota('PUN_V', 'U_P', 'en_contra'), 'ok',
  'PROP SÍ vota con U_P en el punto de votación de la asamblea en curso');
SELECT pv.chk(pv.punto('U_P', 'PUN_V')->>'mi_voto', 'en_contra',
  'el portal ve el voto registrado de U_P');
SELECT pv.chk(pv.vota('PUN_V', 'U_P', 'a_favor'), '23505',
  'PROP no re-vota desde el portal (23505, la UI lo reconoce)');
RESET ROLE;

SELECT pv.chk((SELECT voto || '/' || (registrado_por = pv.id('PROP'))::text
                 FROM public.votos_asamblea WHERE punto_id = pv.id('PUN_V') AND unidad_id = pv.id('U_P')),
              'en_contra/true',
  'el voto quedó en votos_asamblea con el vocabulario del panel y registrado_por = PROP');

SELECT pv.como('PROP2'); SET ROLE authenticated;
SELECT pv.chk((SELECT count(*)::int FROM pv.asambleas('U_P2')), 4,
  'PROP2 (propietario por unidad_residentes) ve las asambleas de A1');
SELECT pv.chk(pv.vota('PUN_V', 'U_P2', 'abstencion'), 'ok',
  'PROP2 SÍ vota con U_P2');
RESET ROLE;

-- ── Quién NO vota por el portal ─────────────────────────────────────────────
SELECT pv.como('INQ'); SET ROLE authenticated;
SELECT pv.chk((SELECT count(*)::int FROM pv.asambleas('U_P')), 0,
  'INQ (arrendatario de U_P) no recibe las asambleas');
SELECT pv.chk(pv.vota('PUN_V', 'U_P', 'a_favor'), '42501',
  'INQ no vota por U_P');
RESET ROLE;

SELECT pv.como('PROPC'); SET ROLE authenticated;
SELECT pv.chk((SELECT count(*)::int FROM pv.asambleas('U_C')), 0,
  'PROPC (empresa agua_only) no recibe asambleas: manda el plan de la empresa');
SELECT pv.chk(pv.vota('PUN_C', 'U_C', 'a_favor'), '42501',
  'PROPC no vota: su empresa no tiene asambleas_digitales');
RESET ROLE;

SELECT pv.como('ADM_A'); SET ROLE authenticated;
SELECT pv.chk((SELECT count(*)::int FROM pv.asambleas('U_P')), 0,
  'ADM_A (staff) no usa el RPC del portal: no es propietario de ninguna unidad');
SELECT pv.chk(pv.vota('PUN_V', 'U_O', 'a_favor'), '42501',
  'ADM_A no vota por el RPC del portal (el staff vota desde el panel)');
RESET ROLE;

SELECT pv.chk(has_function_privilege('anon', 'public.portal_votar_punto(uuid,uuid,text)', 'EXECUTE')
           OR has_function_privilege('anon', 'public.portal_asambleas_unidad(uuid)', 'EXECUTE'), false,
  'anon no ejecuta ninguno de los dos RPC');

-- ── El residente sigue sin escribir la tabla directamente ───────────────────
SELECT pv.como('OTRO'); SET ROLE authenticated;
SELECT pv.chk(pv.intenta(
  'INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES ($1, $2, ''a_favor'')',
  pv.id('PUN_V'), pv.id('U_O')), '42501',
  'OTRO no inserta en votos_asamblea por fuera del RPC (RLS)');
SELECT pv.chk(pv.intenta(
  'UPDATE public.votos_asamblea SET voto = ''en_contra'' WHERE id = $1', pv.id('VOT_O')), 'ok:0',
  'OTRO no cambia su voto por fuera del RPC (RLS: 0 filas)');
RESET ROLE;

-- ── El vocabulario, para el panel también ───────────────────────────────────
SELECT pv.como('ADM_A'); SET ROLE authenticated;
SELECT pv.chk(pv.intenta(
  'INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES ($1, $2, ''contra'')
   ON CONFLICT (punto_id, unidad_id) DO UPDATE SET voto = EXCLUDED.voto',
  pv.id('PUN_V'), pv.id('U_O')), '23514',
  'el panel tampoco guarda un voto fuera del vocabulario (CHECK, 23514)');
SELECT pv.chk(pv.intenta(
  'INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto, registrado_por) VALUES ($1, $2, ''en_contra'', auth.uid())
   ON CONFLICT (punto_id, unidad_id) DO UPDATE SET voto = EXCLUDED.voto, registrado_por = EXCLUDED.registrado_por',
  pv.id('PUN_V'), pv.id('U_O')), 'ok:1',
  'el panel SÍ corrige un voto con el upsert de registrarVoto');
RESET ROLE;
