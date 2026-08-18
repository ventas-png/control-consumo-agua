#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Migrations append-only — las migraciones ya mergeadas son INMUTABLES.
//
// POR QUÉ
// Una migración que llegó a `main` ya fue aplicada por producción, por las
// preview branches y por cualquier entorno provisionado desde el repo. Editarla
// reescribe la historia sin re-ejecutarse en ninguno de ellos — o peor: SÍ se
// re-ejecuta. En push a main, apply-migrations-prod.yml selecciona con
// `--diff-filter=AM`, así que una histórica MODIFICADA se reaplica contra
// producción tal cual (la clase del incidente 2026-08-03, cuando reaplicar
// migraciones viejas ejecutó un DROP TABLE ... CASCADE sobre app_users). Y un
// RENOMBRE de históricas ya produjo el fallo mudo de #681 (los dos renombres de
// migración se saltaron el apply en silencio).
//
// QUÉ IMPONE
// Sobre `supabase/migrations/*.sql`, comparando un rango Git:
//   · Añadir (A) o copiar (C) → permitido. Es la única evolución válida.
//   · Modificar (M), typechange (T), eliminar (D) → violación.
//   · Renombrar (R) una migración existente → violación (aunque el destino siga
//     dentro de la carpeta). Renombrar un archivo de FUERA hacia dentro equivale
//     a añadir → permitido.
//   · Los archivos no-.sql de la carpeta (README.md) quedan fuera de la regla.
//
// CÓMO SE COMPARA
//   · PR (GITHUB_EVENT_NAME=pull_request): merge-base(origin/$GITHUB_BASE_REF,
//     HEAD)..HEAD — el diff del PR, sin arrastrar cambios que ya están en main.
//   · push (GITHUB_EVENT_NAME=push): $GITHUB_EVENT_BEFORE..HEAD.
//   · Local / otros: merge-base(origin/main, HEAD)..HEAD.
//   · Override explícito: --base <ref> [--head <ref>].
// FAIL-CLOSED: si la base no se puede resolver — `before` vacío/0000…/
// inalcanzable (force-push, rama nueva), ref de PR u origin/main ausentes,
// --base inexistente, o sin merge-base — el guard TERMINA CON ERROR sin validar
// nada. Degradar a mirar solo el commit HEAD sería fail-open: un force-push
// puede reescribir migraciones históricas en commits ANTERIORES al último y el
// diff de un solo commit no las ve. Se exige historia completa o un rango
// verificable, y el error lo dice.
// El diff corre con -M (detección de renombres ACTIVA). No confundir con el
// `--no-renames` del apply: allí se descompone R en D+A para no SALTARSE la
// aplicación del archivo nuevo; aquí queremos VER el renombre para prohibirlo.
//
// CÓMO SE CORRIGE UNA VIOLACIÓN
// Revertir el archivo a su contenido de main y crear una migración NUEVA con
// timestamp posterior que haga el ajuste (ALTER/DROP/CREATE OR REPLACE…). Un
// renombre por timestamp duplicado (regla (d) de migrations-guard) solo procede
// ANTES del merge, mientras la migración aún no es histórica. No hay bypass a
// propósito: si de verdad hay que reescribir la historia (nunca debería), es
// una operación manual y auditada, no un flag.
//
// Complementario a migrations-guard.mjs (análisis del CONTENIDO acumulado del
// repo); este script mira el DIFF Git — qué archivos cambiaron entre dos commits.
//
// Uso:  node scripts/migrations-append-only.mjs [--base <ref>] [--head <ref>]
// Test: scripts/__tests__/migrations-append-only.test.mjs (vitest) — importa los
//       helpers exportados; main() solo corre como módulo principal.
// ════════════════════════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const MIG_DIR = 'supabase/migrations/'

// Parsea la salida de `git diff --name-status -M` (campos separados por TAB):
//   A\tpath · M\tpath · D\tpath · T\tpath · R<score>\told\tnew · C<score>\told\tnew
export function parseNameStatus(text) {
  const entries = []
  for (const line of (text ?? '').split('\n')) {
    if (line.trim() === '') continue
    const fields = line.split('\t')
    const status = fields[0].trim()
    const letter = status[0]
    if (letter === 'R' || letter === 'C') {
      entries.push({ status: letter, oldPath: fields[1], path: fields[2] })
    } else {
      entries.push({ status: letter, path: fields[1] })
    }
  }
  return entries
}

const esMigracion = (p) => p !== undefined && p.startsWith(MIG_DIR) && p.endsWith('.sql')

