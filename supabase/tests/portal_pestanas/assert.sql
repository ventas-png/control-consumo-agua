-- ============================================================================
-- INVARIANTES de 20261106000000 sobre el padrón (fixture.sql, cargado ANTES de
-- la migración).
--
-- El propietario (y el administrador) de la empresa apaga pestañas del portal
-- en SUS condominios; nadie más. El residente lee la configuración de los
-- condominios de su empresa y de ningún otro. La base sólo admite ids del
-- portal y nunca deja apagar Mi Unidad.
-- ============================================================================
\set ON_ERROR_STOP on

-- ── Los condominios de siempre quedan con «nada apagado» ────────────────────
SELECT pp.chk((SELECT portal_tabs_ocultos FROM public.projects WHERE id = pp.id('A1')), '{}'::text[],
  'un condominio que ya existía queda con la lista vacía: el portal se ve como antes');

-- ── Quién escribe ───────────────────────────────────────────────────────────
SELECT pp.como('OWN_A'); SET ROLE authenticated;
SELECT pp.chk(pp.apaga('A1', '{rentas,paquetes}'), 'ok:1',
  'el propietario de A apaga pestañas en su condominio A1');
SELECT pp.chk(pp.apaga('B1', '{rentas}'), 'ok:0',
  'el propietario de A NO toca un condominio de otra empresa (B1)');
RESET ROLE;

SELECT pp.como('ADM_A'); SET ROLE authenticated;
SELECT pp.chk(pp.apaga('A1', '{rentas}'), 'ok:1',
  'el administrador de A también');
RESET ROLE;

SELECT pp.como('OPE_A'); SET ROLE authenticated;
SELECT pp.chk(pp.apaga('A1', '{rentas}'), 'ok:0',
  'el personal (operator) de A NO puede apagar pestañas');
RESET ROLE;

SELECT pp.como('OWN_B'); SET ROLE authenticated;
SELECT pp.chk(pp.apaga('A1', '{rentas}'), 'ok:0',
  'el propietario de B NO toca el condominio A1');
RESET ROLE;

SELECT pp.como('RES_A'); SET ROLE authenticated;
SELECT pp.chk(pp.apaga('A1', '{}'), 'ok:0',
  'el residente NO se enciende las pestañas que la empresa apagó');
RESET ROLE;

SELECT pp.como('SUP'); SET ROLE authenticated;
SELECT pp.chk(pp.apaga('B1', '{transparencia}'), 'ok:1',
  'el super_admin sí (soporte de plataforma)');
RESET ROLE;

SELECT pp.como(NULL); SET ROLE anon;
SELECT pp.chk(pp.apaga('A1', '{rentas}') IN ('ok:0', '42501'), true,
  'anon no escribe');
RESET ROLE;

-- ── El CHECK ────────────────────────────────────────────────────────────────
SELECT pp.como('OWN_A'); SET ROLE authenticated;
SELECT pp.chk(pp.apaga('A1', '{mi_unidad}'), '23514',
  'Mi Unidad no se puede apagar');
SELECT pp.chk(pp.apaga('A1', '{rentas,no_existe}'), '23514',
  'un id que no es del portal se rechaza');
SELECT pp.chk(pp.intenta('UPDATE public.projects SET portal_tabs_ocultos = NULL WHERE id = $1', pp.id('A1')), '23502',
  'NULL no: «nada apagado» es la lista vacía');
SELECT pp.chk(pp.apaga('A1', '{reservas,cuenta,tickets,visitantes,paquetes,correspondencia,anuncios,asambleas,transparencia,rentas,mudanza,mascotas,vehiculos}'), 'ok:1',
  'se pueden apagar todas las demás (el portal se queda con Mi Unidad)');
RESET ROLE;

-- Lo que queda guardado, de verdad (fuera de pp.intenta).
SELECT pp.como('OWN_A'); SET ROLE authenticated;
UPDATE public.projects SET portal_tabs_ocultos = '{rentas,paquetes}' WHERE id = pp.id('A1');
RESET ROLE;
SELECT pp.como('OWN_B'); SET ROLE authenticated;
UPDATE public.projects SET portal_tabs_ocultos = '{transparencia}' WHERE id = pp.id('B1');
RESET ROLE;

-- ── Quién lee ───────────────────────────────────────────────────────────────
SELECT pp.como('RES_A'); SET ROLE authenticated;
SELECT pp.chk(pp.lee('A1'), '{rentas,paquetes}'::text[],
  'el residente de A lee lo que apagó la empresa en su condominio');
SELECT pp.chk(pp.ve('B1'), false,
  'el residente de A no ve el condominio de otra empresa');
RESET ROLE;

SELECT pp.como('RES_B'); SET ROLE authenticated;
SELECT pp.chk(pp.ve('A1'), false,
  'el residente de B no ve la configuración de A1');
SELECT pp.chk(pp.lee('B1'), '{transparencia}'::text[],
  'y sí la de su propio condominio');
RESET ROLE;
