#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Compuerta FAIL-CLOSED: no se despliega una edge function hasta que las
// migraciones DEL MISMO COMMIT terminaron bien.
// ════════════════════════════════════════════════════════════════════════════
// EL FALLO QUE CIERRA
//
// `apply-migrations-prod.yml` y `deploy-functions.yml` se disparan los dos con
// el push a `main`, por caminos distintos (`supabase/migrations/**` y
// `supabase/functions/**`) y sin ninguna relación entre sí. GitHub los arranca
// EN PARALELO. Un commit que cambia las dos cosas —como el motor de recepción—
// se despliega en un orden que nadie decide:
//
//   · `20260902000000` hace DROP de `paquete_reclamar_aviso(uuid, integer)` y
//     `paquete_finalizar_aviso(uuid, boolean)` y crea las de tres argumentos.
//   · La `notify-package` nueva llama a las de TRES argumentos.
//
//   Si la función gana la carrera → llama a una firma que todavía no existe y
//   TODO aviso falla hasta que las migraciones terminen.
//   Y si el Environment `production-db` exige aprobación humana, la carrera no
//   está reñida: la función despliega en dos minutos y el SQL se queda esperando
//   a que alguien apruebe, quizá horas. La ventana de rotura no es de segundos.
//
// POR QUÉ NO SE RESUELVE CON UNA ESPERA FIJA
// Un `sleep 300` no sabe nada: si las migraciones tardan más, despliega igual
// sobre una base sin migrar; si tardan menos, regala cinco minutos. Y con una
// aprobación humana de por medio no hay número correcto. Aquí se espera al
// ESTADO OBSERVADO de la corrida —no al reloj— y el vencimiento del plazo
// máximo ABORTA el despliegue, no lo autoriza.
//
// POR QUÉ NO SE RESUELVE CON `workflow_run`
// Encadenar `deploy-functions` a `workflow_run` de las migraciones parece lo
// natural, pero rompe el caso normal: un push que sólo toca
// `supabase/functions/**` NO dispara el workflow de migraciones (su `paths` no
// casa), así que el evento nunca llegaría y las funciones no se desplegarían
// jamás. La compuerta tiene que distinguir «todavía no ha corrido» de «no tiene
// por qué correr», y eso lo decide el diff del propio push.
//
// CÓMO DECIDE
//   1. ¿Este commit toca `supabase/migrations/**`?  Lo calcula el workflow con
//      git y lo pasa en REQUIERE_MIGRACIONES. Fail-closed: si el rango no es
//      verificable (force-push, `before` inalcanzable), se asume que SÍ.
//   2. Si no las toca → se despliega sin más: no hay nada que ordenar.
//   3. Si las toca → se consulta la API de Actions por corridas de
//      `apply-migrations-prod.yml` con ESE head_sha y ese evento, y se espera a
//      que una llegue a conclusión:
//        · success                        → desplegar.
//        · cualquier otra conclusión      → abortar.
//        · queued / in_progress / waiting → seguir esperando (`waiting` es
//          justamente el Environment pidiendo aprobación).
//        · ninguna corrida todavía        → seguir esperando; si nunca aparece,
//          vence el plazo y se aborta.
//
// El módulo es PURO salvo el bucle del CLI: `decidirPuerta` no toca la red ni
// el reloj, así que su tabla de verdad se prueba entera en
// `scripts/__tests__/esperar-migraciones.test.mjs`.
//
// USO
//   node scripts/esperar-migraciones.mjs
// Variables: GITHUB_REPOSITORY, GITHUB_TOKEN, GITHUB_SHA, WORKFLOW_MIGRACIONES,
//            REQUIERE_MIGRACIONES, EVENTO_ESPERADO, ESPERA_MAX_SEGUNDOS,
//            INTERVALO_SEGUNDOS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Conclusiones de GitHub Actions que NO son un éxito. Se enumeran en positivo
 * al revés —sólo `success` deja pasar— para que una conclusión nueva que
 * GitHub invente mañana caiga del lado seguro en vez de colarse.
 */
export const CONCLUSION_BUENA = 'success'

/** Estados en los que la corrida todavía puede acabar bien. */
export const ESTADOS_EN_CURSO = ['queued', 'in_progress', 'waiting', 'requested', 'pending']

