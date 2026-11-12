import { describe, it, expect } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

// ════════════════════════════════════════════════════════════════════════════
// CI prueba contra la MISMA versión mayor de PostgreSQL que producción
//
// Los sandboxes de RLS (supabase/tests/*/run.sh, scripts/rls-*-sandbox.sh) y
// el reconstructor del auditor de drift eligen «el Postgres más nuevo
// instalado». Mientras eso dependió de la imagen del runner, la versión bajo
// prueba cambió sin que cambiara el repositorio: ubuntu-latest pasó a 26.04
// con PostgreSQL 18, un FK ON DELETE RESTRICT empezó a reportar 23001 en vez
// de 23503 y los NOT NULL pasaron a pg_constraint, moviendo toda la huella.
// scripts/ci/postgres-produccion.sh deja en el runner SÓLO la versión de
// producción. Lo que se vigila aquí:
//
//   1. Que los dos workflows con Postgres local declaren PG_MAJOR, llamen al
//      script en vez de buscar «la más nueva», y coincidan entre sí y con el
//      valor por defecto del script.
//   2. Que PG_MAJOR sea la mayor con la que se capturó la huella de producción
//      (P): reconstruir M y R en otra versión compara catálogos de versiones
//      distintas, no esquemas distintos.
//   3. Que el script exista, sea ejecutable (el workflow lo invoca directo) y
//      de verdad retire las otras versiones, que es lo que hace que la
//      heurística de «la más nueva» no tenga otra que elegir.
// ════════════════════════════════════════════════════════════════════════════

const leer = (ruta: string) => readFileSync(resolve(ruta), 'utf8')
const WORKFLOWS = ['.github/workflows/coverage.yml', '.github/workflows/schema-drift.yml'] as const
const SCRIPT = 'scripts/ci/postgres-produccion.sh'
const HUELLA = 'scripts/schema-drift/huella-produccion.json'

// `env:` de nivel workflow → la clave va con DOS espacios; una de job o de paso
// llevaría más sangría y no fijaría nada para los demás jobs.
const pgMajorDe = (yml: string) => yml.match(/^  PG_MAJOR: '(\d+)'$/m)?.[1]
const mayorPorDefectoDelScript = () => leer(SCRIPT).match(/\$\{PG_MAJOR:-(\d+)\}/)?.[1]

describe('CI fija la versión mayor de PostgreSQL de producción', () => {
  it('los dos workflows con Postgres local declaran el mismo PG_MAJOR, igual al del script', () => {
    const mayores = WORKFLOWS.map(w => pgMajorDe(leer(w)))
    for (const m of mayores) expect(m, 'PG_MAJOR en `env:` de nivel workflow').toMatch(/^\d+$/)
    expect(new Set(mayores).size).toBe(1)
    expect(mayorPorDefectoDelScript()).toBe(mayores[0])
  })

  it('PG_MAJOR es la mayor en la que se capturó la huella de producción', () => {
    const huella = JSON.parse(leer(HUELLA)) as { postgres: string }
    const mayorProduccion = huella.postgres.split('.')[0]
    expect(mayorProduccion).toMatch(/^\d+$/)
    expect(pgMajorDe(leer(WORKFLOWS[1]))).toBe(mayorProduccion)
  })

  it.each(WORKFLOWS)('%s instala la versión con el script y ya no toma «la más nueva del runner»', (w) => {
    const yml = leer(w)
    expect(yml).toContain(`run: ${SCRIPT} "$PG_MAJOR"`)
    expect(yml).not.toMatch(/sort -V \| tail -1/)
    expect(yml).not.toMatch(/ls -d \/usr\/lib\/postgresql\/\*\/bin/)
    expect(yml).not.toMatch(/apt-get install -y -qq postgresql\b/)
  })

  it('coverage.yml publica la ruta del script como `steps.pg.outputs.bin`, que es lo que los sandboxes reciben en PGBIN', () => {
    const yml = leer(WORKFLOWS[0])
    expect(yml).toMatch(new RegExp(`id: pg\\n\\s+run: ${SCRIPT.replace(/[./]/g, '\\$&')} "\\$PG_MAJOR"`))
    expect((yml.match(/PGBIN: \$\{\{ steps\.pg\.outputs\.bin \}\}/g) ?? []).length).toBeGreaterThan(10)
  })

  it('schema-drift.yml lo hace en los dos jobs que reconstruyen (verificar y veredicto)', () => {
    const yml = leer(WORKFLOWS[1])
    expect((yml.match(new RegExp(`run: ${SCRIPT.replace(/[./]/g, '\\$&')} "\\$PG_MAJOR"`, 'g')) ?? []).length).toBe(2)
  })

  it('el script existe, es ejecutable, falla rápido y retira las otras versiones mayores', () => {
    const modo = statSync(resolve(SCRIPT)).mode
    expect(modo & 0o111, 'bit de ejecución').not.toBe(0)
    const sh = leer(SCRIPT)
    expect(sh.startsWith('#!/usr/bin/env bash')).toBe(true)
    expect(sh).toContain('set -euo pipefail')
    expect(sh).toContain('[ "$v" = "$MAYOR" ] && continue')
    expect(sh).toContain('rm -rf "/usr/lib/postgresql/$v"')
    expect(sh).toContain('echo "bin=$BIN" >> "$GITHUB_OUTPUT"')
  })
})
