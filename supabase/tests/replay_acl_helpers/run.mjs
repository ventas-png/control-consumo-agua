#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Replay de la cadena completa CON LOS PRIVILEGIOS DE UNA SUPABASE BRANCH
// ════════════════════════════════════════════════════════════════════════════
// QUÉ DEMUESTRA, en este orden y sin adivinar nada:
//
//   1. ANTES de la reparación, la cadena de migraciones NO reconstruye desde
//      cero: `20260909000000_revoke_execute_helpers_rls_y_reset.sql` aborta en
//      su propia verificación con
//          authenticated NO puede ejecutar public.current_user_role()
//      Es el mismo error, palabra por palabra, con el que falló la preview
//      branch de #847 el 2026-09-11 (proyecto iiohmlctjtgqdxigdtjr).
//
//   2. DESPUÉS de la reparación, la cadena entera aplica limpia.
//
//   3. Y la matriz de ACL queda EXACTAMENTE como se declara, comprobada celda
//      por celda con has_function_privilege:
//          15 helpers → PUBLIC no · anon no · authenticated SÍ · service_role SÍ
//           5 reseteo → PUBLIC no · anon no · authenticated NO · service_role SÍ
//
// POR QUÉ NO USA `bootstrap.sql`. Ese andamiaje concede funciones a
// `authenticated` con ALTER DEFAULT PRIVILEGES, y eso fue justo lo que ocultó
// el defecto: con él puesto, la reconstrucción pasaba y el fallo sólo aparecía
// en una branch de verdad. Aquí se usa `bootstrap-branch.sql`, idéntico salvo
// por no hacer ese regalo.
//
// EL ÁRBOL «ANTES» NO SALE DE GIT, y es a propósito: el job de coverage hace un
// checkout superficial y ahí no existe `origin/main`. Se deriva quitando el
// bloque (0) del archivo histórico —está delimitado— y se COMPRUEBA que el
// resultado es byte a byte el contenido que el guard tiene clavado en
// `REPARACION_REPLAY.hashAntes`. Si la derivación fuera infiel, el hash no
// cuadra y la prueba se detiene ahí en vez de medir un árbol inventado.
// Y si algún día el paso (1) dejara de reproducir el fallo, esta prueba falla y
// avisa de que ya no demuestra lo que dice.
//
// Uso:  node supabase/tests/replay_acl_helpers/run.mjs
// Requiere binarios de PostgreSQL. No toca ningún proyecto remoto.
// ════════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reconstruir } from '../../../scripts/schema-drift/reconstruir.mjs'
import { REPARACION_REPLAY } from '../../../scripts/migrations-append-only.mjs'

const HISTORICA = '20260909000000_revoke_execute_helpers_rls_y_reset.sql'
const FORWARD = '20260910000150_acl_helpers_rls_matriz_declarada.sql'
const DIR = 'supabase/migrations'

const HELPERS = [
  'current_user_role()', 'get_my_cliente_id()', 'get_my_company_id()', 'get_my_user_id()',
  'has_admin_company_access(uuid)', 'has_admin_or_owner_access_in_company(uuid)',
  'has_admin_project_access(uuid)', 'has_company_owner_company_access(uuid)',
  'has_operator_project_access(uuid)', 'has_super_admin_access()',
  'has_viewer_project_access(uuid)', 'is_company_owner()', 'is_super_admin()',
  'is_user_cliente_with_id(uuid)', 'user_has_project_access(uuid)',
]
const RESET = [
  'request_password_reset(character varying, character varying, text)',
  'request_password_reset(text, text, text)',
  'update_user_password(character varying, character varying)',
  'validate_reset_token(character varying)',
  'validate_reset_token(text)',
]

let fallos = 0
const ok = (m) => console.log(`  OK    ${m}`)
const mal = (m) => { console.error(`  ✗     ${m}`); fallos++ }