/**
 * Clasifica UNA corrida.
 * @returns {'ok'|'fallo'|'en_curso'}
 */
export function clasificarRun(run) {
  const estado = run?.status ?? ''
  if (ESTADOS_EN_CURSO.includes(estado)) return 'en_curso'
  // `completed` (o cualquier estado desconocido): manda la conclusión, y sólo
  // `success` vale. `skipped` incluido: una corrida saltada no aplicó SQL.
  return run?.conclusion === CONCLUSION_BUENA ? 'ok' : 'fallo'
}

/**
 * Decide qué hacer con lo observado. Pura: ni red ni reloj.
 *
 * @param {object} o
 * @param {boolean} o.requiereMigraciones  ¿el commit toca supabase/migrations/**?
 * @param {Array<object>|null} o.runs      corridas del workflow para ESTE sha, o
 *                                          null si la consulta falló.
 * @param {boolean} [o.plazoVencido]       ya no queda tiempo de espera.
 * @returns {{ decision: 'desplegar'|'esperar'|'abortar', motivo: string }}
 */
export function decidirPuerta({ requiereMigraciones, runs, plazoVencido = false }) {
  if (!requiereMigraciones) {
    return {
      decision: 'desplegar',
      motivo: 'este commit no toca supabase/migrations/**: no hay migraciones que esperar.',
    }
  }

  if (runs === null || runs === undefined) {
    // No se pudo leer el estado. Desplegar «porque no sabemos» es exactamente
    // el fallo abierto que esta compuerta existe para impedir.
    return {
      decision: 'abortar',
      motivo: 'no se pudo consultar el estado de las migraciones. Sin saberlo, no se despliega.',
    }
  }

  if (runs.some((r) => clasificarRun(r) === 'ok')) {
    return {
      decision: 'desplegar',
      motivo: 'las migraciones de este commit terminaron con éxito.',
    }
  }

  const enCurso = runs.filter((r) => clasificarRun(r) === 'en_curso')
  if (enCurso.length > 0) {
    if (plazoVencido) {
      return {
        decision: 'abortar',
        motivo:
          `venció el plazo de espera y las migraciones siguen en ${enCurso[0].status}. ` +
          'No se despliega sobre una base a medio migrar: aprobá/arreglá la corrida de ' +
          'migraciones y relanzá este workflow.',
      }
    }
    const esperandoAprobacion = enCurso.some((r) => r.status === 'waiting')
    return {
      decision: 'esperar',
      motivo: esperandoAprobacion
        ? 'las migraciones esperan la aprobación del Environment production-db.'
        : `las migraciones están en ${enCurso[0].status}.`,
    }
  }

  const fallidas = runs.filter((r) => clasificarRun(r) === 'fallo')
  if (fallidas.length > 0) {
    const c = fallidas.map((r) => r.conclusion ?? r.status).join(', ')
    return {
      decision: 'abortar',
      motivo:
        `las migraciones de este commit NO terminaron bien (${c}). ` +
        'Desplegar la función ahora la dejaría llamando a firmas que no existen.',
    }
  }

  // Lista vacía: el workflow todavía no arrancó. Puede tardar en aparecer.
  if (plazoVencido) {
    return {
      decision: 'abortar',
      motivo:
        'el commit toca supabase/migrations/** pero nunca apareció una corrida de migraciones. ' +
        'Se aborta en vez de desplegar a ciegas.',
    }
  }
  return { decision: 'esperar', motivo: 'todavía no hay corrida de migraciones para este commit.' }
}

