// ════════════════════════════════════════════════════════════════════════════
// Prueba CONTRACTUAL del orden migraciones → edge functions.
// ════════════════════════════════════════════════════════════════════════════
// EL FALLO QUE ESTO IMPIDE VOLVER A PERDER
//
// `apply-migrations-prod.yml` y `deploy-functions.yml` se disparan los dos con
// el push a `main`, por `paths` distintos y sin relación entre sí, así que
// GitHub los arranca EN PARALELO. Un commit que cambia las dos cosas se
// despliega en un orden que nadie decide:
//
//   · `20260902000000` hace DROP de `paquete_reclamar_aviso(uuid, integer)` y
//     `paquete_finalizar_aviso(uuid, boolean)` y crea las de TRES argumentos.
//   · La `notify-package` de ese mismo commit llama a las de tres argumentos.
//
// Si la función gana, llama a firmas que no existen y todo aviso falla. Y con la
// aprobación del Environment `production-db` de por medio no hay carrera: la
// función sale en minutos y el SQL espera a un humano.
//
// Se cubren las dos mitades del contrato:
//   1. la TABLA DE VERDAD de la compuerta (`decidirPuerta`), incluido el caso
//      que más importa — no poder consultar el estado NO autoriza a desplegar;
//   2. que el WORKFLOW REAL la use, en el orden correcto, sin esperas por
//      tiempo fijo y sin permitir despliegues concurrentes.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  clasificarRun,
  decidirPuerta,
  leerRuns,
  main,
  resumenMarkdown,
  urlDeRuns,
} from '../esperar-migraciones.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const YAML_FN = readFileSync(join(RAIZ, '.github', 'workflows', 'deploy-functions.yml'), 'utf8')
const YAML_MIG = readFileSync(join(RAIZ, '.github', 'workflows', 'apply-migrations-prod.yml'), 'utf8')
const LINEAS_FN = YAML_FN.split('\n')

const run = (status, conclusion = null) => ({ status, conclusion })

// ── 1. La tabla de verdad ───────────────────────────────────────────────────

describe('clasificarRun', () => {
  it('sólo `success` cuenta como éxito', () => {
    expect(clasificarRun(run('completed', 'success'))).toBe('ok')
  })

  it('toda otra conclusión es fallo, incluidas las que parecen inocuas', () => {
    // `skipped` y `neutral` son las traicioneras: no son errores, pero tampoco
    // aplicaron SQL. Tratarlas como éxito desplegaría sobre una base sin migrar.
    for (const c of ['failure', 'cancelled', 'timed_out', 'action_required', 'skipped', 'neutral', 'stale', 'startup_failure', null]) {
      expect(clasificarRun(run('completed', c)), `conclusión ${c}`).toBe('fallo')
    }
  })

  it('una conclusión que GitHub invente mañana cae del lado seguro', () => {
    expect(clasificarRun(run('completed', 'algo_nuevo_de_github'))).toBe('fallo')
  })

  it('los estados en curso se reconocen, `waiting` incluido', () => {
    for (const s of ['queued', 'in_progress', 'waiting', 'requested', 'pending']) {
      expect(clasificarRun(run(s)), `estado ${s}`).toBe('en_curso')
    }
  })
})

describe('decidirPuerta — el commit no toca migraciones', () => {
  it('despliega sin esperar nada', () => {
    // Es el caso normal: un push que sólo cambia edge functions no dispara el
    // workflow de migraciones, así que esperar una corrida que nunca va a
    // existir dejaría las funciones sin desplegar para siempre. Es también la
    // razón por la que esto no se resuelve con `workflow_run`.
    const v = decidirPuerta({ requiereMigraciones: false, runs: null })
    expect(v.decision).toBe('desplegar')
  })
})

describe('decidirPuerta — fail-closed', () => {
  it('NO poder consultar el estado ABORTA; nunca despliega', () => {
    // El corazón del asunto. Un token caído, un 500 de la API o una respuesta
    // con otra forma no pueden traducirse en «adelante»: sería exactamente el
    // fallo abierto que la compuerta existe para impedir.
    for (const runs of [null, undefined]) {
      const v = decidirPuerta({ requiereMigraciones: true, runs })
      expect(v.decision).toBe('abortar')
      expect(v.motivo).toMatch(/no se pudo consultar/)
    }
  })

  it('las migraciones fallidas ABORTAN el despliegue', () => {
    const v = decidirPuerta({ requiereMigraciones: true, runs: [run('completed', 'failure')] })
    expect(v.decision).toBe('abortar')
    expect(v.motivo).toMatch(/firmas que no existen/)
  })

  it('una corrida CANCELADA no es vía libre', () => {
    expect(decidirPuerta({ requiereMigraciones: true, runs: [run('completed', 'cancelled')] }).decision).toBe('abortar')
  })

  it('vencer el plazo con las migraciones en curso ABORTA, no autoriza', () => {
    // La diferencia entre esto y un `sleep`: agotar el tiempo es un fallo, no
    // un permiso.
    const v = decidirPuerta({ requiereMigraciones: true, runs: [run('in_progress')], plazoVencido: true })
    expect(v.decision).toBe('abortar')
    expect(v.motivo).toMatch(/venció el plazo/)
  })

  it('que nunca aparezca una corrida ABORTA', () => {
    const v = decidirPuerta({ requiereMigraciones: true, runs: [], plazoVencido: true })
    expect(v.decision).toBe('abortar')
    expect(v.motivo).toMatch(/nunca apareció/)
  })
})

