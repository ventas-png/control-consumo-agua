#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Preflight FAIL-CLOSED del job "RLS harness (server-side)".
// ════════════════════════════════════════════════════════════════════════════
// Decide, ANTES de instalar nada, si el harness puede verificar el aislamiento
// multi-tenant. Tres desenlaces y ninguno ambiguo:
//
//   run    — están las SEIS variables RLS_*: el harness se ejecuta.
//   skip   — el ejecutor NO PUEDE tener secretos por diseño de GitHub:
//            · PR desde un fork,
//            · ejecución iniciada por dependabot[bot] (los Actions secrets no
//              se exponen a Dependabot; sólo los Dependabot secrets, que este
//              repo no usa).
//            Se omite EXPLÍCITAMENTE, sin ejecutar código ajeno con
//            credenciales y sin recurrir a `pull_request_target` —que sí las
//            expondría al código del PR y es justo lo que no queremos.
//            En ambos casos el aislamiento se valida igualmente en el push a
//            `main` posterior al merge, donde los secretos sí están.
//   fail   — cualquier otro contexto (PR interno, push a main) al que le falte
//            alguna variable. Falla en vez de quedar verde: un verde por
//            omisión se contabiliza como cobertura que no existe.
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
 */
export function motivoSinSecretos({ esFork, actor, evento }) {
  if (esFork === true || esFork === 'true') {
    return {
      clave: 'fork',
      titulo: 'PR desde un fork',
      detalle:
        'GitHub no expone secretos a los forks por diseño. No se ejecuta código del ' +
        'fork con credenciales ni se usa `pull_request_target`, que sí las expondría.',
    }
  }
  // Dependabot corre con su propio contexto: los Actions secrets NO están
  // disponibles (sólo los Dependabot secrets). Un bump de dependencia no puede,
  // ni debe, verificar RLS.
  if (actor === 'dependabot[bot]' || evento === 'dependabot') {
    return {
      clave: 'dependabot',
      titulo: 'ejecución iniciada por Dependabot',
      detalle:
        'Los Actions secrets no se exponen a dependabot[bot]. El aislamiento se ' +
        'verifica en el push a `main` posterior al merge del bump.',
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
