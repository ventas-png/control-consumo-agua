-- ============================================================================
-- INVARIANTES de 20261104000450 sobre el padrón (fixture.sql).
--
-- El candado de plan de puntos y votos mira el plan de la empresa de la
-- ASAMBLEA (public.asambleas): con la feature asambleas_digitales se agregan
-- puntos y se vota; sin ella (otro plan, suscripción cancelada), no. Las
-- policies permisivas siguen decidiendo QUIÉN puede dentro de la empresa.
-- ============================================================================
\set ON_ERROR_STOP on

-- ── Con la feature: el panel vuelve a funcionar ─────────────────────────────
SELECT cp.como('ADM_A'); SET ROLE authenticated;
SELECT cp.chk(cp.agrega_punto('ASA_A'), true,
  'ADM_A (condominios_only) SÍ agrega un punto a su asamblea');
SELECT cp.chk(cp.vota('PUN_A', 'U_A'), true,
  'ADM_A SÍ registra un voto');
SELECT cp.chk(cp.vota_upsert('PUN_A', 'U_A'), true,
  'ADM_A SÍ registra un voto con el upsert del panel');
SELECT cp.chk(cp.vota_upsert('PUN_A', 'U_A2'), true,
  'ADM_A SÍ cambia un voto ya registrado (upsert sobre VOT_A)');
RESET ROLE;

SELECT cp.como('ADM_B'); SET ROLE authenticated;
SELECT cp.chk(cp.agrega_punto('ASA_B'), true,
  'ADM_B (trial) SÍ agrega un punto');
SELECT cp.chk(cp.vota_upsert('PUN_B', 'U_B'), true,
  'ADM_B (trial) SÍ registra un voto');
RESET ROLE;

SELECT cp.como('STF_A'); SET ROLE authenticated;
SELECT cp.chk(cp.agrega_punto('ASA_A'), true,
  'STF_A (ve Asambleas) SÍ agrega un punto');
SELECT cp.chk(cp.vota_upsert('PUN_A', 'U_A'), true,
  'STF_A (ve Votaciones) SÍ registra un voto');
RESET ROLE;

-- ── Sin la feature: el candado sigue cerrado ────────────────────────────────
SELECT cp.como('ADM_C'); SET ROLE authenticated;
SELECT cp.chk(cp.convoca('C'), true,
  'ADM_C (agua_only) SÍ convoca una asamblea: el candado no toca asambleas');
SELECT cp.chk(cp.agrega_punto('ASA_C'), false,
  'ADM_C (agua_only) NO agrega un punto');
SELECT cp.chk(cp.vota('PUN_C', 'U_C'), false,
  'ADM_C (agua_only) NO registra un voto');
SELECT cp.chk(cp.vota_upsert('PUN_C', 'U_C'), false,
  'ADM_C (agua_only) NO registra un voto con el upsert del panel');
RESET ROLE;

SELECT cp.como('ADM_D'); SET ROLE authenticated;
SELECT cp.chk(cp.agrega_punto('ASA_D'), false,
  'ADM_D (suscripción cancelada) NO agrega un punto');
SELECT cp.chk(cp.vota_upsert('PUN_D', 'U_D'), false,
  'ADM_D (suscripción cancelada) NO registra un voto');
RESET ROLE;

-- ── El plan es el de la empresa de la ASAMBLEA, no el de quien inserta ──────
-- SUP es de A (con la feature) y entra en cualquier empresa.
SELECT cp.como('SUP'); SET ROLE authenticated;
SELECT cp.chk(cp.agrega_punto('ASA_C'), false,
  'SUP (de A) NO agrega un punto a la asamblea de C: manda el plan de C');
SELECT cp.chk(cp.vota_upsert('PUN_C', 'U_C'), false,
  'SUP (de A) NO vota en un punto de C');
SELECT cp.chk(cp.agrega_punto('ASA_B'), true,
  'SUP SÍ agrega un punto a la asamblea de B (B tiene la feature)');
SELECT cp.chk(cp.vota_upsert('PUN_B', 'U_B'), true,
  'SUP SÍ vota en un punto de B');
RESET ROLE;

-- ── Las permisivas siguen decidiendo quién ──────────────────────────────────
SELECT cp.como('NOP_A'); SET ROLE authenticated;
SELECT cp.chk(cp.agrega_punto('ASA_A'), false,
  'NOP_A (de A, sin permisos) NO agrega un punto aunque A tenga la feature');
SELECT cp.chk(cp.vota_upsert('PUN_A', 'U_A'), false,
  'NOP_A NO registra un voto');
RESET ROLE;

SELECT cp.como('ADM_B'); SET ROLE authenticated;
SELECT cp.chk(cp.agrega_punto('ASA_A'), false,
  'ADM_B NO agrega un punto a la asamblea de otra empresa (A, con la feature)');
SELECT cp.chk(cp.vota_upsert('PUN_A', 'U_A'), false,
  'ADM_B NO vota en un punto de otra empresa');
RESET ROLE;

-- ── Forma de las policies ───────────────────────────────────────────────────
SELECT cp.chk(count(*) = 2, true,
  'quedan exactamente dos candados RESTRICTIVOS de INSERT, uno por tabla')
FROM pg_policies
WHERE tablename IN ('puntos_asamblea', 'votos_asamblea') AND permissive = 'RESTRICTIVE'
  AND cmd = 'INSERT' AND roles = ARRAY['authenticated']::name[];
