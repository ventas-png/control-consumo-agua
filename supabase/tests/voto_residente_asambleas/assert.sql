-- ============================================================================
-- INVARIANTES de 20261104000060 sobre el padrón (fixture.sql).
--
-- El residente ve las asambleas y puntos de los condominios donde tiene unidad
-- y sólo el voto de sus unidades. El PROPIETARIO vota, firmado, una vez por
-- unidad, en puntos de votación de una asamblea en curso de su condominio, y
-- no puede cambiar ni borrar el voto. Los resultados de las finalizadas le
-- llegan como totales. El staff no cambia y el candado de plan sigue mandando.
-- ============================================================================
\set ON_ERROR_STOP on

-- ── Lectura del residente ───────────────────────────────────────────────────
SELECT vr.como('PROP'); SET ROLE authenticated;
SELECT vr.chk(vr.ve('asambleas'), 3,
  'PROP ve las tres asambleas de A1 (en curso, programada, finalizada) y ninguna de A2 ni de C1');
SELECT vr.chk(vr.ve('puntos_asamblea'), 7,
  'PROP ve los siete puntos de las asambleas de A1');
SELECT vr.chk((SELECT count(*) FROM public.puntos_asamblea WHERE id = vr.id('PUN_A2V'))::int, 0,
  'PROP NO ve el punto de una asamblea de A2, donde no tiene unidad');
SELECT vr.chk(vr.ve('votos_asamblea'), 2,
  'PROP ve sólo los dos votos de U1, no los de U2, U4 ni U5');
SELECT vr.chk((SELECT count(*) FROM public.votos_asamblea WHERE unidad_id <> vr.id('U1'))::int, 0,
  'PROP NO ve cómo votó otra unidad');
RESET ROLE;

SELECT vr.como('INQ'); SET ROLE authenticated;
SELECT vr.chk(vr.ve('asambleas'), 3,
  'INQ (arrendatario de U1) también ve las asambleas de A1');
SELECT vr.chk(vr.ve('puntos_asamblea'), 7,
  'INQ ve sus puntos');
SELECT vr.chk(vr.ve('votos_asamblea'), 2,
  'INQ ve el voto de su unidad');
RESET ROLE;

SELECT vr.como('PROP2'); SET ROLE authenticated;
SELECT vr.chk(vr.ve('asambleas'), 2,
  'PROP2 (propietario de U3 por membresía) ve las dos asambleas de A2 y ninguna de A1');
SELECT vr.chk(vr.ve('votos_asamblea'), 1,
  'PROP2 ve sólo el voto de U3');
RESET ROLE;

SELECT vr.como('NOP_A'); SET ROLE authenticated;
SELECT vr.chk(vr.ve('asambleas') + vr.ve('puntos_asamblea') + vr.ve('votos_asamblea'), 0,
  'NOP_A (staff de A sin permisos, sin unidades) sigue sin ver nada: la rama del residente no abre al staff');
RESET ROLE;

SELECT vr.como('STF_A'); SET ROLE authenticated;
SELECT vr.chk(vr.ve('asambleas'), 5,
  'STF_A sigue viendo las cinco asambleas de A');
SELECT vr.chk(vr.ve('votos_asamblea'), 8,
  'STF_A sigue viendo los ocho votos de A');
RESET ROLE;

-- ── El voto del propietario ─────────────────────────────────────────────────
SELECT vr.como('PROP'); SET ROLE authenticated;
SELECT vr.chk(vr.vota('PUN_CV', 'U1'), true,
  'PROP SÍ vota por U1, firmado, en un punto de votación de una asamblea en curso de A1');
SELECT vr.chk(vr.vota('PUN_CV', 'U1', NULL), false,
  'PROP NO vota sin firmar (registrado_por vacío)');
SELECT vr.chk(vr.vota('PUN_CV', 'U1', 'STF_A'), false,
  'PROP NO vota con la firma de otra persona');
