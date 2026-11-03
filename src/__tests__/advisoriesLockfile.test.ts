import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guard del lockfile contra GHSA-g3hv-75wg-m249 (minimatch < 11.0.1) y
// GHSA-3g3m-2fjr-6pw4 (glob 9.0.0–14.0.1).
//
// Ningún padre declara todavía las versiones parcheadas: eslint, workbox,
// Sentry, el docgen de Storybook y la rama exceljs → archiver siguen pidiendo
// minimatch 3/5/10 y glob 7/11/13. Las cierran los overrides `minimatch` y
// `glob` de package.json (ver SECURITY.md → «Overrides de npm vigentes»). CI
// no corre `npm audit`, así que sin esta prueba quitar un override antes de
// tiempo reintroduce las versiones vulnerables en silencio.

type Lock = { packages: Record<string, { version?: string; link?: boolean }> }
const lock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8')) as Lock

const instalados = (nombre: string) =>
  Object.entries(lock.packages)
    .filter(([ruta, info]) => ruta.endsWith(`node_modules/${nombre}`) && info.version && !info.link)
    .map(([ruta, info]) => ({ ruta, version: info.version as string }))

const comoTupla = (v: string) => v.split(/[.-]/).slice(0, 3).map(Number) as [number, number, number]
const menorQue = (v: string, piso: string) => {
  const [a, b] = [comoTupla(v), comoTupla(piso)]
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}

describe('lockfile · advisories de minimatch y glob', () => {
  it('ninguna copia de minimatch es < 11.0.1 (GHSA-g3hv-75wg-m249)', () => {
    const copias = instalados('minimatch')
    expect(copias.length).toBeGreaterThan(0)
    const vulnerables = copias.filter((c) => menorQue(c.version, '11.0.1'))
    expect(vulnerables, 'minimatch vulnerable en el lockfile: ¿se quitó el override `minimatch` de package.json?').toEqual([])
  })

  it('ninguna copia de glob está en 9.0.0–14.0.1 (GHSA-3g3m-2fjr-6pw4)', () => {
    const copias = instalados('glob')
    expect(copias.length).toBeGreaterThan(0)
    const vulnerables = copias.filter((c) => !menorQue(c.version, '9.0.0') && menorQue(c.version, '14.0.2'))
    expect(vulnerables, 'glob vulnerable en el lockfile: ¿se quitó el override `glob` de package.json?').toEqual([])
  })
})