// Devuelve las violaciones append-only de un conjunto de entradas name-status.
export function evaluateAppendOnly(entries) {
  const violations = []
  for (const e of entries) {
    if (e.status === 'A' || e.status === 'C') continue // añadir es lo permitido
    if (e.status === 'R') {
      // Renombrar una migración existente la hace desaparecer para el historial
      // remoto (indexado por versión) y para el apply (#681). Un rename que
      // ENTRA a la carpeta desde fuera es, a efectos de migraciones, un alta.
      if (esMigracion(e.oldPath)) {
        violations.push({
          kind: 'renombrada',
          path: e.oldPath,
          detail: `renombrada a ${e.path}`,
        })
      }
      continue
    }
    if (!esMigracion(e.path)) continue
    if (e.status === 'M' || e.status === 'T') {
      violations.push({ kind: 'modificada', path: e.path })
    } else if (e.status === 'D') {
      violations.push({ kind: 'eliminada', path: e.path })
    }
    // Cualquier otra letra (U de conflicto, X) no debería llegar de un diff de
    // commits; si llegara, mejor no inventar semántica y dejarla pasar — el
    // resto del CI la haría visible.
  }
  return violations
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

function gitOk(args) {
  try {
    execFileSync('git', args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const SHA_VACIO = '0000000000000000000000000000000000000000'

// Resuelve el rango a comparar según el contexto (ver cabecera).
export function resolveRange({ argv = [], env = {} } = {}) {
  const flag = (name) => {
    const i = argv.indexOf(name)
    return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined
  }
  const head = flag('--head') ?? 'HEAD'
  const baseArg = flag('--base')
  if (baseArg) return { base: baseArg, head, mode: 'explícito' }

  if (env.GITHUB_EVENT_NAME === 'pull_request' && env.GITHUB_BASE_REF) {
    return { base: `origin/${env.GITHUB_BASE_REF}`, head, mode: 'merge-base (PR)' }
  }
  if (env.GITHUB_EVENT_NAME === 'push') {
    const before = env.GITHUB_EVENT_BEFORE
    if (before && before !== SHA_VACIO) return { base: before, head, mode: 'push', linear: true }
    return { base: null, head, mode: 'push sin `before` utilizable (vacío o 0000… — force-push o rama nueva)' }
  }
  return { base: 'origin/main', head, mode: 'merge-base (local)' }
}

// Sin rango verificable NO se valida nada: fail-closed. Mirar "solo HEAD" sería
// fail-open — un force-push puede reescribir históricas en commits anteriores
// al último y ese diff no las ve (ver cabecera).
function abortarSinRango(motivo) {
  console.error(`❌ migrations-append-only: sin rango Git VERIFICABLE — ${motivo}.`)
  console.error('   Este guard es fail-closed a propósito: validar solo el commit HEAD dejaría')
  console.error('   pasar un force-push que reescriba migraciones históricas en commits')
  console.error('   ANTERIORES al último. NO se validó nada y NO se ejecutó ningún SQL.')
  console.error('   Para desbloquear se necesita historia completa o un rango verificable:')
  console.error('   · en CI, checkout con fetch-depth: 0 (ci.yml ya lo hace);')
  console.error('   · restaura la ref que falta, o pasa --base <commit existente>;')
  console.error('   · si esto abortó el apply de producción tras un force-push a main,')
  console.error('     revisa el histórico a mano y aplica lo pendiente con workflow_dispatch')
  console.error('     (modo reconciliar) — nunca re-lances a ciegas.')
  process.exit(1)
}

async function main() {
  const range = resolveRange({ argv: process.argv.slice(2), env: process.env })

  if (!range.base) abortarSinRango(range.mode)
  if (!gitOk(['cat-file', '-e', `${range.base}^{commit}`])) {
    abortarSinRango(`la base "${range.base}" no existe o no es alcanzable (${range.mode})`)
  }
  // En PR/local el punto de comparación es el merge-base, para no atribuir al
  // PR cambios que ya están en la base. En push (rango lineal) before..head.
  let desde
  if (range.linear) {
    desde = range.base
  } else {
    try {
      desde = git(['merge-base', range.base, range.head]).trim()
    } catch {
      abortarSinRango(
        `sin merge-base entre "${range.base}" y "${range.head}" (¿historial truncado o no relacionado?)`,
      )
    }
  }
  const diffText = git(['diff', '--name-status', '-M', desde, range.head, '--', MIG_DIR])
  const descripcion = `${desde.slice(0, 12)}..${range.head} (${range.mode})`

  const entries = parseNameStatus(diffText)
  const violations = evaluateAppendOnly(entries)
  const nuevas = entries.filter((e) => (e.status === 'A' || e.status === 'C') && esMigracion(e.path))

  console.log(`🔎 Migrations append-only — rango: ${descripcion}`)
  console.log(
    `   migraciones nuevas: ${nuevas.length} · violaciones del histórico: ${violations.length}`,
  )

  if (violations.length > 0) {
    console.error('')
    for (const v of violations) {
      console.error(`   ✗ ${v.path} — ${v.kind.toUpperCase()}${v.detail ? ` (${v.detail})` : ''}`)
    }
    console.error('')
    console.error('❌ migrations-append-only: las migraciones ya mergeadas son INMUTABLES.')
    console.error('   Producción y las preview branches ya las aplicaron; editarlas reescribe la')
    console.error('   historia sin re-ejecutarse (o peor: el apply de push reaplica las')
    console.error('   modificadas contra producción — incidente 2026-08-03).')
    console.error('   CÓMO CORREGIRLO, por archivo listado arriba:')
    console.error('   · modificada → revierte el archivo a su contenido de main y crea una')
    console.error('     migración NUEVA con timestamp posterior que haga el ajuste.')
    console.error('   · eliminada  → restáurala; si su efecto debe deshacerse, escribe la')
    console.error('     migración inversa como archivo nuevo.')
    console.error('   · renombrada → recupera el nombre original; renombrar por timestamp')
    console.error('     duplicado (regla (d) del guard) solo procede ANTES del merge.')
    process.exit(1)
  }
  console.log('✅ migrations-append-only: el histórico de migraciones queda intacto.')
  process.exit(0)
}

const esModuloPrincipal =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (esModuloPrincipal) {
  main().catch((err) => {
    console.error(`❌ migrations-append-only: error inesperado — ${err.stack || err.message}`)
    process.exit(1)
  })
}