SELECT vr.chk(vr.vota('PUN_CV', 'U4'), false,
  'PROP NO vota por una unidad ajena (U4)');
SELECT vr.chk(vr.vota('PUN_CI', 'U1'), false,
  'PROP NO vota en un punto informativo');
SELECT vr.chk(vr.vota('PUN_PV', 'U1'), false,
  'PROP NO vota en una asamblea programada');
SELECT vr.chk(vr.vota('PUN_FV', 'U1'), false,
  'PROP NO vota en una asamblea finalizada');
SELECT vr.chk(vr.vota('PUN_A2V', 'U1'), false,
  'PROP NO vota con U1 (de A1) en una asamblea de A2');
SELECT vr.chk(vr.agrega_punto('ASA_CURSO'), false,
  'PROP NO agrega puntos a la asamblea');
RESET ROLE;

SELECT vr.como('INQ'); SET ROLE authenticated;
SELECT vr.chk(vr.vota('PUN_CV', 'U1'), false,
  'INQ (arrendatario) NO vota por U1: vota el propietario');
RESET ROLE;

-- PROP3 ve A1 (arrendatario de U5) y A2 (propietario de U6): el candado de plan
-- y el SELECT le dejan pasar en los dos, así que lo único que le impide votar en
-- A1 con U6 es que la unidad sea del condominio de la asamblea.
SELECT vr.como('PROP3'); SET ROLE authenticated;
SELECT vr.chk(vr.vota('PUN_A2V', 'U6'), true,
  'PROP3 SÍ vota por U6 en la asamblea de A2, su condominio');
SELECT vr.chk(vr.vota('PUN_CV', 'U6'), false,
  'PROP3 NO vota con U6 (de A2) en una asamblea de A1, aunque también resida en A1');
SELECT vr.chk(vr.vota('PUN_CV', 'U5'), false,
  'PROP3 NO vota por U5, donde es arrendatario');
RESET ROLE;

SELECT vr.como('PROP2'); SET ROLE authenticated;
SELECT vr.chk(vr.vota('PUN_A2V', 'U3'), true,
  'PROP2 SÍ vota por U3 en A2 (propietario por membresía)');
SELECT vr.chk(vr.vota('PUN_CV', 'U1'), false,
  'PROP2 NO vota por U1');
RESET ROLE;

-- ── Append-only: un voto por unidad, sin cambiarlo ni borrarlo ──────────────
-- U1 ya votó en PUN_CV2 (VOT_PREVIO, firmado por PROP).
SELECT vr.como('PROP'); SET ROLE authenticated;
SELECT vr.chk(vr.resultado(
    'INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto, registrado_por) VALUES ($1, $2, ''en_contra'', auth.uid())',
    vr.id('PUN_CV2'), vr.id('U1')), '23505',
  'PROP NO vota dos veces en el mismo punto: lo rechaza el UNIQUE (punto, unidad)');
SELECT vr.chk(vr.vota_upsert('PUN_CV2', 'U1'), false,
  'PROP NO cambia su voto con un upsert');
SELECT vr.chk(vr.cambia('PUN_CV2', 'U1'), false,
  'PROP NO cambia su voto con un UPDATE');
SELECT vr.chk(vr.borra('PUN_CV2', 'U1'), false,
  'PROP NO borra su voto');
RESET ROLE;
SELECT vr.chk((SELECT voto FROM public.votos_asamblea WHERE id = vr.id('VOT_PREVIO')), 'a_favor',
  'el voto de PROP sigue intacto');

-- ── El candado de plan aplica también al residente ──────────────────────────
SELECT vr.como('PROPC'); SET ROLE authenticated;
SELECT vr.chk(vr.ve('asambleas'), 1,
  'PROPC (propietaria en C1) ve la asamblea de C1');
SELECT vr.chk(vr.vota('PUN_CCV', 'UC'), false,
  'PROPC NO vota: el plan de C (agua_only) no incluye asambleas_digitales');
