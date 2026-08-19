#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Preflight FAIL-CLOSED del job "RLS harness (server-side)".
// ════════════════════════════════════════════════════════════════════════════
// Decide, ANTES de instalar nada, si el harness puede verificar el aislamiento
// multi-tenant. Tres desenlaces y ninguno ambiguo:
//
//   run    — están las SEIS variables RLS_*: el harness se ejecuta.
//   skip   — SÓLO en eventos `pull_request` donde GitHub no entrega los Actions
//            secrets por diseño:
//            · PR desde un fork,
//            · PR abierto por dependabot[bot].
//            Se omite EXPLÍCITAMENTE, sin ejecutar código ajeno con
//            credenciales y sin recurrir a `pull_request_target` —que sí las
//            expondría al código del PR y es justo lo que no queremos.
//   fail   — TODO lo demás, incluido `push` a main sea quien sea el actor.
//
// LA GARANTÍA, Y POR QUÉ LA ANTERIOR NO SERVÍA
// La versión previa afirmaba que «el aislamiento se valida igualmente en el
// push a main posterior al merge». Eso no es verificable: si el merge lo hace
// el propio Dependabot (auto-merge), el push a `main` también corre con
// `github.actor = dependabot[bot]` y, con la regla anterior, se habría OMITIDO
// otra vez. El cambio nunca se habría verificado y nadie se habría enterado.
//
// Ahora la omisión está acotada al evento `pull_request`. En `push` no se omite
// jamás: si faltan los secretos, el job FALLA y el hueco se ve. Eso convierte
// la omisión del PR en una garantía comprobable —«se difiere a main, y main no
// puede saltárselo»— en vez de una promesa.
//
// Para que un PR de Dependabot verifique en el propio PR (y no sólo al
// mergear), hay que declarar las seis variables TAMBIÉN como *Dependabot
// secrets* con los mismos nombres: Settings → Secrets and variables →
// Dependabot. Está documentado en docs/ACTIVAR_HARNESS_RLS.md.
//
// Vive en Node y no inline en el YAML para poder probarlo:
// `scripts/__tests__/rls-preflight.test.mjs` cubre los cuatro contextos.
// ════════════════════════════════════════════════════════════════════════════

import { appendFileSync } from 'node:fs'

/** Las seis variables que el harness necesita. Sus NOMBRES no son secretos. */
export const VARIABLES_RLS = [
  'RLS_SUPABASE_URL',
  'RLS_SUPABASE_ANON_KEY',
  'RLS_USER_A_EMAIL',
  'RLS_USER_A_PASSWORD',
  'RLS_USER_B_EMAIL',
  'RLS_USER_B_PASSWORD',
]

/**
 * Contextos en los que GitHub NO entrega los Actions secrets al ejecutor, así
 * que la ausencia de variables es estructural y no un error de configuración.
 *
 * CLAVE: sólo se admite la omisión en eventos `pull_request`. En `push` —donde
 * vive la garantía— no se omite nunca, ni siquiera si el actor es Dependabot
 * (caso real con auto-merge activado).
 */
export function motivoSinSecretos({ esFork, actor, evento }) {
  const esPullRequest = evento === undefined || evento === 'pull_request'
  if (!esPullRequest) return null

  if (esFork === true || esFork === 'true') {
    return {
      clave: 'fork',
      titulo: 'PR desde un fork',
      detalle:
        'GitHub no expone secretos a los forks por diseño. No se ejecuta código del ' +
        'fork con credenciales ni se usa `pull_request_target`, que sí las expondría. ' +
        'La verificación no se pierde: el push a `main` posterior al merge es ' +
        'fail-closed y no puede omitirse.',
    }
  }

  // Dependabot corre con su propio contexto: los Actions secrets NO están
  // disponibles (sólo los *Dependabot secrets*). Un bump de dependencia no
  // puede verificar RLS a menos que se declaren esos secretos aparte.
  if (actor === 'dependabot[bot]') {
    return {
      clave: 'dependabot',
      titulo: 'PR de Dependabot',
      detalle:
        'Los Actions secrets no se exponen a dependabot[bot]. Se difiere al push a ' +
        '`main`, que NO puede omitirse (fail-closed sea quien sea el actor, incluido ' +
        'el propio Dependabot si hay auto-merge). Para verificar ya en el PR, declará ' +
        'las seis variables también como *Dependabot secrets* con los mismos nombres.',
    }
  }
  return null
}

