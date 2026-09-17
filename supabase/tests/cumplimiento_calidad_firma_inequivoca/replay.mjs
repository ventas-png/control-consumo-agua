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
//      INSERT/UPDATE OF las cuatro columnas, y la ACL de las tres funciones
//      (las dos nuevas y la sobrecarga de tres argumentos) es la declarada.
//   3. Re-aplicar la migración sobre el esquema reconstruido es un no-op:
//      no falla y conserva los OIDs del trigger y de las funciones.
//   4. Comportamiento REAL como `authenticated` ADMINISTRATIVO contra las
//      policies REALES (20260521000003, 20260519000009, S23): INSERT que
//      calcula en el servidor y pisa lo del cliente, UPDATE que recalcula,
//      override de la empresa correcta, fallback global, fuente ajena
//      rechazada, override ajeno inalcanzable por RPC, anon sin RPC nueva.
//   5. EL CONTRATO DE RBAC, con el RBAC REAL de la cadena (public.roles,
//      role_permissions, user_roles y user_has_permission de 20260518000008):
//      un `operator` de la empresa SIN `agua.calidad.view` —que no ve ni una
//      fila de fuentes_agua— guarda y edita su análisis y obtiene el cálculo
//      real, porque la fuente la resuelve agua_fuente_de_mi_empresa(uuid) y no
//      un SELECT amplio sobre la tabla. La fuente de otra empresa le sigue
//      dando 42501 y LEER registros_calidad le sigue estando vedado.
//   6. FAIL-CLOSED: doce mutantes del estado previo (trigger deshabilitado,
//      UPDATE OF alterado, función homónima con otro cuerpo, con otra ACL, la
//      acotada con otra ACL, en SECURITY INVOKER o sin search_path) hacen que
//      la migración ABORTE sin modificar una sola celda del esquema.
//   7. Restaurar la llamada ambigua (re-apuntar el trigger a la función de
//      S22) devuelve el 42725: la corrección es lo único que lo separa.
//   8. Lo que no debía moverse no se movió: la sobrecarga de dos argumentos y
//      la función vieja siguen ahí, con su ACL, y sin consumidores.
//
// El arnés run.sh prueba lo mismo sobre un fixture con los archivos reales de
// S22/S23 y agrega la demostración del hallazgo y las mutaciones; este archivo
// es la prueba de que la migración aplica sobre la cadena real y de que el
// RBAC y las policies REALES dejan pasar lo que tiene que pasar y cortan lo
// que tiene que cortar.
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