/** Construye la URL de consulta. Separada para poder afirmarla en las pruebas. */
export function urlDeRuns({ repo, workflow, sha, evento }) {
  const base = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs`
  const q = new URLSearchParams({ head_sha: sha, per_page: '20' })
  // Filtrar por evento importa: un `workflow_dispatch` con `migration_file`
  // aplica UN archivo y termina en success, y eso no acredita que las
  // migraciones del push estén todas aplicadas.
  if (evento) q.set('event', evento)
  return `${base}?${q}`
}

/**
 * Lee las corridas. Devuelve null ante CUALQUIER problema — la distinción entre
 * «no hay corridas» (array vacío) y «no pude preguntar» (null) es la que decide
 * si se aborta o se sigue esperando.
 */
export async function leerRuns({ repo, workflow, sha, evento, token, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(urlDeRuns({ repo, workflow, sha, evento }), {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    if (!res?.ok) return null
    const cuerpo = await res.json()
    const runs = cuerpo?.workflow_runs
    return Array.isArray(runs) ? runs : null
  } catch {
    return null
  }
}

/** Resumen Markdown para la UI de Actions. Nunca lleva secretos. */
export function resumenMarkdown({ decision, motivo }, { sha, workflow }) {
  const titulo = {
    desplegar: '### ▶️ Compuerta de migraciones: vía libre',
    abortar: '### ⛔ Despliegue de funciones ABORTADO por la compuerta de migraciones',
    esperar: '### ⏳ Esperando a las migraciones',
  }[decision]

  const cuerpo = [titulo, '', motivo, '', `- Commit: \`${sha}\``, `- Workflow vigilado: \`${workflow}\``]

  if (decision === 'abortar') {
    cuerpo.push(
      '',
      'Las edge functions de este commit llaman a firmas SQL que crea la migración',
      'de este MISMO commit. Desplegarlas antes —o sin— ella deja la función llamando',
      'a algo que no existe.',
      '',
      'Qué hacer: aprobá o corregí la corrida de `apply-migrations-prod.yml` para este',
      'commit y volvé a lanzar este workflow. No hay atajo por tiempo: la compuerta',
      'mira el estado real de esa corrida, no el reloj.',
    )
  }
  return cuerpo.join('\n') + '\n'
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

export async function main(env = process.env, { fetchImpl = fetch, ahora = Date.now, log = console.log } = {}) {
  const repo = env.GITHUB_REPOSITORY
  const sha = env.GITHUB_SHA
  const workflow = env.WORKFLOW_MIGRACIONES || 'apply-migrations-prod.yml'
  const evento = env.EVENTO_ESPERADO || ''
  const requiereMigraciones = env.REQUIERE_MIGRACIONES === 'true'
  const plazoMs = Number(env.ESPERA_MAX_SEGUNDOS ?? 3600) * 1000
  const intervaloMs = Number(env.INTERVALO_SEGUNDOS ?? 20) * 1000

  const emitir = async (veredicto) => {
    if (env.GITHUB_STEP_SUMMARY) {
      const { appendFileSync } = await import('node:fs')
      appendFileSync(env.GITHUB_STEP_SUMMARY, resumenMarkdown(veredicto, { sha, workflow }))
    }
  }

  if (!requiereMigraciones) {
    const v = decidirPuerta({ requiereMigraciones: false, runs: [] })
    log(v.motivo)
    await emitir(v)
    return 0
  }

  if (!repo || !sha) {
    const v = { decision: 'abortar', motivo: 'faltan GITHUB_REPOSITORY o GITHUB_SHA: no se puede identificar la corrida a esperar.' }
    log(`::error title=Compuerta de migraciones::${v.motivo}`)
    await emitir(v)
    return 1
  }

  const limite = ahora() + plazoMs
  // El bucle NO es una espera por tiempo: sale en cuanto la corrida llega a una
  // conclusión. El plazo sólo acota cuánto se espera antes de ABORTAR — nunca
  // autoriza el despliegue.
  for (;;) {
    const runs = await leerRuns({ repo, workflow, sha, evento, token: env.GITHUB_TOKEN, fetchImpl })
    const plazoVencido = ahora() >= limite
    const veredicto = decidirPuerta({ requiereMigraciones: true, runs, plazoVencido })

    if (veredicto.decision === 'desplegar') {
      log(`✅ ${veredicto.motivo}`)
      await emitir(veredicto)
      return 0
    }
    if (veredicto.decision === 'abortar') {
      log(`::error title=Despliegue bloqueado por la compuerta de migraciones::${veredicto.motivo}`)
      await emitir(veredicto)
      return 1
    }
    log(`⏳ ${veredicto.motivo} Reintento en ${Math.round(intervaloMs / 1000)}s.`)
    await dormir(intervaloMs)
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main(process.env))
}
