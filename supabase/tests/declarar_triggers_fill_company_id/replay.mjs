#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Replay de la cadena COMPLETA desde una base vacía, con los privilegios de una
// Supabase Branch, y los dos triggers de 20260912015504 sobre el esquema REAL.
// ════════════════════════════════════════════════════════════════════════════
// QUÉ DEMUESTRA, en este orden:
//
//   1. La cadena entera (todas las migraciones, bootstrap-branch.sql sin el
//      regalo de ALTER DEFAULT PRIVILEGES … ON FUNCTIONS) aplica limpia.
//   2. Los dos triggers quedan en pg_catalog con la definición exacta de
//      producción, celda por celda y byte a byte en pg_get_triggerdef.
//   3. Re-aplicar 20260912015504 sobre el esquema ya reconstruido es un no-op:
//      no falla y conserva los OIDs.
//   4. Inserciones REALES y transaccionales como `authenticated` —que no tiene
//      EXECUTE sobre fill_company_id_from_user()— en fuentes_agua y
//      registros_calidad, contra las policies REALES de 20260521000003: la
//      fila entra sin company_id y sale con el del usuario. Es el comportamiento
//      que producción tenía y la reconstrucción no.
//   5. La ACL y el SECURITY DEFINER de la función no se movieron.
//
// El arnés run.sh prueba lo mismo sobre un fixture mínimo y agrega los casos
// negativos (homónimos, mutación); este archivo es la prueba de que la
// migración puede CREAR los triggers en la cadena real, que es lo que una
// Preview —donde ya existen— no puede demostrar.
//
// Uso:  node supabase/tests/declarar_triggers_fill_company_id/replay.mjs
// Requiere binarios de PostgreSQL. No toca ningún proyecto remoto.
// ════════════════════════════════════════════════════════════════════════════

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { binarios, reconstruir } from '../../../scripts/schema-drift/reconstruir.mjs'

const MIGRACION = join('supabase/migrations', '20260912015504_declarar_triggers_fill_company_id.sql')

const TRIGGERS = [
  { tabla: 'public.fuentes_agua',      trigger: 'fuentes_agua_fill_company_id',
    def: 'CREATE TRIGGER fuentes_agua_fill_company_id BEFORE INSERT ON public.fuentes_agua FOR EACH ROW EXECUTE FUNCTION fill_company_id_from_user()' },
  { tabla: 'public.registros_calidad', trigger: 'registros_calidad_fill_company_id',
    def: 'CREATE TRIGGER registros_calidad_fill_company_id BEFORE INSERT ON public.registros_calidad FOR EACH ROW EXECUTE FUNCTION fill_company_id_from_user()' },
]

let fallos = 0
const ok = (m) => console.log(`  OK    ${m}`)
const mal = (m) => { console.error(`  ✗     ${m}`); fallos++ }