describe('decidirPuerta — espera al ESTADO, no al reloj', () => {
  it('espera mientras las migraciones estén en curso', () => {
    expect(decidirPuerta({ requiereMigraciones: true, runs: [run('in_progress')] }).decision).toBe('esperar')
    expect(decidirPuerta({ requiereMigraciones: true, runs: [run('queued')] }).decision).toBe('esperar')
  })

  it('la aprobación pendiente del Environment se espera, no se adelanta', () => {
    // `waiting` es como GitHub reporta un job detenido en un Environment con
    // reviewers. Si esto devolviera 'desplegar', la función saldría a producción
    // mientras el SQL espera a que alguien apruebe — la ventana más ancha de
    // todas, medida en horas.
    const v = decidirPuerta({ requiereMigraciones: true, runs: [run('waiting')] })
    expect(v.decision).toBe('esperar')
    expect(v.motivo).toMatch(/aprobación del Environment production-db/)
  })

  it('espera aunque todavía no exista ninguna corrida', () => {
    expect(decidirPuerta({ requiereMigraciones: true, runs: [] }).decision).toBe('esperar')
  })

  it('un éxito manda sobre una corrida vieja fallida del mismo commit', () => {
    // Re-ejecutar el workflow tras arreglar el token crea otra corrida. Si la
    // buena existe, el commit está migrado.
    const v = decidirPuerta({
      requiereMigraciones: true,
      runs: [run('completed', 'failure'), run('completed', 'success')],
    })
    expect(v.decision).toBe('desplegar')
  })
})

// ── 2. La consulta ──────────────────────────────────────────────────────────

describe('urlDeRuns', () => {
  it('consulta por el head_sha exacto', () => {
    const u = urlDeRuns({ repo: 'o/r', workflow: 'apply-migrations-prod.yml', sha: 'abc123', evento: 'push' })
    expect(u).toContain('/repos/o/r/actions/workflows/apply-migrations-prod.yml/runs')
    expect(u).toContain('head_sha=abc123')
  })

  it('filtra por evento: un dispatch de UN archivo no acredita el commit entero', () => {
    // `workflow_dispatch` con `migration_file` aplica una sola migración y
    // termina en success. Contarla como «el commit está migrado» sería falso.
    expect(urlDeRuns({ repo: 'o/r', workflow: 'w.yml', sha: 's', evento: 'push' })).toContain('event=push')
    expect(urlDeRuns({ repo: 'o/r', workflow: 'w.yml', sha: 's', evento: '' })).not.toContain('event=')
  })
})

describe('leerRuns — distingue "no hay" de "no pude preguntar"', () => {
  const ok = (body) => ({ ok: true, json: async () => body })

  it('devuelve el array cuando la API responde bien', async () => {
    const r = await leerRuns({ repo: 'o/r', workflow: 'w', sha: 's', fetchImpl: async () => ok({ workflow_runs: [run('completed', 'success')] }) })
    expect(r).toHaveLength(1)
  })

  it('un array VACÍO es "todavía no hay corrida", no un error', async () => {
    const r = await leerRuns({ repo: 'o/r', workflow: 'w', sha: 's', fetchImpl: async () => ok({ workflow_runs: [] }) })
    expect(r).toEqual([])
  })

  it('HTTP no-2xx devuelve null (y null aborta)', async () => {
    const r = await leerRuns({ repo: 'o/r', workflow: 'w', sha: 's', fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) })
    expect(r).toBeNull()
  })

  it('una respuesta con otra forma devuelve null', async () => {
    for (const cuerpo of [{}, { workflow_runs: 'nope' }, null]) {
      expect(await leerRuns({ repo: 'o/r', workflow: 'w', sha: 's', fetchImpl: async () => ok(cuerpo) })).toBeNull()
    }
  })

  it('una excepción de red devuelve null', async () => {
    const r = await leerRuns({ repo: 'o/r', workflow: 'w', sha: 's', fetchImpl: async () => { throw new Error('ECONNRESET') } })
    expect(r).toBeNull()
  })

  it('manda el token como Bearer y la versión de la API', async () => {
    let visto = null
    await leerRuns({ repo: 'o/r', workflow: 'w', sha: 's', token: 't0k', fetchImpl: async (_u, o) => { visto = o; return ok({ workflow_runs: [] }) } })
    expect(visto.headers.Authorization).toBe('Bearer t0k')
    expect(visto.headers['X-GitHub-Api-Version']).toBe('2022-11-28')
  })
})