RESET ROLE;
-- La causa es el candado y nada más: sin él, el mismo voto entra. Se deshace.
BEGIN;
DROP POLICY votos_asamblea_feature_gate ON public.votos_asamblea;
SELECT vr.como('PROPC'); SET ROLE authenticated;
SELECT vr.chk(vr.vota('PUN_CCV', 'UC'), true,
  'sin el candado de plan, PROPC SÍ votaría: el plan es la única causa');
RESET ROLE;
ROLLBACK;

-- ── El staff no cambia ──────────────────────────────────────────────────────
SELECT vr.como('ADM_A'); SET ROLE authenticated;
SELECT vr.chk(vr.vota('PUN_CV', 'U4', NULL), true,
  'ADM_A SÍ registra un voto por cualquier unidad, sin firma, como antes');
RESET ROLE;
SELECT vr.como('STF_A'); SET ROLE authenticated;
SELECT vr.chk(vr.vota_upsert('PUN_CV2', 'U1'), true,
  'STF_A SÍ corrige el voto de U1 desde el panel (upsert)');
SELECT vr.chk(vr.vota('PUN_FV', 'U1', NULL), true,
  'STF_A SÍ registra un voto en una asamblea finalizada, como antes');
RESET ROLE;
SELECT vr.como('NOP_A'); SET ROLE authenticated;
SELECT vr.chk(vr.vota('PUN_CV', 'U4'), false,
  'NOP_A (staff sin permisos) sigue sin registrar votos');
RESET ROLE;

-- ── Valores de voto ─────────────────────────────────────────────────────────
SELECT vr.chk(vr.vota_valor('PUN_PV', 'U4', 'favor'), '23514',
  'votos_asamblea rechaza ''favor'' (CHECK)');
SELECT vr.chk(vr.vota_valor('PUN_PV', 'U4', 'contra'), '23514',
  'votos_asamblea rechaza ''contra'' (CHECK)');
SELECT vr.chk(vr.vota_valor('PUN_PV', 'U4', 'a_favor') || vr.vota_valor('PUN_PV', 'U4', 'en_contra')
              || vr.vota_valor('PUN_PV', 'U4', 'abstencion'), 'ok:1ok:1ok:1',
  'votos_asamblea acepta a_favor, en_contra y abstencion');

-- ── Resultados del portal: sólo totales ─────────────────────────────────────
SELECT vr.como('PROP'); SET ROLE authenticated;
SELECT vr.chk(vr.conteo(ARRAY['ASA_CURSO','ASA_PROG','ASA_FIN','ASA_A2','ASA_A2F','ASA_C']),
  'PUN_FV:2/1/0 PUN_FV2:0/1/1',
  'PROP recibe los totales de los puntos de votación de la asamblea FINALIZADA de A1, y nada de A2 ni de las abiertas');
RESET ROLE;
SELECT vr.como('INQ'); SET ROLE authenticated;
SELECT vr.chk(vr.conteo(ARRAY['ASA_FIN']), 'PUN_FV:2/1/0 PUN_FV2:0/1/1',
  'INQ también recibe los totales de su condominio');
RESET ROLE;
SELECT vr.como('PROP2'); SET ROLE authenticated;
SELECT vr.chk(vr.conteo(ARRAY['ASA_FIN','ASA_A2F']), 'PUN_A2FV:1/0/0',
  'PROP2 recibe los totales de A2 y no los de A1');
RESET ROLE;
SELECT vr.como('NOP_A'); SET ROLE authenticated;
SELECT vr.chk(vr.conteo(ARRAY['ASA_FIN','ASA_A2F']), '',
  'quien no es residente de esos condominios no recibe nada');
RESET ROLE;
SELECT vr.chk(has_function_privilege('anon', 'public.portal_conteo_votos_asambleas(uuid[])', 'EXECUTE')
              OR has_function_privilege('anon', 'public.residente_puede_votar(uuid, uuid)', 'EXECUTE'), false,
  'anon no ejecuta ninguna de las dos funciones');
