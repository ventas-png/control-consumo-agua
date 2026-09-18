// ════════════════════════════════════════════════════════════════════════════
// schema-drift no puede dispararse por `push`, y su rojo tiene que avisar
// ════════════════════════════════════════════════════════════════════════════
// EL VERDE FALSO —Y EL ROJO LATENTE— QUE ESTO IMPIDE. El veredicto de este
// auditor depende de dos cosas que cambian en momentos distintos: el
// repositorio (en el push) y el catálogo de producción (cuando `Apply
// Migrations to Production` termina, después). Disparar en el push es leer la
// mitad del sistema antes de que la otra mitad se mueva.
//
// Al mergear #875 el push a `main` disparó el run #188 a las 15:55 y salió
// VERDE: la huella todavía coincidía con producción y las dos migraciones
// nuevas se clasificaron como «cambio planificado» — la regla correcta sobre el
// estado correcto de ese instante. El apply terminó a las 15:58, y desde ese
// segundo el auditor estaba en ROJO sobre `main`. Pero LATENTE: con `paths`
// acotado, ningún run volvía a correr hasta que alguien tocara justo esos
// directorios. El rojo existía y nadie lo veía.
//
// Es la misma carrera que `drift-esquema-disparadores.test.mjs` fija para el
// otro auditor, con el signo cambiado: allí produjo un rojo falso (#797), aquí
// un verde falso seguido de un rojo invisible. La defensa es la misma y por la
// misma razón: no tener el disparador.
//
// LA SEGUNDA MITAD. Que corra no basta si su rojo cae donde nadie mira. Este
// auditor se pone rojo POR SU CUENTA —al terminar el apply, o en el run
// diario—, no a raíz de algo que alguien acaba de empujar y está vigilando; si
// `ci-alert.yml` no lo escucha, el silencio de antes sólo cambia de sitio.
// ════════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WORKFLOW = join(RAIZ, '.github/workflows/schema-drift.yml')
const ALERTA = join(RAIZ, '.github/workflows/ci-alert.yml')

/** Claves de primer nivel del bloque `on:` — sin parser de YAML en el repo. */
function disparadores(archivo) {
  const lineas = readFileSync(archivo, 'utf8').split('\n')
  const iOn = lineas.findIndex((l) => l === 'on:')
  if (iOn === -1) throw new Error(`No se encontró el bloque \`on:\` en ${archivo}`)

  const claves = []
  for (let i = iOn + 1; i < lineas.length; i += 1) {
    const l = lineas[i]
    if (l.trim() === '' || l.trimStart().startsWith('#')) continue
    if (!l.startsWith('  ')) break            // se acabó el bloque
    const m = l.match(/^ {2}(\w+):/)          // sólo el primer nivel
    if (m) claves.push(m[1])
  }
  return claves
}

describe('schema-drift · disparadores', () => {
  it('NO se dispara por `push`: leería el repositorio antes de que el apply mueva producción', () => {
    expect(disparadores(WORKFLOW)).not.toContain('push')
  })

  it('se dispara tras el apply, por horario, a demanda y en los PRs que tocan el esquema', () => {
    // workflow_run es el único momento en que el catálogo real pudo cambiar por
    // una migración nuestra; schedule atrapa lo aplicado fuera de banda —panel,
    // MCP, a mano—, que en este repositorio es el origen de casi toda la
    // baseline de drift declarado.
    expect(disparadores(WORKFLOW)).toEqual(
      expect.arrayContaining(['pull_request', 'workflow_run', 'schedule', 'workflow_dispatch']),
    )
  })

  it('el workflow_run espera al de aplicar migraciones, no a otro', () => {
    expect(readFileSync(WORKFLOW, 'utf8')).toContain("workflows: ['Apply Migrations to Production']")
  })

  it('el schedule es diario: una ventana de un día es el techo de lo que puede quedar sin verse', () => {
    const yml = readFileSync(WORKFLOW, 'utf8')
    const cron = yml.match(/- cron: '([^']+)'/)?.[1]
    expect(cron, 'sin schedule, lo aplicado fuera de banda no lo detecta nadie').toBeTruthy()
    // Cinco campos y los tres últimos comodín = se repite todos los días.
    const campos = cron.trim().split(/\s+/)
    expect(campos).toHaveLength(5)
    expect(campos.slice(2)).toEqual(['*', '*', '*'])
  })

  it('en `main` no se cancela la corrida en curso: la del apply es justo la que no se puede perder', () => {
    // `github.ref` es el mismo para workflow_run, schedule y cualquier push a
    // main, así que un cancel-in-progress incondicional dejaría que un push
    // cualquiera matara la auditoría disparada por el apply.
    const yml = readFileSync(WORKFLOW, 'utf8')
    expect(yml).toMatch(/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/)
  })

  it('en `pull_request` conserva el filtro de rutas: el auditor es caro y ahí mide otra cosa', () => {
    const yml = readFileSync(WORKFLOW, 'utf8')
    const bloquePR = yml.slice(yml.indexOf('  pull_request:'), yml.indexOf('  workflow_run:'))
    expect(bloquePR).toContain('paths:')
    expect(bloquePR).toContain("- 'supabase/migrations/**'")
  })
})

describe('schema-drift · su rojo tiene que llegar a alguien', () => {
  it('ci-alert.yml escucha a este auditor', () => {
    // Sin esto el rojo se queda en la pestaña Actions. El auditor se pone rojo
    // por su cuenta, no a raíz de un push que alguien esté mirando.
    expect(readFileSync(ALERTA, 'utf8')).toContain('- "Auditor de drift de esquema"')
  })

  it('el nombre que escucha la alerta es EXACTAMENTE el `name:` del workflow', () => {
    // workflow_run casa por nombre literal: un renombrado del workflow que no
    // toque la alerta la deja escuchando a un fantasma, en silencio.
    const nombre = readFileSync(WORKFLOW, 'utf8').match(/^name: (.+)$/m)?.[1].trim()
    expect(nombre).toBeTruthy()
    expect(readFileSync(ALERTA, 'utf8')).toContain(`- "${nombre}"`)
  })
})
