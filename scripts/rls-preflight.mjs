#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Preflight FAIL-CLOSED del job "RLS harness (server-side)".
// ════════════════════════════════════════════════════════════════════════════
// Decide, ANTES de instalar dependencias o abrir ninguna conexión, si el
// harness puede verificar el aislamiento multi-tenant. Tres desenlaces, y sólo
// UNO deja el check en verde:
//
//   run       — están las QUINCE variables RLS_* (siete de aislamiento por
//               tenant + ocho del gate por clase) y el destino está declarado y
//               validado: el harness se ejecuta entero. Exit 0.
//   bloqueado — GitHub no entrega los Actions secrets por diseño (PR de fork o
//               de dependabot[bot]). Exit 1: el check queda ROJO.
//   fail      — TODO lo demás: faltan variables, o la URL apunta a un destino
//               no declarado / a producción. Exit 1.
//
// POR QUÉ "bloqueado" TAMBIÉN ES ROJO
// Antes, fork y Dependabot salían con exit 0 y un `::notice`. Eso producía un
// check VERDE en un PR cuyo aislamiento NADIE había verificado, y un check verde
// es exactamente lo que autoriza a fusionar. El argumento de entonces —«se
// valida en el push a `main` posterior»— confunde detección con prevención: para
// cuando ese push falla, el cambio YA ESTÁ en main. Un fallo posterior al merge
// no previene nada.
//
// Ahora la omisión bloquea. Para desbloquear un PR de fork o de Dependabot hay
// que conseguir una ejecución CONFIABLE en una rama interna del repo —donde los
// secretos sí llegan— y comprobar allí que el harness pasa; el resumen del job
// lo explica paso a paso. Es más trabajo, y es el trabajo correcto: la
// alternativa era fusionar sin verificar y llamarlo verificado.
//
// `pull_request_target` NO se usa: expondría los secretos al código del PR, que
// es un problema peor que el que resolvería.
//
// Vive en Node y no inline en el YAML para poder probarlo:
// `scripts/__tests__/rls-preflight.test.mjs` cubre los contextos uno a uno.
// ════════════════════════════════════════════════════════════════════════════

import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { validarDestino } from './rls-destino.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))

/** Manifiesto compartido: dominios permitidos y ref de producción prohibido. */
export function cargarCobertura(ruta = join(AQUI, '..', 'src', 'test', 'rls', 'coverage.json')) {
  return JSON.parse(readFileSync(ruta, 'utf8'))
}

/**
 * Las SIETE variables del aislamiento multi-tenant. Sus NOMBRES no son secretos.
 *
 * `RLS_EXPECTED_PROJECT_REF` no es una credencial: es la DECLARACIÓN de contra
 * qué proyecto se va a operar. Sin ella, cambiar el secreto `RLS_SUPABASE_URL`
 * bastaría para que el harness —que hace INSERT, UPDATE y DELETE— apuntara a
 * otro proyecto sin que nada lo notara. Con ella, la URL y la declaración tienen
 * que coincidir o el job aborta.
 */
export const VARIABLES_TENANT = [
  'RLS_SUPABASE_URL',
  'RLS_SUPABASE_ANON_KEY',
  'RLS_EXPECTED_PROJECT_REF',
  'RLS_USER_A_EMAIL',
  'RLS_USER_A_PASSWORD',
  'RLS_USER_B_EMAIL',
  'RLS_USER_B_PASSWORD',
]

/**
 * Las OCHO del gate por CLASE de `paquetes_recibidos` (motor único,
 * 20260829000000): cuatro usuarios de la MISMA empresa.
 *
 * POR QUÉ SON OBLIGATORIAS Y NO "OPCIONALES SI ESTÁN".
 * Mientras no existieron, la suite del gate se auto-saltaba con un
 * `describe.skipIf` y el job terminaba VERDE con 13 pruebas omitidas. Ese es
 * exactamente el falso verde por omisión que este preflight existe para
 * eliminar, sólo que un nivel más abajo: no ya "el harness no corrió", sino
 * "corrió pero sin el bloque que verifica que un operador de paquetería no
 * puede tocar una notificación legal".
 *
 * Se siembran con `scripts/seed-rls-sandbox.mjs`, que las crea, verifica el
 * login de cada una y las imprime.
 */
export const VARIABLES_CLASE = [
  'RLS_USER_PAQ_EMAIL',
  'RLS_USER_PAQ_PASSWORD',
  'RLS_USER_CORR_EMAIL',
  'RLS_USER_CORR_PASSWORD',
  'RLS_USER_ADMIN_EMAIL',
  'RLS_USER_ADMIN_PASSWORD',
  'RLS_USER_OWNER_EMAIL',
  'RLS_USER_OWNER_PASSWORD',
]