// ── 3. El CLI de punta a punta ──────────────────────────────────────────────

describe('main', () => {
  const entorno = (over = {}) => ({
    GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'sha1',
    REQUIERE_MIGRACIONES: 'true', ESPERA_MAX_SEGUNDOS: '60', INTERVALO_SEGUNDOS: '0',
    ...over,
  })
  const responde = (runs) => async () => ({ ok: true, json: async () => ({ workflow_runs: runs }) })

  it('sale 0 cuando las migraciones del commit terminaron bien', async () => {
    const code = await main(entorno(), { fetchImpl: responde([run('completed', 'success')]), log: () => {} })
    expect(code).toBe(0)
  })

  it('sale 1 cuando fallaron', async () => {
    const code = await main(entorno(), { fetchImpl: responde([run('completed', 'failure')]), log: () => {} })
    expect(code).toBe(1)
  })

  it('sale 0 sin consultar nada si el commit no toca migraciones', async () => {
    let llamadas = 0
    const code = await main(entorno({ REQUIERE_MIGRACIONES: 'false' }), {
      fetchImpl: async () => { llamadas++; return { ok: true, json: async () => ({ workflow_runs: [] }) } },
      log: () => {},
    })
    expect(code).toBe(0)
    expect(llamadas).toBe(0)
  })

  it('sigue esperando mientras esté en curso y ABORTA al vencer el plazo', async () => {
    // El reloj se inyecta: la prueba no duerme. Se comprueba lo que importa —
    // que reintenta de verdad y que el vencimiento sale 1, no 0.
    let t = 0
    const reloj = () => { t += 10_000; return t }
    let consultas = 0
    const code = await main(entorno({ ESPERA_MAX_SEGUNDOS: '30' }), {
      fetchImpl: async () => { consultas++; return { ok: true, json: async () => ({ workflow_runs: [run('in_progress')] }) } },
      ahora: reloj,
      log: () => {},
    })
    expect(code).toBe(1)
    expect(consultas, 'debe reintentar, no rendirse a la primera').toBeGreaterThan(1)
  })

  it('despliega en cuanto la corrida pasa de in_progress a success', async () => {
    const secuencia = [[run('in_progress')], [run('waiting')], [run('completed', 'success')]]
    let i = 0
    const code = await main(entorno(), {
      fetchImpl: async () => ({ ok: true, json: async () => ({ workflow_runs: secuencia[Math.min(i++, secuencia.length - 1)] }) }),
      log: () => {},
    })
    expect(code).toBe(0)
    expect(i, 'salió en la tercera consulta, no antes ni después').toBe(3)
  })

  it('sin GITHUB_SHA aborta en vez de desplegar a ciegas', async () => {
    const code = await main(entorno({ GITHUB_SHA: '' }), { fetchImpl: responde([]), log: () => {} })
    expect(code).toBe(1)
  })
})

describe('resumenMarkdown', () => {
  it('el abort explica qué hacer y que no hay atajo por tiempo', () => {
    const md = resumenMarkdown({ decision: 'abortar', motivo: 'x' }, { sha: 'abc', workflow: 'w.yml' })
    expect(md).toContain('ABORTADO')
    expect(md).toContain('No hay atajo por tiempo')
    expect(md).toContain('abc')
  })

  it('nunca imprime el token', () => {
    const md = resumenMarkdown({ decision: 'desplegar', motivo: 'ok' }, { sha: 'abc', workflow: 'w.yml' })
    expect(md).not.toMatch(/Bearer|GITHUB_TOKEN/)
  })
})

// ── 4. El workflow REAL cumple el contrato ──────────────────────────────────