/** El hash de blob de git: sha1('blob <bytes>\0' + contenido). */
function hashDeBlob(texto) {
  const buf = Buffer.from(texto, 'utf8')
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`, 'utf8'), buf]))
    .digest('hex')
}

/** El archivo histórico SIN el bloque (0) — es decir, como estaba antes. */
function sinLaReparacion(texto) {
  const ini = texto.indexOf('-- ── (0) REPARACIÓN DE REPLAY')
  const fin = texto.indexOf('-- ── (1) Helpers de policies RLS')
  if (ini === -1 || fin === -1 || fin < ini) {
    throw new Error(
      'No se encontraron los delimitadores del bloque (0) en ' + HISTORICA +
      ' — si se reescribió la cabecera, hay que actualizar esta prueba.',
    )
  }
  return texto.slice(0, ini) + texto.slice(fin)
}

// ── (1) El árbol ANTERIOR a la reparación, y su fallo ──────────────────────
console.log('── 1/3 · la cadena ANTES de reparar: tiene que fallar ──────────────────')
const tmp = mkdtempSync(join(tmpdir(), 'replay-'))
const dirViejo = join(tmp, 'migrations')
cpSync(DIR, dirViejo, { recursive: true })
rmSync(join(dirViejo, FORWARD), { force: true })

const original = sinLaReparacion(readFileSync(join(DIR, HISTORICA), 'utf8'))
const hash = hashDeBlob(original)
if (hash !== REPARACION_REPLAY.hashAntes) {
  console.error(`  ✗     el árbol «antes» derivado no coincide con el hash clavado en el guard`)
  console.error(`        derivado: ${hash}`)
  console.error(`        esperado: ${REPARACION_REPLAY.hashAntes}`)
  console.error('        La prueba no puede seguir: mediría un árbol que nunca existió.')
  process.exit(1)
}
ok(`el árbol «antes» reproduce el blob ${REPARACION_REPLAY.hashAntes.slice(0, 12)} que el guard tiene clavado`)
writeFileSync(join(dirViejo, HISTORICA), original)

const antes = reconstruir({ dirMigraciones: dirViejo, bootstrap: 'bootstrap-branch.sql', pararEnElPrimerFallo: true })
try {
  const roto = antes.fallos.find((f) => f.migracion === HISTORICA)
  if (!roto) {
    mal(`la cadena vieja NO falló en ${HISTORICA} — la prueba ya no demuestra el defecto`)
  } else if (!/authenticated NO puede ejecutar public\.current_user_role/.test(roto.error)) {
    mal(`falló en ${HISTORICA} pero con otro error:\n${roto.error}`)
  } else {
    ok('sin la reparación, el replay aborta con «authenticated NO puede ejecutar')
    ok('      public.current_user_role()» — el mismo error de la preview branch')
  }
} finally {
  antes.destruir()
  rmSync(tmp, { recursive: true, force: true })
}

// ── (2) El árbol reparado: tiene que aplicar entero ────────────────────────
console.log('── 2/3 · la cadena reparada: tiene que aplicar limpia ──────────────────')
const ahora = reconstruir({ bootstrap: 'bootstrap-branch.sql' })
try {
  if (ahora.fallos.length > 0) {
    for (const f of ahora.fallos) mal(`${f.migracion}\n        ${f.error}`)
  } else {
    ok(`${ahora.migraciones.length} de ${ahora.migraciones.length} migraciones aplicadas sin el regalo de privilegios`)
  }

  // ── (3) La matriz, celda por celda ───────────────────────────────────────
  console.log('── 3/3 · la matriz de ACL, con has_function_privilege ──────────────────')
  const consultar = (fns) => {
    const valores = fns.map((f) => `('${f.replace(/'/g, "''")}')`).join(',')
    const sql = `
      SELECT f.fn,
             has_function_privilege('public',        to_regprocedure('public.'||f.fn), 'EXECUTE'),
             has_function_privilege('anon',          to_regprocedure('public.'||f.fn), 'EXECUTE'),
             has_function_privilege('authenticated', to_regprocedure('public.'||f.fn), 'EXECUTE'),
             has_function_privilege('service_role',  to_regprocedure('public.'||f.fn), 'EXECUTE')
        FROM (VALUES ${valores}) AS f(fn)`
    return ahora.psql(['-tAF', '|', '-c', sql], { stdio: 'pipe' })
      .trim().split('\n').filter(Boolean)
      .map((l) => { const [fn, p, a, au, sr] = l.split('|'); return { fn, publico: p === 't', anon: a === 't', auth: au === 't', srv: sr === 't' } })
  }

  const revisar = (filas, esperado, etiqueta) => {
    const malas = filas.filter((r) => r.auth !== esperado.auth || r.publico || r.anon || !r.srv)
    if (filas.length !== esperado.n) {
      mal(`${etiqueta}: se midieron ${filas.length} funciones y se esperaban ${esperado.n}`)
    } else if (malas.length > 0) {
      for (const r of malas) {
        mal(`${etiqueta} ${r.fn}: PUBLIC=${r.publico} anon=${r.anon} authenticated=${r.auth} service_role=${r.srv}`)
      }
    } else {
      ok(`${etiqueta}: PUBLIC=false · anon=false · authenticated=${esperado.auth} · service_role=true (${filas.length} funciones)`)
    }
  }

  revisar(consultar(HELPERS), { n: 15, auth: true }, 'los 15 helpers de RLS')
  revisar(consultar(RESET), { n: 5, auth: false }, 'las 5 de reseteo')
} finally {
  ahora.destruir()
}

console.log('')
if (fallos > 0) {
  console.error(`❌ replay_acl_helpers: ${fallos} comprobación(es) fallaron.`)
  process.exit(1)
}
console.log('✅ la cadena reconstruye desde cero con privilegios de Supabase Branch, y la ACL es la declarada.')