console.log('── 1/9 · la cadena completa desde cero, con privilegios de Supabase Branch ──')
const db = reconstruir({ bootstrap: 'bootstrap-branch.sql' })
try {
  if (db.fallos.length > 0) {
    for (const f of db.fallos) mal(`${f.migracion}\n        ${f.error}`)
    throw new Error('la cadena no aplica limpia; no tiene sentido seguir')
  }
  ok(`${db.migraciones.length} de ${db.migraciones.length} migraciones aplicadas sobre una base vacía`)
  if (!db.migraciones.includes(ARCHIVO)) { mal(`la cadena no incluye ${ARCHIVO}`); throw new Error('falta la migración') }

  const sql = (q) => db.psql(['-qtAF', '|', '-v', 'ON_ERROR_STOP=1', '-c', q], { stdio: 'pipe' }).trim()
  const ejecutar = (q) => db.psql(['-q', '-v', 'ON_ERROR_STOP=1', '-c', q], { stdio: 'pipe' })

  console.log('── 2/9 · el trigger y la ACL, celda por celda, en pg_catalog ───────────')
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
  // La acotada es la ÚNICA pieza SECURITY DEFINER del PR: su alcance se mide
  // aquí (DEFINER, STABLE, search_path '', sin PUBLIC ni anon) y su cuerpo en
  // assert.sql (filtra por get_my_company_id(), no acepta company_id del cliente).
  const aclFuente = acl('public.agua_fuente_de_mi_empresa(uuid)')
  if (aclFuente === 't|s|f|f|t|f') ok('agua_fuente_de_mi_empresa(uuid): DEFINER · STABLE · PUBLIC=false · anon=false · authenticated=true · service_role=false (sin JWT siempre daría cero filas)')
  else mal(`agua_fuente_de_mi_empresa(uuid): ${aclFuente} (esperado t|s|f|f|t|f)`)
  // La firma de tres argumentos, tal como la migración exige verla ANTES de
  // concederle EXECUTE a authenticated.
  const fn3 = sql(`
    SELECT l.lanname || '|' || p.provolatile::text || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
        || '|' || pg_get_function_identity_arguments(p.oid) || '|' || pg_get_function_result(p.oid)
        || '|' || p.proretset::text || '|' || p.pronargs || '|' || p.pronargdefaults
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = 'public.calcular_cumplimiento_calidad(text, jsonb, uuid)'::regprocedure`)
  const fn3esp = 'plpgsql|s|false|search_path=""|p_tipo_agua text, p_parametros jsonb, p_company_id uuid|jsonb|false|3|1'
  if (fn3 === fn3esp) ok('calcular_cumplimiento_calidad(text, jsonb, uuid): plpgsql · STABLE · INVOKER · search_path=\'\' · args y retorno exactos · 3 argumentos con 1 DEFAULT')
  else mal(`calcular_cumplimiento_calidad(text, jsonb, uuid): ${fn3}\n        esperado ${fn3esp}`)
  const cuerpoFn3 = sql(`
    SELECT ((length(prosrc) - length(replace(prosrc, 'public.', ''))) / length('public.'))
        || '|' || ((length(prosrc) - length(replace(prosrc, 'public.calidad_tipologias', ''))) / length('public.calidad_tipologias'))
        || '|' || (prosrc ~* '\\m(execute|insert|update|delete|truncate|create|drop|alter|grant|revoke|copy|dblink|pg_read)\\M')::text
      FROM pg_proc WHERE oid = 'public.calcular_cumplimiento_calidad(text, jsonb, uuid)'::regprocedure`)
  if (cuerpoFn3 === '3|3|false') ok('su cuerpo sólo lee public.calidad_tipologias (3 referencias, ninguna otra relación) y no escribe ni usa SQL dinámico')
  else mal(`el cuerpo de la firma de tres argumentos no es el esperado (public.=|calidad_tipologias=|prohibidas = ${cuerpoFn3}, esperado 3|3|false)`)
  const tip = sql(`
    SELECT (SELECT c.relrowsecurity::text FROM pg_class c WHERE c.oid = 'public.calidad_tipologias'::regclass)
        || '|' || coalesce((SELECT pol.polcmd::text || '|' || pol.polpermissive::text
             || '|' || (SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM unnest(pol.polroles) rr JOIN pg_roles r ON r.oid = rr)
             || '|' || replace(pg_get_expr(pol.polqual, pol.polrelid), 'public.', '')
             FROM pg_policy pol WHERE pol.polrelid = 'public.calidad_tipologias'::regclass AND pol.polname = 'calidad_tipologias_select'), '(sin policy)')`)
  const tipEsp = 'true|r|true|authenticated|((company_id IS NULL) OR (company_id = get_my_company_id()))'
  if (tip === tipEsp) ok('calidad_tipologias conserva RLS y su policy de SELECT exacta: es de lo que depende el aislamiento de la INVOKER')
  else mal(`calidad_tipologias: ${tip}\n        esperado ${tipEsp}`)
  const fuenteConf = sql(`SELECT array_to_string(proconfig, ';') || '|' || pg_get_function_result(oid) || '|' || pg_get_function_identity_arguments(oid)
      FROM pg_proc WHERE oid = 'public.agua_fuente_de_mi_empresa(uuid)'::regprocedure`)
  if (fuenteConf === 'search_path=""|TABLE(tipo_agua text, company_id uuid)|p_fuente_id uuid') ok('agua_fuente_de_mi_empresa(uuid): search_path=\'\' · devuelve sólo (tipo_agua, company_id) · toma sólo la fuente, nunca un company_id del cliente')
  else mal(`agua_fuente_de_mi_empresa(uuid): proconfig|result|args = ${fuenteConf}`)
  console.log('── 3/9 · re-aplicar la migración sobre el esquema reconstruido: no-op ──')
  const aplicarMigracion = () => spawnSync(join(binarios(), 'psql'), ['-v', 'ON_ERROR_STOP=1', '-q', '-1', '-f', MIGRACION],
    { encoding: 'utf8', env: { ...db.entorno, PGOPTIONS: '-c client_min_messages=warning' } })
  const oidsFn = () => sql(`SELECT to_regprocedure('public.trg_registros_calidad_cumplimiento_catalogo()')::oid || '|' || to_regprocedure('public.agua_fuente_de_mi_empresa(uuid)')::oid`)
  const oidsAntes = oidsFn()
  const r = aplicarMigracion()
  if (r.status !== 0) mal(`re-aplicar falló:\n${String(r.stderr ?? '').trim().split('\n').slice(-3).join('\n')}`)
  else ok('re-aplicar no falla')
  const [oidTrg2, oidFn2] = sql(`SELECT t.oid, t.tgfoid FROM pg_trigger t WHERE t.tgname = 'registros_calidad_cumplimiento' AND NOT t.tgisinternal`).split('|')
  if (oidTrg && oidTrg2 === oidTrg) ok(`mismo OID del trigger tras re-aplicar (${oidTrg}) — CREATE OR REPLACE TRIGGER no hizo DROP/CREATE`)
  else mal(`el OID del trigger cambió al re-aplicar (${oidTrg} → ${oidTrg2})`)
  if (oidFn && oidFn2 === oidFn) ok(`mismo OID de la función de trigger tras re-aplicar (${oidFn})`)
  else mal(`el OID de la función cambió al re-aplicar (${oidFn} → ${oidFn2})`)
  if (oidsFn() === oidsAntes) ok(`mismos OIDs de las dos funciones nuevas tras re-aplicar (${oidsAntes})`)
  else mal(`los OIDs de las funciones nuevas cambiaron (${oidsAntes} → ${oidsFn()})`)

  console.log('── 4/9 · comportamiento real como authenticated administrativo ─────────')
  // Dos tenants y un admin de cada uno, dentro de la MISMA transacción que las
  // pruebas; al final ROLLBACK. Los usuarios existen en auth.users porque
  // trg_sellar_creado_por sella created_by = auth.uid() con FK a auth.users.
  // `admin` pasa todas las ramas de las policies reales (user_has_permission
  // devuelve true para admin/company_owner). Cada caso corre en un DO con
  // EXCEPTION y deja su resultado en un GUC de la transacción.
  const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const UA = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', UB = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'
  const UOP = 'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2', UOPV = 'a3a3a3a3-a3a3-a3a3-a3a3-a3a3a3a3a3a3'
  const ROL = 'c0c0c0c0-0000-4000-8000-00000000c001'
  const FA = 'fa0f0f0f-0000-4000-8000-00000000a001', FB = 'fb0f0f0f-0000-4000-8000-00000000b001'
  const RA = '0a0a0a0a-0000-4000-8000-000000000001', RB = '0b0b0b0b-0000-4000-8000-000000000001'
  const RO = '0e0e0e0e-0000-4000-8000-000000000001', RO2 = '0e0e0e0e-0000-4000-8000-000000000002'
  const como = (uid) => `RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', true); SET LOCAL ROLE authenticated;`
  const caso = (clave, cuerpo) => `
    DO $c$ BEGIN ${cuerpo} PERFORM set_config('replay.${clave}', 'OK', true);
    EXCEPTION WHEN OTHERS THEN PERFORM set_config('replay.${clave}', SQLSTATE || ' ' || SQLERRM, true); END $c$;`
  const volcar = (claves) => `
    SELECT 'r_' || k || '=' || coalesce(current_setting('replay.' || k, true), 'sin-dato')
      FROM unnest(ARRAY[${claves.map((k) => `'${k}'`).join(',')}]) k;`
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
    ${caso('anon_fuente', `PERFORM * FROM public.agua_fuente_de_mi_empresa('${FA}');`)}
    RESET ROLE;
    ${volcar(['a_insert', 'a_update', 'a_mano', 'a_fuente_ajena', 'a_company_ajeno', 'b_insert', 'anon_rpc', 'anon_fuente'])}
    ROLLBACK;
    SELECT 'restantes=' || ((SELECT count(*) FROM public.registros_calidad) + (SELECT count(*) FROM public.fuentes_agua) + (SELECT count(*) FROM public.calidad_tipologias WHERE company_id IS NOT NULL));`
  let lineas = []
  const correr = (q, etiqueta) => {
    try {
      lineas = db.psql(['-tAq', '-v', 'ON_ERROR_STOP=1', '-c', q], { stdio: 'pipe' }).trim().split('\n').filter(Boolean)
    } catch (err) {
      lineas = []
      mal(`${etiqueta} falló fuera de los casos:\n${String(err.stderr ?? err.message).trim().split('\n').slice(-12).join('\n')}`)
    }
  }
  const valor = (k) => (lineas.find((l) => l.startsWith(k + '=')) ?? '').slice(k.length + 1)
  const espera = (k, v, msg) => (valor(k) === v ? ok(msg) : mal(`${msg} — ${k}=«${valor(k)}», esperado «${v}»`))
  const esperaPrefijo = (k, v, msg) => (valor(k).startsWith(v) ? ok(`${msg}: ${valor(k)}`) : mal(`${msg} — ${k}=«${valor(k)}», esperado que empiece por «${v}»`))
  correr(prueba, 'la transacción de prueba administrativa')
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
  esperaPrefijo('r_anon_fuente', '42501', 'anon · tampoco puede llamar a agua_fuente_de_mi_empresa(uuid): la DEFINER no se regala')
  espera('restantes', '0', 'la transacción se revirtió: no queda ninguna fila')

  console.log('── 5/9 · EL CONTRATO: operator de la empresa SIN agua.calidad.view ─────')
  // Con el RBAC REAL de la cadena. `operator` no es administrativo, así que
  // user_has_permission('agua.calidad.view') sólo le da true si tiene una fila
  // en user_roles → role_permissions. Se siembran dos: el del hallazgo (sin el
  // permiso) y un control con él, para que la prueba distinga «el RBAC es
  // real» de «siempre false».
  const rbac = `
    BEGIN;
    INSERT INTO auth.users (id, aud, role, email) VALUES
      ('${UOP}', 'authenticated', 'authenticated', 'operador.sin.view@ejemplo.test'),
      ('${UOPV}', 'authenticated', 'authenticated', 'operador.con.view@ejemplo.test');
    INSERT INTO public.companies (id, nombre) VALUES ('${A}', 'Empresa A'), ('${B}', 'Empresa B');
    INSERT INTO public.app_users (id, role, company_id) VALUES
      ('${UOP}', 'operator', '${A}'), ('${UOPV}', 'operator', '${A}');
    INSERT INTO public.fuentes_agua (id, identificador, nombre, tipo_agua, company_id) VALUES
      ('${FA}', 'FA_POT', 'Tanque potable A', 'potable', '${A}'),
      ('${FB}', 'FB_POT', 'Tanque potable B', 'potable', '${B}');
    INSERT INTO public.roles (id, company_id, name, is_system) VALUES ('${ROL}', '${A}', 'Lector de calidad (prueba)', false);
    INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES ('${ROL}', 'agua.calidad.view', 'allow');
    INSERT INTO public.user_roles (user_id, role_id) VALUES ('${UOPV}', '${ROL}');

    ${como(UOP)}
    SELECT 'op_rol=' || public.current_user_role();
    SELECT 'op_admin=' || public.is_super_admin()::text;
    SELECT 'op_view=' || public.user_has_permission('agua.calidad.view')::text;
    SELECT 'op_ve_fuentes=' || (SELECT count(*) FROM public.fuentes_agua);
    SELECT 'op_helper_propia=' || coalesce((SELECT tipo_agua || ' ' || company_id::text FROM public.agua_fuente_de_mi_empresa('${FA}')), 'vacío');
    SELECT 'op_helper_ajena=' || (SELECT count(*) FROM public.agua_fuente_de_mi_empresa('${FB}'));
    ${caso('op_insert', `INSERT INTO public.registros_calidad (id, fuente_id, parametros, cumplimiento, cumple_total)
      VALUES ('${RO}', '${FA}', '{"pH": 7.5, "turbiedad": 2}'::jsonb, '{"pH": false}'::jsonb, false);`)}
    DO $u$ DECLARE n int; BEGIN
      UPDATE public.registros_calidad SET parametros = '{"pH": 9.5}'::jsonb WHERE id = '${RO}';
      GET DIAGNOSTICS n = ROW_COUNT; PERFORM set_config('replay.op_update_filas', n::text, true);
    EXCEPTION WHEN OTHERS THEN PERFORM set_config('replay.op_update_filas', SQLSTATE, true); END $u$;
    SELECT 'op_update_filas=' || coalesce(current_setting('replay.op_update_filas', true), 'sin-dato');
    ${caso('op_fuente_ajena', `INSERT INTO public.registros_calidad (fuente_id, parametros) VALUES ('${FB}', '{"pH": 7.5}'::jsonb);`)}
    SELECT 'op_lee_registros=' || (SELECT count(*) FROM public.registros_calidad);

    ${como(UOPV)}
    SELECT 'ctl_rol=' || public.current_user_role();
    SELECT 'ctl_view=' || public.user_has_permission('agua.calidad.view')::text;
    SELECT 'ctl_ve_fuentes=' || (SELECT count(*) FROM public.fuentes_agua);
    ${caso('ctl_insert', `INSERT INTO public.registros_calidad (id, fuente_id, parametros) VALUES ('${RO2}', '${FA}', '{"pH": 7.5}'::jsonb);`)}
    DO $u$ DECLARE n int; BEGIN
      UPDATE public.registros_calidad SET parametros = '{"pH": 9.5}'::jsonb WHERE id = '${RO2}';
      GET DIAGNOSTICS n = ROW_COUNT; PERFORM set_config('replay.ctl_update_filas', n::text, true);
    EXCEPTION WHEN OTHERS THEN PERFORM set_config('replay.ctl_update_filas', SQLSTATE, true); END $u$;
    SELECT 'ctl_update_filas=' || coalesce(current_setting('replay.ctl_update_filas', true), 'sin-dato');

    RESET ROLE;
    SELECT 'op_fila=' || coalesce((SELECT company_id::text || ' ' || cumple_total::text || ' ' || (cumplimiento ->> 'pH') || ' ' || (SELECT count(*) FROM jsonb_object_keys(cumplimiento))::text
      FROM public.registros_calidad WHERE id = '${RO}'), 'sin-fila');
    SELECT 'ctl_fila=' || coalesce((SELECT (cumplimiento ->> 'pH') FROM public.registros_calidad WHERE id = '${RO2}'), 'sin-fila');
    ${volcar(['op_insert', 'op_fuente_ajena', 'ctl_insert'])}
    ROLLBACK;
    SELECT 'op_restantes=' || ((SELECT count(*) FROM public.registros_calidad) + (SELECT count(*) FROM public.fuentes_agua)
      + (SELECT count(*) FROM public.roles WHERE id = '${ROL}') + (SELECT count(*) FROM public.app_users WHERE id IN ('${UOP}', '${UOPV}')));`
  correr(rbac, 'la transacción de RBAC')
  espera('op_rol', 'operator', 'el usuario del caso es un operator, no un administrativo')
  espera('op_admin', 'false', 'no es super_admin')
  espera('op_view', 'false', 'NO tiene agua.calidad.view (el RBAC real le dice false)')
  espera('op_ve_fuentes', '0', 'no ve ni una fila de fuentes_agua: este PR NO abre la tabla')
  espera('op_helper_propia', `potable ${A}`, 'agua_fuente_de_mi_empresa(uuid) sí le resuelve SU fuente: tipo y empresa')
  espera('op_helper_ajena', '0', 'y no le devuelve nada para la fuente de la empresa B')
  espera('r_op_insert', 'OK', 'CONTRATO (b): el operator SIN view guarda su análisis')
  espera('op_fila', `${A} true true 11`, 'el servidor le calculó de verdad: 11 claves del catálogo global, pH 7.5 → true, y pisó el cumplimiento que mandó el cliente')
  // Editar es otra historia, y no por culpa de este PR: Postgres aplica las
  // policies de SELECT a un UPDATE … WHERE, y registros_calidad_select exige
  // agua.calidad.view. El UPDATE del operador no da error y no toca nada.
  espera('op_update_filas', '0', 'EDITAR sí exige hoy agua.calidad.view: su UPDATE no alcanza ninguna fila (asimetría previa a este PR, medida y no tapada)')
  esperaPrefijo('r_op_fuente_ajena', '42501 registros_calidad: la fuente', 'el aislamiento se conserva: la fuente de B le da 42501 desde la función acotada')
  espera('op_lee_registros', '0', 'LEER registros_calidad le sigue exigiendo agua.calidad.view: el contrato de lectura no se amplía')
  espera('ctl_rol', 'operator', 'control · el mismo rol operator…')
  espera('ctl_view', 'true', 'control · …pero con agua.calidad.view concedido por user_roles + role_permissions')
  espera('ctl_ve_fuentes', '1', 'control · ése sí ve la fuente de su empresa (y ninguna de B): el RBAC del replay es real')
  espera('r_ctl_insert', 'OK', 'control · con view también guarda')
  espera('ctl_update_filas', '1', 'control · y su UPDATE sí alcanza la fila: la diferencia es exactamente agua.calidad.view')
  espera('ctl_fila', 'false', 'control · el servidor le recalculó pH 9.5 → false al editar')
  espera('op_restantes', '0', 'la transacción de RBAC se revirtió')

  console.log('── 6/9 · EL CONTRATO PRIVILEGIADO: postgres y service_role, sin JWT ────')
  // Sin JWT, get_my_company_id() e is_super_admin() son NULL y la acotada no
  // devolvería ninguna fuente: sin la rama privilegiada, todo INSERT/UPDATE con
  // fuente_id no nula de un backfill o de la service key moriría con 42501.
  const priv = `
    BEGIN;
    INSERT INTO public.companies (id, nombre) VALUES ('${A}', 'Empresa A'), ('${B}', 'Empresa B');
    INSERT INTO public.fuentes_agua (id, identificador, nombre, tipo_agua, company_id) VALUES
      ('${FA}', 'FA_POT', 'Tanque potable A', 'potable', '${A}'),
      ('${FB}', 'FB_POT', 'Tanque potable B', 'potable', '${B}');
    INSERT INTO public.calidad_tipologias (tipo_agua, company_id, label, parametros, activo) VALUES
      ('potable', '${B}', 'Potable (B)', '[{"key":"pH","label":"pH","unidad":"","min":7.0,"max":7.2}]'::jsonb, true);
    SELECT 'pred=' || (SELECT string_agg(rolname || ':' || (rolsuper OR rolbypassrls)::text, ' ' ORDER BY rolname)
      FROM pg_catalog.pg_roles WHERE rolname IN ('postgres', 'service_role', 'authenticated', 'anon'));

    ${caso('pg_insert', `INSERT INTO public.registros_calidad (id, fuente_id, parametros, company_id, cumplimiento, cumple_total)
      VALUES ('${RA}', '${FA}', '{"pH": 7.5, "turbiedad": 2}'::jsonb, '${A}', '{"pH": false}'::jsonb, false);`)}
    SELECT 'pg_fila=' || coalesce((SELECT cumple_total::text || ' ' || (cumplimiento ->> 'pH') || ' ' || (SELECT count(*) FROM jsonb_object_keys(cumplimiento))::text
      FROM public.registros_calidad WHERE id = '${RA}'), 'sin-fila');
    ${caso('pg_update', `UPDATE public.registros_calidad SET parametros = '{"pH": 9.5}'::jsonb WHERE id = '${RA}';`)}
    SELECT 'pg_tras_update=' || coalesce((SELECT cumple_total::text || ' ' || (cumplimiento ->> 'pH') FROM public.registros_calidad WHERE id = '${RA}'), 'sin-fila');
    ${caso('pg_inexistente', `INSERT INTO public.registros_calidad (fuente_id, parametros, company_id)
      VALUES ('00000000-0000-4000-8000-000000000000', '{}'::jsonb, '${A}');`)}

    RESET ROLE; SET LOCAL ROLE service_role;
    SELECT 'sr_super=' || (SELECT rolsuper::text FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER);
    ${caso('sr_insert', `INSERT INTO public.registros_calidad (id, fuente_id, parametros, company_id)
      VALUES ('${RB}', '${FB}', '{"pH": 7.5}'::jsonb, '${B}');`)}
    ${caso('sr_acotada', `PERFORM * FROM public.agua_fuente_de_mi_empresa('${FB}');`)}
    RESET ROLE;
    SELECT 'sr_fila=' || coalesce((SELECT cumple_total::text || ' ' || (SELECT count(*) FROM jsonb_object_keys(cumplimiento))::text
      FROM public.registros_calidad WHERE id = '${RB}'), 'sin-fila');
    ${volcar(['pg_insert', 'pg_update', 'pg_inexistente', 'sr_insert', 'sr_acotada'])}
    ROLLBACK;
    SELECT 'priv_restantes=' || ((SELECT count(*) FROM public.registros_calidad) + (SELECT count(*) FROM public.fuentes_agua));`
  correr(priv, 'la transacción del contrato privilegiado')
  espera('pred', 'anon:false authenticated:false postgres:true service_role:true',
    'el predicado rolsuper/rolbypassrls separa a los privilegiados de los roles de la API')
  espera('r_pg_insert', 'OK', 'sesión administrativa · INSERT con fuente_id no nula (antes de esta corrección: 42501)')
  espera('pg_fila', 'true true 11', 'sesión administrativa · con el cálculo REAL (11 claves del global) y pisando el pH=false del cliente')
  espera('r_pg_update', 'OK', 'sesión administrativa · UPDATE de parametros')
  espera('pg_tras_update', 'false false', 'sesión administrativa · y el servidor recalcula: pH 9.5 → false')
  esperaPrefijo('r_pg_inexistente', '23503 registros_calidad: la fuente', 'sesión administrativa · fuente inexistente → 23503, no 42501: para ella no hay nada oculto')
  espera('sr_super', 'false', 'service_role NO es superusuario: la rama la abre rolbypassrls, como en producción')
  espera('r_sr_insert', 'OK', 'service_role · INSERT con la fuente de OTRA empresa, legítimo para un actor de servicio')
  espera('sr_fila', 'false 1', 'service_role · con el override de la empresa DE LA FUENTE (la única clave de B), no las 11 del global')
  esperaPrefijo('r_sr_acotada', '42501', 'service_role · no tiene EXECUTE sobre la acotada: su camino no es ése')
  espera('priv_restantes', '0', 'la transacción del contrato privilegiado se revirtió')

  console.log('── 7/9 · FAIL-CLOSED: doce mutantes abortan sin tocar nada ────────────')
  // La huella cubre lo que la precondición promete mirar: cuerpo, ACL, dueño y
  // SECURITY de las dos funciones nuevas, y la definición y el estado del
  // trigger. Si la migración abortara «a medias», esta huella cambiaría.
  const huella = () => sql(`
    SELECT coalesce((SELECT md5(p.prosrc) || ' ' || coalesce(array_to_string(p.proacl::text[], ','), '-') || ' ' || pg_get_userbyid(p.proowner) || ' ' || p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ';'), '-')
             FROM pg_proc p WHERE p.oid = to_regprocedure('public.trg_registros_calidad_cumplimiento_catalogo()')), 'sin-fn')
        || ' ~ ' || coalesce((SELECT md5(p.prosrc) || ' ' || coalesce(array_to_string(p.proacl::text[], ','), '-') || ' ' || pg_get_userbyid(p.proowner) || ' ' || p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ';'), '-')
             FROM pg_proc p WHERE p.oid = to_regprocedure('public.agua_fuente_de_mi_empresa(uuid)')), 'sin-acotada')
        || ' ~ ' || coalesce((SELECT pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text FROM pg_trigger t WHERE t.tgname = 'registros_calidad_cumplimiento' AND NOT t.tgisinternal), 'sin-trigger')
        || ' ~ ' || coalesce((SELECT md5(p.prosrc) || ' ' || coalesce(p.proacl::text, '-') || ' ' || p.provolatile::text || ' ' || p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' ' || pg_get_userbyid(p.proowner)
             FROM pg_proc p WHERE p.oid = to_regprocedure('public.calcular_cumplimiento_calidad(text, jsonb, uuid)')), 'sin-fn3')
        || ' ~ ' || (SELECT c.relrowsecurity::text FROM pg_class c WHERE c.oid = 'public.calidad_tipologias'::regclass)
        || ' ' || coalesce((SELECT pol.polcmd::text || pg_get_expr(pol.polqual, pol.polrelid)
             FROM pg_policy pol WHERE pol.polrelid = 'public.calidad_tipologias'::regclass AND pol.polname = 'calidad_tipologias_select'), 'sin-policy')`)
  const intacta = huella()
  const failClosed = (nombre, mutar, restaurar, fragmento) => {
    try { ejecutar(mutar) } catch (err) { mal(`${nombre}: no se pudo instalar el mutante:\n        ${String(err.stderr ?? err.message).trim().split('\n').slice(-2).join('\n')}`); return }
    const antes = huella()
    const res = aplicarMigracion()
    const err = String(res.stderr ?? '')
    if (res.status === 0) mal(`${nombre}: la migración NO abortó`)
    else if (!err.includes(fragmento)) mal(`${nombre}: abortó, pero no por lo esperado («${fragmento}»):\n        ${err.trim().split('\n').filter(Boolean).slice(-2).join('\n        ')}`)
    else if (huella() !== antes) mal(`${nombre}: abortó, pero MODIFICÓ el esquema`)
    else ok(`${nombre}: aborta con «${fragmento}» y no cambia una sola celda`)
    try { ejecutar(restaurar) } catch (err2) { mal(`${nombre}: no se pudo restaurar el estado:\n        ${String(err2.stderr ?? err2.message).trim().split('\n').slice(-2).join('\n')}`) }
    if (huella() !== intacta) mal(`${nombre}: el estado no volvió al original tras restaurar`)
  }
  const triggerBueno = `CREATE OR REPLACE TRIGGER registros_calidad_cumplimiento
      BEFORE INSERT OR UPDATE OF parametros, fuente_id, cumplimiento, cumple_total
      ON public.registros_calidad FOR EACH ROW
      EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento_catalogo();`
  failClosed('mutante 1 · trigger DESHABILITADO',
    'ALTER TABLE public.registros_calidad DISABLE TRIGGER registros_calidad_cumplimiento;',
    'ALTER TABLE public.registros_calidad ENABLE TRIGGER registros_calidad_cumplimiento;',
    'no está en un estado conocido')
  failClosed('mutante 2 · UPDATE OF alterado (sólo parametros)',
    `CREATE OR REPLACE TRIGGER registros_calidad_cumplimiento BEFORE INSERT OR UPDATE OF parametros
       ON public.registros_calidad FOR EACH ROW
       EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento_catalogo();`,
    triggerBueno,
    'no está en un estado conocido')
  failClosed('mutante 3 · función homónima con OTRO cuerpo',
    `CREATE TABLE public._respaldo_trgfn AS SELECT prosrc FROM pg_proc WHERE oid = 'public.trg_registros_calidad_cumplimiento_catalogo()'::regprocedure;
     CREATE OR REPLACE FUNCTION public.trg_registros_calidad_cumplimiento_catalogo()
     RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $impostor$ BEGIN RETURN NEW; END $impostor$;`,
    `DO $rest$ BEGIN EXECUTE format('CREATE OR REPLACE FUNCTION public.trg_registros_calidad_cumplimiento_catalogo() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = %L AS %L', '', (SELECT prosrc FROM public._respaldo_trgfn)); END $rest$;
     DROP TABLE public._respaldo_trgfn;`,
    'con OTRA definición')
  failClosed('mutante 4 · función homónima con OTRA ACL (anon con EXECUTE)',
    'GRANT EXECUTE ON FUNCTION public.trg_registros_calidad_cumplimiento_catalogo() TO anon;',
    'REVOKE EXECUTE ON FUNCTION public.trg_registros_calidad_cumplimiento_catalogo() FROM anon;',
    'con OTRA definición')
  failClosed('mutante 5 · la acotada con OTRA ACL (anon con EXECUTE)',
    'GRANT EXECUTE ON FUNCTION public.agua_fuente_de_mi_empresa(uuid) TO anon;',
    'REVOKE EXECUTE ON FUNCTION public.agua_fuente_de_mi_empresa(uuid) FROM anon;',
    'ya existe public.agua_fuente_de_mi_empresa(uuid) con OTRA definición')
  failClosed('mutante 6 · la acotada degradada a SECURITY INVOKER',
    'ALTER FUNCTION public.agua_fuente_de_mi_empresa(uuid) SECURITY INVOKER;',
    'ALTER FUNCTION public.agua_fuente_de_mi_empresa(uuid) SECURITY DEFINER;',
    'ya existe public.agua_fuente_de_mi_empresa(uuid) con OTRA definición')
  failClosed('mutante 7 · la acotada sin search_path fijado',
    'ALTER FUNCTION public.agua_fuente_de_mi_empresa(uuid) RESET search_path;',
    `ALTER FUNCTION public.agua_fuente_de_mi_empresa(uuid) SET search_path = '';`,
    'ya existe public.agua_fuente_de_mi_empresa(uuid) con OTRA definición')
  // Y los que atacan justo lo que la migración valida ANTES de conceder EXECUTE.
  failClosed('mutante 8 · la firma de tres argumentos con OTRO cuerpo',
    `CREATE TABLE public._respaldo_fn3 AS SELECT prosrc FROM pg_proc WHERE oid = 'public.calcular_cumplimiento_calidad(text, jsonb, uuid)'::regprocedure;
     CREATE OR REPLACE FUNCTION public.calcular_cumplimiento_calidad(p_tipo_agua text, p_parametros jsonb, p_company_id uuid DEFAULT NULL)
     RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $impostor$
     BEGIN RETURN jsonb_build_object('cumplimiento', '{}'::jsonb, 'cumple_total', true); END $impostor$;`,
    `DO $rest$ BEGIN EXECUTE format('CREATE OR REPLACE FUNCTION public.calcular_cumplimiento_calidad(p_tipo_agua text, p_parametros jsonb, p_company_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = %L AS %L', '', (SELECT prosrc FROM public._respaldo_fn3)); END $rest$;
     DROP TABLE public._respaldo_fn3;`,
    'no es ninguna de las dos variantes autorizadas')
  failClosed('mutante 9 · la firma de tres argumentos pasada a VOLATILE',
    'ALTER FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid) VOLATILE;',
    'ALTER FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid) STABLE;',
    'no es la función que esta migración sabe exponer')
  failClosed('mutante 10 · ACL previa de la firma de tres argumentos con anon',
    'GRANT EXECUTE ON FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid) TO anon;',
    'REVOKE EXECUTE ON FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid) FROM anon;',
    'la ACL previa')
  failClosed('mutante 11 · calidad_tipologias sin RLS',
    'ALTER TABLE public.calidad_tipologias DISABLE ROW LEVEL SECURITY;',
    'ALTER TABLE public.calidad_tipologias ENABLE ROW LEVEL SECURITY;',
    'no tiene ENABLE ROW LEVEL SECURITY')
  failClosed('mutante 12 · calidad_tipologias_select abierta con USING (true)',
    'ALTER POLICY calidad_tipologias_select ON public.calidad_tipologias USING (true);',
    'ALTER POLICY calidad_tipologias_select ON public.calidad_tipologias USING (company_id IS NULL OR company_id = public.get_my_company_id());',
    'no es la esperada')

  const tras = aplicarMigracion()
  if (tras.status !== 0) mal(`tras los doce mutantes la migración ya no aplica:\n${String(tras.stderr ?? '').trim().split('\n').slice(-3).join('\n')}`)
  else if (huella() !== intacta) mal('tras los doce mutantes el esquema no volvió al original')
  else ok('tras los doce mutantes el esquema es idéntico y la migración vuelve a aplicar como no-op')

  console.log('── 8/9 · restaurar la llamada ambigua devuelve el 42725 ───────────────')
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
  correr(mut, 'la mutación de ambigüedad')
  esperaPrefijo('mut', '42725', 'con el trigger apuntando a la función de S22, el INSERT vuelve a morir')
  espera('fn_tras_rollback', 'trg_registros_calidad_cumplimiento_catalogo()', 'la mutación se revirtió: el trigger sigue apuntando a la función nueva')

  console.log('── 9/9 · lo que no debía moverse ─────────────────────────────────────')
  const acl2 = acl('public.calcular_cumplimiento_calidad(text, jsonb)')
  if (acl2 === 'f|i|t|t|t|t') ok('calcular_cumplimiento_calidad(text, jsonb) sigue: INVOKER · IMMUTABLE · ACL de S22 (PUBLIC)')
  else mal(`calcular_cumplimiento_calidad(text, jsonb): ${acl2} (esperado f|i|t|t|t|t)`)
  const huerfanos = sql(`SELECT count(*) FROM pg_trigger WHERE tgfoid = 'public.trg_registros_calidad_cumplimiento()'::regprocedure`)
  if (huerfanos === '0') ok('trg_registros_calidad_cumplimiento() sigue existiendo y ningún trigger la ejecuta')
  else mal(`${huerfanos} trigger(s) siguen ejecutando trg_registros_calidad_cumplimiento()`)
  const politicas = sql(`SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'fuentes_agua'
      AND policyname = 'fuentes_agua_select' AND qual LIKE '%user_has_permission%'`)
  if (politicas === '1') ok('fuentes_agua_select sigue exigiendo user_has_permission: la tabla no se abrió')
  else mal(`fuentes_agua_select ya no exige user_has_permission (coincidencias: ${politicas})`)
} catch (err) {
  mal(err.message)
} finally {
  db.destruir()
}

if (fallos > 0) { console.error(`\n❌ replay: ${fallos} fallo(s)`); process.exit(1) }
console.log('\n✅ replay: la cadena completa, el trigger re-apuntado, el operator sin view y los actores privilegiados escribiendo, y los doce mutantes fail-closed')