describe('deploy-functions.yml respeta el orden', () => {
  it('el job de despliegue DEPENDE de la compuerta', () => {
    // Sin esto, la compuerta correría en paralelo con el deploy y no gatearía
    // nada — que es justo el fallo original, un nivel más adentro.
    expect(YAML_FN).toMatch(/needs:\s*\[check-secrets,\s*lint-functions,\s*esperar-migraciones\]/)
  })

  it('la compuerta invoca el script probado arriba', () => {
    expect(YAML_FN).toContain('node scripts/esperar-migraciones.mjs')
  })

  it('el paso de la compuerta va ANTES que cualquier deploy-fn.sh', () => {
    const iPuerta = LINEAS_FN.findIndex((l) => l.includes('node scripts/esperar-migraciones.mjs'))
    const iDeploy = LINEAS_FN.findIndex((l) => l.includes('deploy-fn.sh'))
    expect(iPuerta).toBeGreaterThanOrEqual(0)
    expect(iDeploy).toBeGreaterThan(iPuerta)
  })

  it('notify-package se despliega, y por tanto queda detrás de la compuerta', () => {
    // La función concreta del incidente: llama a las firmas de tres argumentos
    // que crea la migración del mismo commit.
    expect(YAML_FN).toContain('deploy-fn.sh notify-package')
  })

  it('vigila el workflow de migraciones correcto', () => {
    expect(YAML_FN).toContain('WORKFLOW_MIGRACIONES: apply-migrations-prod.yml')
  })

  it('pide permiso de lectura de Actions (sin él no puede consultar el estado)', () => {
    expect(YAML_FN).toMatch(/permissions:[\s\S]{0,200}actions:\s*read/)
  })

  it('NO hay esperas por tiempo fijo en el workflow', () => {
    // Un `sleep` no sabe si las migraciones acabaron: si tardan más, despliega
    // igual sobre una base a medio migrar. Se prohíbe explícitamente.
    const codigo = LINEAS_FN.filter((l) => !/^\s*#/.test(l)).join('\n')
    expect(codigo).not.toMatch(/\bsleep\s+\d/)
    expect(codigo).not.toMatch(/\btimeout\s+\d+\s/)
  })

  it('NO permite despliegues concurrentes', () => {
    expect(YAML_FN).toMatch(/concurrency:[\s\S]{0,200}group:\s*deploy-functions-prod/)
    // Cancelar a medias dejaría unas funciones en una versión y otras en otra.
    expect(YAML_FN).toMatch(/concurrency:[\s\S]{0,200}cancel-in-progress:\s*false/)
  })

  it('el cálculo de "¿hay migraciones?" es fail-closed', () => {
    // Los tres caminos que no permiten afirmar que NO hay migraciones tienen que
    // asumir que SÍ: evento sin rango, `before` nulo y `before` inalcanzable.
    expect(YAML_FN).toContain('0000000000000000000000000000000000000000')
    expect(YAML_FN).toContain('git cat-file -e "${PUSH_BEFORE}^{commit}"')
    const requiereTrue = (YAML_FN.match(/echo "requiere=true" >> "\$GITHUB_OUTPUT"/g) ?? []).length
    expect(requiereTrue, 'los tres caminos inciertos deben poner requiere=true').toBeGreaterThanOrEqual(3)
  })

  it('usa --no-renames al mirar el diff de migraciones', () => {
    // Un renombre aparece como una sola entrada R y se escaparía del filtro,
    // haciendo creer que el commit no trae migraciones cuando sí las trae.
    expect(YAML_FN).toMatch(/git diff --name-only --no-renames[^\n]*supabase\/migrations/)
  })

  it('sólo acredita la corrida del PUSH', () => {
    expect(YAML_FN).toMatch(/EVENTO_ESPERADO:.*github\.event_name == 'push'.*'push'/)
  })

  it('el override manual existe SÓLO para workflow_dispatch y deja rastro', () => {
    expect(YAML_FN).toContain('migraciones_ya_aplicadas')
    expect(YAML_FN).toMatch(/if \[ "\$EVENT_NAME" = "workflow_dispatch" \] && \[ "\$\{OMITIR:-false\}" = "true" \]/)
    expect(YAML_FN).toContain('::warning::Compuerta OMITIDA a mano')
    // Por defecto NO se omite.
    expect(YAML_FN).toMatch(/migraciones_ya_aplicadas:[\s\S]{0,220}default:\s*false/)
  })
})

describe('apply-migrations-prod.yml sigue siendo lo que la compuerta espera', () => {
  it('se dispara con el push a main que toca migraciones', () => {
    // Si dejara de dispararse, la compuerta esperaría una corrida que no llega
    // y abortaría todos los despliegues. Es fail-closed, pero conviene notarlo
    // aquí y no en producción.
    expect(YAML_MIG).toMatch(/push:[\s\S]{0,200}branches:\s*\[main\][\s\S]{0,200}supabase\/migrations/)
  })

  it('mantiene el Environment production-db (la compuerta sabe esperar su aprobación)', () => {
    expect(YAML_MIG).toContain('environment: production-db')
  })

  it('el nombre del archivo es el que la compuerta consulta', () => {
    // La API se consulta por NOMBRE DE ARCHIVO. Renombrarlo sin tocar
    // WORKFLOW_MIGRACIONES rompería la compuerta en silencio.
    expect(YAML_FN).toContain('apply-migrations-prod.yml')
  })
})
