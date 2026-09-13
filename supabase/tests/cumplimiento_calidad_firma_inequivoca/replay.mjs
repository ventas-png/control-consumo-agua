#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Replay de la cadena COMPLETA desde una base vacía, con los privilegios de una
// Supabase Branch, y 20260913032502 sobre el esquema REAL.
// ════════════════════════════════════════════════════════════════════════════
// QUÉ DEMUESTRA, en este orden:
//
//   1. La cadena entera (todas las migraciones, bootstrap-branch.sql sin el
//      regalo de ALTER DEFAULT PRIVILEGES … ON FUNCTIONS) aplica limpia.
//   2. El trigger registros_calidad_cumplimiento queda en pg_catalog apuntando
//      a trg_registros_calidad_cumplimiento_catalogo(), BEFORE ROW
//      INSERT/UPDATE OF las cuatro columnas, y la ACL de la firma de tres
//      argumentos es la declarada (authenticated sí; PUBLIC y anon no).
//   3. Re-aplicar la migración sobre el esquema reconstruido es un no-op:
//      no falla y conserva los OIDs del trigger y de la función.
//   4. Comportamiento REAL como `authenticated` contra las policies REALES
//      (20260521000003, 20260519000009, S23): INSERT que calcula en el
//      servidor y pisa lo del cliente, UPDATE que recalcula, override de la
//      empresa correcta, fallback global, fuente ajena rechazada, override
//      ajeno inalcanzable por RPC, anon sin RPC nueva. Todo en una
//      transacción que se revierte.
//   5. Restaurar la llamada ambigua (re-apuntar el trigger a la función de
//      S22) devuelve el 42725: la corrección es lo único que lo separa.
//   6. Lo que no debía moverse no se movió: la sobrecarga de dos argumentos y
//      la función vieja siguen ahí, con su ACL, y sin consumidores.
//
// El arnés run.sh prueba lo mismo sobre un fixture con los archivos reales de
// S22/S23 y agrega los abortos y las mutaciones; este archivo es la prueba de
// que la migración aplica sobre la cadena real y de que las policies REALES
// dejan pasar lo que tiene que pasar y cortan lo que tiene que cortar.
//
// Uso:  node supabase/tests/cumplimiento_calidad_firma_inequivoca/replay.mjs
// Requiere binarios de PostgreSQL ≥ 14. No toca ningún proyecto remoto.
// ════════════════════════════════════════════════════════════════════════════

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { binarios, reconstruir } from '../../../scripts/schema-drift/reconstruir.mjs'

const ARCHIVO = '20260913032502_corregir_llamada_ambigua_cumplimiento_calidad.sql'
const MIGRACION = join('supabase/migrations', ARCHIVO)
const DEF_ESPERADA = 'CREATE TRIGGER registros_calidad_cumplimiento BEFORE INSERT OR UPDATE OF parametros, fuente_id, cumplimiento, cumple_total ON public.registros_calidad FOR EACH ROW EXECUTE FUNCTION trg_registros_calidad_cumplimiento_catalogo()'

let fallos = 0
const ok = (m) => console.log(`  OK    ${m}`)
const mal = (m) => { console.error(`  ✗     ${m}`); fallos++ }