/**
 * Decide el desenlace. Pura: no toca el entorno ni el disco.
 * @returns {{ decision: 'run'|'skip'|'fail', faltan: string[], motivo: object|null, mensaje: string }}
 */
export function decidirPreflight(env = {}) {
  const faltan = VARIABLES_RLS.filter((v) => !env[v])

  if (faltan.length === 0) {
    return {
      decision: 'run',
      faltan,
      motivo: null,
      mensaje: 'Las 6 variables RLS_* están presentes: el harness se ejecuta.',
    }
  }

  const motivo = motivoSinSecretos({
    esFork: env.ES_FORK,
    actor: env.GITHUB_ACTOR,
    evento: env.GITHUB_EVENT_NAME,
  })

  if (motivo) {
    return {
      decision: 'skip',
      faltan,
      motivo,
      mensaje: `Harness RLS omitido (${motivo.titulo}). ${motivo.detalle}`,
    }
  }

  return {
    decision: 'fail',
    faltan,
    motivo: null,
    mensaje:
      `Faltan variables RLS_* (${faltan.join(' ')}). El job falla en vez de quedar verde: ` +
      'un verde sin ejecutar se contabiliza como cobertura que no existe. ' +
      (env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_ACTOR === 'dependabot[bot]'
        ? 'Este push a main lo inició Dependabot: aquí NO se omite, porque es donde se ' +
          'difería la verificación del PR. Declará los secretos de Dependabot o mergeá a mano. '
        : '') +
      'Ver docs/ACTIVAR_HARNESS_RLS.md.',
  }
}

/** Resumen Markdown para la UI de Actions. Sólo nombres de variable, nunca valores. */
export function resumenMarkdown({ decision, faltan, motivo }) {
  if (decision === 'run') {
    return '### ▶️ Harness RLS: las 6 variables `RLS_*` están presentes, se ejecuta.\n\n'
  }
  if (decision === 'skip') {
    return [
      `### ⏭️ Harness RLS omitido — ${motivo.titulo}`,
      '',
      motivo.detalle,
      '',
      `Variables no disponibles: ${faltan.map((v) => `\`${v}\``).join(', ')}`,
      '',
      'La verificación real corre en los PR internos y en cada push a `main`.',
      '',
    ].join('\n')
  }
  return [
    '### ❌ Harness RLS sin configurar — el job FALLA (fail-closed)',
    '',
    'El aislamiento multi-tenant **no se verificó** y este job ya no se queda verde',
    'por ello. Faltan estas variables de repositorio:',
    '',
    ...faltan.map((v) => `- \`${v}\``),
    '',
    'Se exigen **las seis**: con la URL puesta pero una credencial vacía, el harness',
    'se auto-saltaba y terminaba verde con **cero** pruebas.',
    '',
    'Activación: **`docs/ACTIVAR_HARNESS_RLS.md`** → `scripts/seed-rls-sandbox.mjs`.',
    '',
  ].join('\n')
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function main(env) {
  const veredicto = decidirPreflight(env)
  const { decision, mensaje } = veredicto

  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `run=${decision === 'run'}\n`)
  }
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, resumenMarkdown(veredicto))
  }

  if (decision === 'run') {
    console.log(mensaje)
    return 0
  }
  if (decision === 'skip') {
    console.log(`::notice title=Harness RLS omitido::${mensaje}`)
    return 0
  }
  console.log(`::error title=Harness RLS sin configurar::${mensaje}`)
  return 1
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.env))
}