/** Las quince: sin TODAS, el job falla. */
export const VARIABLES_RLS = [...VARIABLES_TENANT, ...VARIABLES_CLASE]

/**
 * Contextos en los que GitHub NO entrega los Actions secrets al ejecutor, así
 * que la ausencia de variables es estructural y no un error de configuración.
 *
 * Identificarlos NO los absuelve: el desenlace sigue siendo rojo. Sirve para
 * que el mensaje diga la verdad —«esto no lo arreglás poniendo los secretos»— y
 * explique cómo desbloquear.
 *
 * Sólo aplica a eventos `pull_request`. En `push` no hay contexto que valga: si
 * faltan las variables es un fallo de configuración, incluso si el actor es
 * dependabot[bot] (lo que ocurre de verdad cuando hay auto-merge).
 */
export function motivoSinSecretos({ esFork, actor, evento }) {
  const esPullRequest = evento === undefined || evento === 'pull_request'
  if (!esPullRequest) return null

  if (esFork === true || esFork === 'true') {
    return {
      clave: 'fork',
      titulo: 'PR desde un fork',
      detalle:
        'GitHub no expone secretos a los forks por diseño, y no se usa ' +
        '`pull_request_target`, que sí los expondría al código del PR. El harness NO ' +
        'se ejecutó, así que el aislamiento multi-tenant de este cambio está SIN ' +
        'verificar y el check queda en rojo.',
    }
  }

  // Dependabot corre con su propio contexto: los Actions secrets NO están
  // disponibles (sólo los *Dependabot secrets*, que son un almacén aparte).
  if (actor === 'dependabot[bot]') {
    return {
      clave: 'dependabot',
      titulo: 'PR de Dependabot',
      detalle:
        'Los Actions secrets no se exponen a dependabot[bot]. El harness NO se ' +
        'ejecutó, así que el check queda en rojo. Para que los PR de Dependabot ' +
        'verifiquen por sí solos, declará las siete variables también como ' +
        '*Dependabot secrets* con los mismos nombres (Settings → Secrets and ' +
        'variables → Dependabot).',
    }
  }
  return null
}

/** Cómo desbloquear un PR que no puede recibir secretos. Sin esto, "rojo" es un callejón. */
const COMO_DESBLOQUEAR = [
  'Cómo desbloquear este PR (en este orden):',
  '1. Reproducí el cambio en una rama INTERNA del repositorio (`git checkout -b … && git cherry-pick …`',
  '   o `gh pr checkout` y push a una rama del propio repo). Ahí los Actions secrets sí llegan.',
  '2. Comprobá que el job `RLS harness (server-side)` pasa en verde sobre ESE commit,',
  '   con pruebas > 0 y todos los escenarios obligatorios.',
  '3. Fusioná esa rama interna. El PR original se puede cerrar como duplicado.',
  '',
  'Lo que NO cuenta como verificación: fusionar y esperar al push a `main`. Para cuando',
  'ese job falle, el cambio ya está en main — eso es detección, no prevención.',
]

/**
 * Decide el desenlace. Pura: no toca el entorno ni el disco (la cobertura entra
 * por parámetro).
 *
 * @returns {{ decision: 'run'|'bloqueado'|'fail', faltan: string[], motivo: object|null,
 *             destino: object|null, mensaje: string }}
 */
export function decidirPreflight(env = {}, cobertura = {}) {
  const faltan = VARIABLES_RLS.filter((v) => !env[v])

  if (faltan.length > 0) {
    const motivo = motivoSinSecretos({
      esFork: env.ES_FORK,
      actor: env.GITHUB_ACTOR,
      evento: env.GITHUB_EVENT_NAME,
    })

    if (motivo) {
      return {
        decision: 'bloqueado',
        faltan,
        motivo,
        destino: null,
        mensaje:
          `Harness RLS NO ejecutado (${motivo.titulo}). ${motivo.detalle} ` +
          'El check queda en rojo a propósito: un verde aquí autorizaría a fusionar ' +
          'un cambio cuyo aislamiento nadie verificó.',
      }
    }

    return {
      decision: 'fail',
      faltan,
      motivo: null,
      destino: null,
      mensaje:
        `Faltan ${faltan.length} de ${VARIABLES_RLS.length} variables RLS_* (${faltan.join(' ')}). ` +
        'El job falla en vez de quedar verde: ' +
        'un verde sin ejecutar se contabiliza como cobertura que no existe. ' +
        (env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_ACTOR === 'dependabot[bot]'
          ? 'Este push a main lo inició Dependabot: aquí no hay omisión posible. '
          : '') +
        'Ver docs/ACTIVAR_HARNESS_RLS.md.',
    }
  }

  // Están las siete. Falta lo más importante: que apunten a donde dicen.
  // Esto ocurre ANTES de setup-node, de `npm ci` y de cualquier conexión.
  const destino = validarDestino({
    url: env.RLS_SUPABASE_URL,
    esperado: env.RLS_EXPECTED_PROJECT_REF,
    cobertura,
    variable: 'RLS_EXPECTED_PROJECT_REF',
  })

  if (!destino.ok) {
    return {
      decision: 'fail',
      faltan,
      motivo: null,
      destino,
      mensaje:
        `Destino RLS RECHAZADO: ${destino.motivo} ` +
        'El harness escribe y borra filas: no se conecta a un proyecto que no esté ' +
        'declarado. No se instaló nada ni se abrió ninguna conexión.',
    }
  }

  return {
    decision: 'run',
    faltan,
    motivo: null,
    destino,
    mensaje:
      `Las ${VARIABLES_RLS.length} variables RLS_* están presentes y el destino está declarado ` +
      `(ref ${destino.ref}): el harness se ejecuta entero, gate por clase incluido.`,
  }
}