console.log('── 1/5 · la cadena completa desde cero, con privilegios de Supabase Branch ──')
const db = reconstruir({ bootstrap: 'bootstrap-branch.sql' })
try {
  if (db.fallos.length > 0) {
    for (const f of db.fallos) mal(`${f.migracion}\n        ${f.error}`)
    throw new Error('la cadena no aplica limpia; no tiene sentido seguir')
  }
  ok(`${db.migraciones.length} de ${db.migraciones.length} migraciones aplicadas sobre una base vacía`)
  if (!db.migraciones.includes('20260912015504_declarar_triggers_fill_company_id.sql')) {
    mal('la cadena no incluye 20260912015504'); throw new Error('falta la migración')
  }

  const sql = (q) => db.psql(['-qtAF', '|', '-v', 'ON_ERROR_STOP=1', '-c', q], { stdio: 'pipe' }).trim()

  console.log('── 2/5 · los dos triggers, celda por celda, en pg_catalog ──────────────')
  const celdas = (t) => sql(`
    SET search_path = public;
    SELECT count(*) OVER (), t.oid,
           (SELECT n.nspname || '.' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = t.tgrelid),
           t.tgfoid::regprocedure, t.tgtype, t.tgenabled, t.tgnargs,
           (t.tgqual IS NOT NULL), t.tgconstraint, t.tgdeferrable, t.tginitdeferred,
           (t.tgoldtable IS NOT NULL OR t.tgnewtable IS NOT NULL), pg_get_triggerdef(t.oid)
      FROM pg_trigger t WHERE t.tgname = '${t}' AND NOT t.tgisinternal`)
  const oidsAntes = {}
  for (const e of TRIGGERS) {
    const filas = celdas(e.trigger).split('\n').filter(Boolean)
    if (filas.length !== 1) { mal(`${e.trigger}: ${filas.length} trigger(s) con ese nombre, debía haber exactamente 1`); continue }
    const [n, oid, tabla, fn, tgtype, tgenabled, tgnargs, conWhen, tgconstraint, defer, initdefer, transicion, def] = filas[0].split('|')
    oidsAntes[e.trigger] = oid
    const esperado = { tabla: e.tabla, fn: 'fill_company_id_from_user()', tgtype: '7', tgenabled: 'O', tgnargs: '0', conWhen: 'f', tgconstraint: '0', defer: 'f', initdefer: 'f', transicion: 'f' }
    const medido = { tabla, fn, tgtype, tgenabled, tgnargs, conWhen, tgconstraint, defer, initdefer, transicion }
    const malas = Object.keys(esperado).filter((k) => medido[k] !== esperado[k])
    if (n !== '1' || malas.length > 0) {
      mal(`${e.trigger}: ${malas.map((k) => `${k}=${medido[k]} (esperado ${esperado[k]})`).join(', ')}`)
    } else {
      ok(`${e.trigger} ON ${tabla}: fn=${fn} · tgtype=7 (ROW|BEFORE|INSERT) · tgenabled=O · sin args · sin WHEN · no constraint · sin transición`)
    }
    if (def !== e.def) mal(`${e.trigger}: pg_get_triggerdef = «${def}»\n        esperado «${e.def}»`)
    else ok(`${e.trigger}: pg_get_triggerdef byte a byte igual al de producción`)
  }

  console.log('── 3/5 · re-aplicar la migración sobre el esquema reconstruido: no-op ──')
  // Los NOTICE de la migración salen por stderr: se capturan para exigir que
  // anuncie el no-op de los DOS triggers, y después se comparan los OIDs.
  let avisos = ''
  try {
    const r = spawnSync(join(binarios(), 'psql'), ['-v', 'ON_ERROR_STOP=1', '-q', '-1', '-f', MIGRACION],
      { encoding: 'utf8', env: { ...db.entorno, PGOPTIONS: '-c client_min_messages=notice' } })
    avisos = String(r.stderr ?? '')
    if (r.status !== 0) mal(`re-aplicar falló:\n${avisos.trim().split('\n').slice(-3).join('\n')}`)
  } catch (err) {
    mal(`re-aplicar falló: ${err.message}`)
  }
  const noops = (avisos.match(/no-op/g) ?? []).length
  if (noops === 2) ok('la migración anunció «ya existe con la definición exacta — no-op» para los dos')
  else mal(`la migración anunció ${noops} no-op(s) y debían ser 2:\n${avisos.trim()}`)
  for (const e of TRIGGERS) {
    const oid = sql(`SELECT oid FROM pg_trigger WHERE tgname = '${e.trigger}' AND NOT tgisinternal`)
    if (oid === oidsAntes[e.trigger]) ok(`${e.trigger}: mismo OID tras re-aplicar (${oid}) — no hubo DROP/CREATE`)
    else mal(`${e.trigger}: el OID cambió al re-aplicar (${oidsAntes[e.trigger]} → ${oid})`)
  }

  console.log('── 4/5 · inserciones reales y transaccionales como authenticated ───────')
  // Un tenant y un admin de ese tenant, dentro de la MISMA transacción que las
  // inserciones; al final ROLLBACK. Las policies son las reales:
  // fuentes_agua_insert / registros_calidad_insert exigen
  // company_id = get_my_company_id(), y la fila se inserta SIN company_id.
  // El usuario existe también en auth.users porque 20260731000000 (trazabilidad)
  // sella `creado_por = auth.uid()` con FK a auth.users.
  const prueba = `
    BEGIN;
    INSERT INTO auth.users (id, aud, role, email)
      VALUES ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'admin.replay@ejemplo.test');
    INSERT INTO public.companies (id, nombre) VALUES ('44444444-4444-4444-4444-444444444444', 'Tenant de prueba');
    INSERT INTO public.app_users (id, role, company_id)
      VALUES ('33333333-3333-3333-3333-333333333333', 'admin', '44444444-4444-4444-4444-444444444444');
    SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
    SELECT set_config('request.jwt.claim.role', 'authenticated', true);
    SELECT 'auth_execute=' || has_function_privilege('authenticated', 'public.fill_company_id_from_user()'::regprocedure, 'EXECUTE');

    -- CONTROL de un defecto PREEXISTENTE y AJENO a este PR. En una
    -- reconstrucción limpia, CUALQUIER INSERT en registros_calidad —con
    -- cualquier rol— muere dentro de trg_registros_calidad_cumplimiento:
    --   function public.calcular_cumplimiento_calidad(text, jsonb) is not unique
    -- porque el repositorio declara dos sobrecargas, (text, jsonb) en
    -- 20260603140000 y (text, jsonb, uuid DEFAULT NULL) en 20260605160000, y
    -- la llamada de dos argumentos del trigger es ambigua (SQLSTATE 42725).
    -- NO es sólo de la reconstrucción: producción tiene las mismas dos
    -- sobrecargas y el mismo SELECT de dos argumentos falla allí con 42725
    -- (medido el 2026-09-12). Corregirlo es otro PR. Aquí se comprueba que el
    -- defecto SIGUE AHÍ, como postgres y ANTES de cambiar de rol, y sólo
    -- entonces se apaga ESE trigger —dentro de esta transacción, que se
    -- revierte— para poder medir el de fill_company_id. El día que el defecto
    -- se corrija, este control deja de fallar y la prueba avisa: hay que
    -- retirar el DISABLE TRIGGER de abajo.
    DO $control$
    BEGIN
      INSERT INTO public.fuentes_agua (id, identificador, nombre, tipo_agua, company_id)
        VALUES ('77777777-7777-7777-7777-777777777777', 'F-CONTROL', 'Pozo control', 'pozo', '44444444-4444-4444-4444-444444444444');
      INSERT INTO public.registros_calidad (id, fuente_id, parametros, company_id)
        VALUES ('88888888-8888-8888-8888-888888888888', '77777777-7777-7777-7777-777777777777', '{}'::jsonb, '44444444-4444-4444-4444-444444444444');
      PERFORM set_config('replay.control', 'ya-no-falla', true);
    EXCEPTION WHEN ambiguous_function THEN
      PERFORM set_config('replay.control', 'ambiguo', true);
    END $control$;
    SELECT 'control=' || coalesce(current_setting('replay.control', true), 'sin-dato');
    ALTER TABLE public.registros_calidad DISABLE TRIGGER registros_calidad_cumplimiento;

    SET LOCAL ROLE authenticated;
    INSERT INTO public.fuentes_agua (id, identificador, nombre, tipo_agua)
      VALUES ('55555555-5555-5555-5555-555555555555', 'F-REPLAY', 'Pozo replay', 'pozo');
    INSERT INTO public.registros_calidad (id, fuente_id, parametros)
      VALUES ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', '{"ph": 7.1}'::jsonb);
    RESET ROLE;
    SELECT 'fuentes_agua=' || coalesce(company_id::text, 'NULL') FROM public.fuentes_agua WHERE id = '55555555-5555-5555-5555-555555555555';
    SELECT 'registros_calidad=' || coalesce(company_id::text, 'NULL') FROM public.registros_calidad WHERE id = '66666666-6666-6666-6666-666666666666';
    ROLLBACK;
    SELECT 'restantes=' || ((SELECT count(*) FROM public.fuentes_agua) + (SELECT count(*) FROM public.registros_calidad));`
  let lineas = []
  try {
    lineas = db.psql(['-tAq', '-v', 'ON_ERROR_STOP=1', '-c', prueba], { stdio: 'pipe' }).trim().split('\n').filter(Boolean)
  } catch (err) {
    mal(`las inserciones como authenticated fallaron:\n${String(err.stderr ?? err.message).trim().split("\n").slice(-12).join("\n")}`)
  }
  const valor = (k) => (lineas.find((l) => l.startsWith(k + '=')) ?? '').slice(k.length + 1)
  if (valor('auth_execute') === 'false') ok('authenticated NO tiene EXECUTE sobre fill_company_id_from_user() (ACL de 20260911223000)')
  else mal(`authenticated tiene EXECUTE=${valor('auth_execute')}; la prueba no demostraría nada`)
  if (valor('control') === 'ambiguo') {
    ok('control: el defecto PREEXISTENTE sigue ahí (calcular_cumplimiento_calidad(text, jsonb) es ambigua, 42725,')
    ok('      también en producción; ajeno a este PR) — registros_calidad_cumplimiento se apaga sólo dentro de esta transacción')
  } else {
    mal(`control: el INSERT de control en registros_calidad terminó en «${valor('control')}» y se esperaba el fallo ` +
        'preexistente por ambigüedad (42725). Si ese defecto ya se corrigió, retirá el DISABLE TRIGGER de esta prueba.')
  }
  for (const t of ['fuentes_agua', 'registros_calidad']) {
    if (valor(t) === '44444444-4444-4444-4444-444444444444') ok(`authenticated insertó en ${t} sin company_id y el trigger lo rellenó con el del usuario`)
    else mal(`${t}: company_id quedó en «${valor(t)}» tras insertar como authenticated`)
  }
  if (valor('restantes') === '0') ok('la transacción se revirtió: las dos tablas quedan vacías')
  else mal(`quedaron ${valor('restantes')} fila(s) tras el ROLLBACK`)

  console.log('── 5/5 · la función no se movió: SECURITY DEFINER y ACL de 20260911223000 ──')
  const acl = sql(`
    SELECT p.prosecdef,
           has_function_privilege('public', p.oid, 'EXECUTE'),
           has_function_privilege('anon', p.oid, 'EXECUTE'),
           has_function_privilege('authenticated', p.oid, 'EXECUTE'),
           has_function_privilege('service_role', p.oid, 'EXECUTE')
      FROM pg_proc p WHERE p.oid = 'public.fill_company_id_from_user()'::regprocedure`).split('|')
  if (acl.join('|') === 't|f|f|f|t') ok('SECURITY DEFINER · PUBLIC=false · anon=false · authenticated=false · service_role=true')
  else mal(`prosecdef|PUBLIC|anon|authenticated|service_role = ${acl.join('|')} (esperado t|f|f|f|t)`)
} catch (err) {
  mal(err.message)
} finally {
  db.destruir()
}

console.log('')
if (fallos > 0) {
  console.error(`❌ declarar_triggers_fill_company_id/replay: ${fallos} comprobación(es) fallaron.`)
  process.exit(1)
}
console.log('✅ la cadena reconstruye desde cero y los dos triggers quedan como en producción, con inserciones reales como authenticated.')