console.log('── 1/6 · la cadena completa desde cero, con privilegios de Supabase Branch ──')
const db = reconstruir({ bootstrap: 'bootstrap-branch.sql' })
try {
  if (db.fallos.length > 0) {
    for (const f of db.fallos) mal(`${f.migracion}\n        ${f.error}`)
    throw new Error('la cadena no aplica limpia; no tiene sentido seguir')
  }
  ok(`${db.migraciones.length} de ${db.migraciones.length} migraciones aplicadas sobre una base vacía`)
  if (!db.migraciones.includes(ARCHIVO)) { mal(`la cadena no incluye ${ARCHIVO}`); throw new Error('falta la migración') }

  const sql = (q) => db.psql(['-qtAF', '|', '-v', 'ON_ERROR_STOP=1', '-c', q], { stdio: 'pipe' }).trim()

  console.log('── 2/6 · el trigger y la ACL, celda por celda, en pg_catalog ───────────')
  const celdas = () => sql(`
    SET search_path = public;
    SELECT count(*) OVER (), t.oid, t.tgrelid::regclass, t.tgfoid::regprocedure, t.tgfoid, t.tgtype, t.tgenabled, t.tgnargs,
           (t.tgqual IS NOT NULL), t.tgconstraint,
           (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM unnest(t.tgattr::int2[]) k JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = k),
           pg_get_triggerdef(t.oid),
           (SELECT prosecdef FROM pg_proc WHERE oid = t.tgfoid),
           (SELECT array_to_string(proconfig, ';') FROM pg_proc WHERE oid = t.tgfoid)
      FROM pg_trigger t WHERE t.tgname = 'registros_calidad_cumplimiento' AND NOT t.tgisinternal`)
  const filas = celdas().split('\n').filter(Boolean)
  let oidTrg = null, oidFn = null
  if (filas.length !== 1) mal(`${filas.length} trigger(s) llamados registros_calidad_cumplimiento, debía haber exactamente 1`)
  else {
    const [n, oid, tabla, fn, fnoid, tgtype, tgenabled, tgnargs, conWhen, tgconstraint, cols, def, secdef, conf] = filas[0].split('|')
    oidTrg = oid; oidFn = fnoid
    const esperado = { n: '1', tabla: 'registros_calidad', fn: 'trg_registros_calidad_cumplimiento_catalogo()', tgtype: '23', tgenabled: 'O', tgnargs: '0', conWhen: 'f', tgconstraint: '0', cols: 'cumple_total,cumplimiento,fuente_id,parametros', secdef: 'f', conf: 'search_path=""' }
    const medido = { n, tabla, fn, tgtype, tgenabled, tgnargs, conWhen, tgconstraint, cols, secdef, conf }
    const malas = Object.keys(esperado).filter((k) => medido[k] !== esperado[k])
    if (malas.length > 0) mal(`registros_calidad_cumplimiento: ${malas.map((k) => `${k}=${medido[k]} (esperado ${esperado[k]})`).join(', ')}`)
    else ok('registros_calidad_cumplimiento ON registros_calidad → trg_registros_calidad_cumplimiento_catalogo() · tgtype=23 (ROW|BEFORE|INSERT|UPDATE) · UPDATE OF cumple_total,cumplimiento,fuente_id,parametros · O · INVOKER · search_path=\'\'')
    if (def !== DEF_ESPERADA) mal(`pg_get_triggerdef = «${def}»\n        esperado «${DEF_ESPERADA}»`)
    else ok('pg_get_triggerdef exacto')
  }
  const orden = sql(`SELECT string_agg(tgname, ' → ' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.registros_calidad'::regclass AND NOT tgisinternal AND (tgtype & 3) = 3`)
  if (orden === 'registros_calidad_cumplimiento → registros_calidad_fill_company_id → trg_sellar_creado_por') ok(`orden de los BEFORE ROW: ${orden}`)
  else mal(`orden de los BEFORE ROW inesperado: ${orden}`)

  const acl = (firma) => sql(`
    SELECT p.prosecdef, p.provolatile,
           has_function_privilege('public', p.oid, 'EXECUTE'),
           has_function_privilege('anon', p.oid, 'EXECUTE'),
           has_function_privilege('authenticated', p.oid, 'EXECUTE'),
           has_function_privilege('service_role', p.oid, 'EXECUTE')
      FROM pg_proc p WHERE p.oid = '${firma}'::regprocedure`)
  const acl3 = acl('public.calcular_cumplimiento_calidad(text, jsonb, uuid)')
  if (acl3 === 'f|s|f|f|t|t') ok('calcular_cumplimiento_calidad(text, jsonb, uuid): INVOKER · STABLE · PUBLIC=false · anon=false · authenticated=true · service_role=true')
  else mal(`calcular_cumplimiento_calidad(text, jsonb, uuid): prosecdef|volatil|PUBLIC|anon|authenticated|service_role = ${acl3} (esperado f|s|f|f|t|t)`)
  const aclNueva = acl('public.trg_registros_calidad_cumplimiento_catalogo()')
  if (aclNueva === 'f|v|f|f|f|t') ok('trg_registros_calidad_cumplimiento_catalogo(): INVOKER · PUBLIC=false · anon=false · authenticated=false · service_role=true')
  else mal(`trg_registros_calidad_cumplimiento_catalogo(): ${aclNueva} (esperado f|v|f|f|f|t)`)

  console.log('── 3/6 · re-aplicar la migración sobre el esquema reconstruido: no-op ──')
  const r = spawnSync(join(binarios(), 'psql'), ['-v', 'ON_ERROR_STOP=1', '-q', '-1', '-f', MIGRACION],
    { encoding: 'utf8', env: { ...db.entorno, PGOPTIONS: '-c client_min_messages=notice' } })
  if (r.status !== 0) mal(`re-aplicar falló:\n${String(r.stderr ?? '').trim().split('\n').slice(-3).join('\n')}`)
  else ok('re-aplicar no falla')
  const [oidTrg2, oidFn2] = sql(`SELECT t.oid, t.tgfoid FROM pg_trigger t WHERE t.tgname = 'registros_calidad_cumplimiento' AND NOT t.tgisinternal`).split('|')
  if (oidTrg && oidTrg2 === oidTrg) ok(`mismo OID del trigger tras re-aplicar (${oidTrg}) — CREATE OR REPLACE TRIGGER no hizo DROP/CREATE`)
  else mal(`el OID del trigger cambió al re-aplicar (${oidTrg} → ${oidTrg2})`)
  if (oidFn && oidFn2 === oidFn) ok(`mismo OID de la función tras re-aplicar (${oidFn})`)
  else mal(`el OID de la función cambió al re-aplicar (${oidFn} → ${oidFn2})`)

  console.log('── 4/6 · comportamiento real como authenticated, contra las policies REALES ──')
  // Dos tenants y un admin de cada uno, dentro de la MISMA transacción que las
  // pruebas; al final ROLLBACK. Los usuarios existen en auth.users porque
  // trg_sellar_creado_por sella created_by = auth.uid() con FK a auth.users.
  // `admin` pasa todas las ramas de las policies reales (user_has_permission
  // devuelve true para admin/company_owner). Cada caso corre en un DO con
  // EXCEPTION y deja su resultado en un GUC de la transacción.
  const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const UA = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', UB = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'
  const FA = 'fa0f0f0f-0000-4000-8000-00000000a001', FB = 'fb0f0f0f-0000-4000-8000-00000000b001'
  const RA = '0a0a0a0a-0000-4000-8000-000000000001', RB = '0b0b0b0b-0000-4000-8000-000000000001'
  const como = (uid) => `RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', true); SET LOCAL ROLE authenticated;`
  const caso = (clave, cuerpo) => `
    DO $c$ BEGIN ${cuerpo} PERFORM set_config('replay.${clave}', 'OK', true);
    EXCEPTION WHEN OTHERS THEN PERFORM set_config('replay.${clave}', SQLSTATE || ' ' || SQLERRM, true); END $c$;`
  const prueba = `
    BEGIN;
    INSERT INTO auth.users (id, aud, role, email) VALUES
      ('${UA}', 'authenticated', 'authenticated', 'admin.a@ejemplo.test'),
      ('${UB}', 'authenticated', 'authenticated', 'admin.b@ejemplo.test');
    INSERT INTO public.companies (id, nombre) VALUES ('${A}', 'Empresa A'), ('${B}', 'Empresa B');
    INSERT INTO public.app_users (id, role, company_id) VALUES ('${UA}', 'admin', '${A}'), ('${UB}', 'admin', '${B}');
    INSERT INTO public.fuentes_agua (id, identificador, nombre, tipo_agua, company_id) VALUES
      ('${FA}', 'FA_POT', 'Tanque potable A', 'potable', '${A}'),
      ('${FB}', 'FB_POT', 'Tanque potable B', 'potable', '${B}');
    INSERT INTO public.calidad_tipologias (tipo_agua, company_id, label, parametros, activo) VALUES
      ('potable', '${B}', 'Potable (B, más estricta)', '[{"key":"pH","label":"pH","unidad":"","min":7.0,"max":7.2}]'::jsonb, true);

    ${como(UA)}
    ${caso('a_insert', `INSERT INTO public.registros_calidad (id, fuente_id, parametros, cumplimiento, cumple_total)
      VALUES ('${RA}', '${FA}', '{"pH": 7.5, "turbiedad": 2}'::jsonb, '{"pH": false, "inventado": true}'::jsonb, false);`)}
    SELECT 'a_fila=' || coalesce((SELECT company_id::text || ' ' || cumple_total::text || ' ' || (cumplimiento ->> 'pH') || ' ' || (cumplimiento ? 'inventado')::text
      FROM public.registros_calidad WHERE id = '${RA}'), 'sin-fila');
    ${caso('a_update', `UPDATE public.registros_calidad SET parametros = '{"pH": 9.5, "turbiedad": 2}'::jsonb WHERE id = '${RA}';`)}
    SELECT 'a_tras_update=' || coalesce((SELECT cumple_total::text || ' ' || (cumplimiento ->> 'pH') FROM public.registros_calidad WHERE id = '${RA}'), 'sin-fila');
    ${caso('a_mano', `UPDATE public.registros_calidad SET cumple_total = true WHERE id = '${RA}';`)}
    SELECT 'a_tras_mano=' || coalesce((SELECT cumple_total::text FROM public.registros_calidad WHERE id = '${RA}'), 'sin-fila');
    ${caso('a_fuente_ajena', `INSERT INTO public.registros_calidad (fuente_id, parametros) VALUES ('${FB}', '{"pH": 7.5}'::jsonb);`)}
    ${caso('a_company_ajeno', `INSERT INTO public.registros_calidad (fuente_id, parametros, company_id) VALUES ('${FA}', '{"pH": 7.5}'::jsonb, '${B}');`)}
    SELECT 'a_rpc_override_b=' || (public.calcular_cumplimiento_calidad('potable', '{"pH": 7.5}'::jsonb, '${B}') ->> 'cumple_total');
    SELECT 'a_ve_override_b=' || (SELECT count(*) FROM public.calidad_tipologias WHERE company_id = '${B}');

    ${como(UB)}
    ${caso('b_insert', `INSERT INTO public.registros_calidad (id, fuente_id, parametros) VALUES ('${RB}', '${FB}', '{"pH": 7.5}'::jsonb);`)}
    SELECT 'b_fila=' || coalesce((SELECT company_id::text || ' ' || cumple_total::text || ' ' || (cumplimiento ->> 'pH') FROM public.registros_calidad WHERE id = '${RB}'), 'sin-fila');
    SELECT 'b_rpc_propio=' || (public.calcular_cumplimiento_calidad('potable', '{"pH": 7.5}'::jsonb, '${B}') ->> 'cumple_total');
    SELECT 'b_ve_filas=' || (SELECT count(*) FROM public.registros_calidad);

    RESET ROLE; SET LOCAL ROLE anon;
    ${caso('anon_rpc', `PERFORM public.calcular_cumplimiento_calidad('potable', '{}'::jsonb, NULL::uuid);`)}
    RESET ROLE;
    SELECT 'r_' || k || '=' || coalesce(current_setting('replay.' || k, true), 'sin-dato')
      FROM unnest(ARRAY['a_insert','a_update','a_mano','a_fuente_ajena','a_company_ajeno','b_insert','anon_rpc']) k;
    ROLLBACK;
    SELECT 'restantes=' || ((SELECT count(*) FROM public.registros_calidad) + (SELECT count(*) FROM public.fuentes_agua) + (SELECT count(*) FROM public.calidad_tipologias WHERE company_id IS NOT NULL));`
  let lineas = []
  try {
    lineas = db.psql(['-tAq', '-v', 'ON_ERROR_STOP=1', '-c', prueba], { stdio: 'pipe' }).trim().split('\n').filter(Boolean)
  } catch (err) {
    mal(`la transacción de prueba falló:\n${String(err.stderr ?? err.message).trim().split('\n').slice(-12).join('\n')}`)
  }
  const valor = (k) => (lineas.find((l) => l.startsWith(k + '=')) ?? '').slice(k.length + 1)
  const espera = (k, v, msg) => (valor(k) === v ? ok(msg) : mal(`${msg} — ${k}=«${valor(k)}», esperado «${v}»`))
  const esperaPrefijo = (k, v, msg) => (valor(k).startsWith(v) ? ok(`${msg}: ${valor(k)}`) : mal(`${msg} — ${k}=«${valor(k)}», esperado que empiece por «${v}»`))
  espera('r_a_insert', 'OK', 'A · INSERT como authenticated termina bien (policies reales, sin company_id)')
  espera('a_fila', `${A} true true false`, 'A · company_id de A, cumple_total=true, pH=true (el cliente mandó false), sin la clave inventada')
  espera('r_a_update', 'OK', 'A · UPDATE de parametros termina bien')
  espera('a_tras_update', 'false false', 'A · UPDATE de parametros: pH 9.5 → cumple_total=false, pH=false')
  espera('r_a_mano', 'OK', 'A · UPDATE SET cumple_total = true a mano termina bien…')
  espera('a_tras_mano', 'false', 'A · …y el servidor lo vuelve a false')
  esperaPrefijo('r_a_fuente_ajena', '42501 registros_calidad: la fuente', 'A · fuente de B rechazada por la función de trigger (42501)')
  esperaPrefijo('r_a_company_ajeno', '42501', 'A · company_id de B rechazado por la RLS real (42501)')
  espera('a_rpc_override_b', 'true', 'A · RPC con el company_id de B: cae al global (el override de B es invisible)')
  espera('a_ve_override_b', '0', 'A · no ve el override de B en calidad_tipologias')
  espera('r_b_insert', 'OK', 'B · INSERT como authenticated termina bien')
  espera('b_fila', `${B} false false`, 'B · su override manda: pH 7.5 no cumple [7.0, 7.2] → cumple_total=false')
  espera('b_rpc_propio', 'false', 'B · RPC con su propio company_id: su override (false)')
  espera('b_ve_filas', '1', 'B · sólo ve su propia fila de registros_calidad')
  esperaPrefijo('r_anon_rpc', '42501', 'anon · sigue sin poder llamar a calcular_cumplimiento_calidad(text, jsonb, uuid)')
  espera('restantes', '0', 'la transacción se revirtió: no queda ninguna fila')

  console.log('── 5/6 · restaurar la llamada ambigua devuelve el 42725 ───────────────')
  const mut = `
    BEGIN;
    CREATE OR REPLACE TRIGGER registros_calidad_cumplimiento BEFORE INSERT OR UPDATE OF parametros, fuente_id
      ON public.registros_calidad FOR EACH ROW EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento();
    INSERT INTO public.companies (id, nombre) VALUES ('${A}', 'Empresa A');
    INSERT INTO public.fuentes_agua (id, identificador, nombre, tipo_agua, company_id) VALUES ('${FA}', 'FA_POT', 'Tanque', 'potable', '${A}');
    ${caso('mut', `INSERT INTO public.registros_calidad (fuente_id, parametros, company_id) VALUES ('${FA}', '{"pH": 7.5}'::jsonb, '${A}');`)}
    SELECT 'mut=' || coalesce(current_setting('replay.mut', true), 'sin-dato');
    ROLLBACK;
    SELECT 'fn_tras_rollback=' || (SELECT tgfoid::regprocedure::text FROM pg_trigger WHERE tgname = 'registros_calidad_cumplimiento' AND NOT tgisinternal);`
  try {
    lineas = db.psql(['-tAq', '-v', 'ON_ERROR_STOP=1', '-c', mut], { stdio: 'pipe' }).trim().split('\n').filter(Boolean)
  } catch (err) {
    lineas = []; mal(`la mutación falló fuera del caso:\n${String(err.stderr ?? err.message).trim().split('\n').slice(-6).join('\n')}`)
  }
  esperaPrefijo('mut', '42725', 'con el trigger apuntando a la función de S22, el INSERT vuelve a morir')
  espera('fn_tras_rollback', 'trg_registros_calidad_cumplimiento_catalogo()', 'la mutación se revirtió: el trigger sigue apuntando a la función nueva')

  console.log('── 6/6 · lo que no debía moverse ─────────────────────────────────────')
  const acl2 = acl('public.calcular_cumplimiento_calidad(text, jsonb)')
  if (acl2 === 'f|i|t|t|t|t') ok('calcular_cumplimiento_calidad(text, jsonb) sigue: INVOKER · IMMUTABLE · ACL de S22 (PUBLIC)')
  else mal(`calcular_cumplimiento_calidad(text, jsonb): ${acl2} (esperado f|i|t|t|t|t)`)
  const huerfanos = sql(`SELECT count(*) FROM pg_trigger WHERE tgfoid = 'public.trg_registros_calidad_cumplimiento()'::regprocedure`)
  if (huerfanos === '0') ok('trg_registros_calidad_cumplimiento() sigue existiendo y ningún trigger la ejecuta')
  else mal(`${huerfanos} trigger(s) siguen ejecutando trg_registros_calidad_cumplimiento()`)
} catch (err) {
  mal(err.message)
} finally {
  db.destruir()
}

if (fallos > 0) { console.error(`\n❌ replay: ${fallos} fallo(s)`); process.exit(1) }
console.log('\n✅ replay: la cadena completa desde cero, el trigger re-apuntado y el comportamiento real como authenticated')