/** Resumen Markdown para la UI de Actions. Sólo nombres de variable y el ref, nunca valores. */
export function resumenMarkdown({ decision, faltan, motivo, destino }) {
  if (decision === 'run') {
    return [
      `### ▶️ Harness RLS: las ${VARIABLES_RLS.length} variables \`RLS_*\` están presentes, se ejecuta.`,
      '',
      `Destino declarado y validado: ref \`${destino.ref}\` (no es producción, dominio Supabase reconocido).`,
      '',
    ].join('\n')
  }

  if (decision === 'bloqueado') {
    return [
      `### ❌ Harness RLS NO ejecutado — ${motivo.titulo} (PR bloqueado)`,
      '',
      motivo.detalle,
      '',
      `Variables no disponibles: ${faltan.map((v) => `\`${v}\``).join(', ')}`,
      '',
      ...COMO_DESBLOQUEAR,
      '',
    ].join('\n')
  }

  if (destino && !destino.ok) {
    return [
      '### ❌ Harness RLS abortado — el destino no está declarado',
      '',
      destino.motivo,
      '',
      'El harness hace `INSERT`, `UPDATE` y `DELETE` de filas de prueba. Apuntarlo a un',
      'proyecto no declarado no es un CI en rojo: son datos de alguien contaminados. Por eso',
      'la comprobación corre **antes** de instalar dependencias y antes de abrir ninguna conexión.',
      '',
      'Corregí `RLS_SUPABASE_URL` o `RLS_EXPECTED_PROJECT_REF` — uno de los dos está mal.',
      '',
    ].join('\n')
  }

  const faltanTenant = faltan.filter((v) => VARIABLES_TENANT.includes(v))
  const faltanClase = faltan.filter((v) => VARIABLES_CLASE.includes(v))

  return [
    '### ❌ Harness RLS sin configurar — el job FALLA (fail-closed)',
    '',
    'El aislamiento multi-tenant **no se verificó** y este job ya no se queda verde',
    'por ello. Faltan estas variables de repositorio:',
    '',
    ...(faltanTenant.length > 0
      ? ['**Aislamiento por tenant:**', ...faltanTenant.map((v) => `- \`${v}\``), '']
      : []),
    ...(faltanClase.length > 0
      ? [
          '**Gate por clase de `paquetes_recibidos`** (cuatro usuarios de la MISMA empresa):',
          ...faltanClase.map((v) => `- \`${v}\``),
          '',
          'Sin estos ocho, el bloque que comprueba que un operador de paquetería NO puede',
          'leer ni borrar una notificación legal **no se ejecuta**. Antes se auto-saltaba y',
          'el job quedaba verde con 13 pruebas omitidas; ahora falla, que es lo honesto.',
          '',
        ]
      : []),
    'Se exigen **las quince**: con la URL puesta pero una credencial vacía, el harness',
    'se auto-saltaba y terminaba verde con **cero** pruebas. `RLS_EXPECTED_PROJECT_REF`',
    'no es una credencial: es la declaración del proyecto contra el que se opera, y sin',
    'ella cambiar la URL bastaría para escribir en otro sitio.',
    '',
    'Activación: **`docs/ACTIVAR_HARNESS_RLS.md`** → `scripts/seed-rls-sandbox.mjs`,',
    'que crea las seis cuentas, verifica el login de cada una e imprime los quince valores.',
    '',
  ].join('\n')
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function main(env) {
  const veredicto = decidirPreflight(env, cargarCobertura())
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
  if (decision === 'bloqueado') {
    // Rojo, no notice: este PR no se puede fusionar sin una ejecución real.
    console.log(`::error title=Harness RLS no ejecutado — PR bloqueado::${mensaje}`)
    console.log(COMO_DESBLOQUEAR.join('\n'))
    return 1
  }
  console.log(`::error title=Harness RLS sin configurar::${mensaje}`)
  return 1
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.env))
}
