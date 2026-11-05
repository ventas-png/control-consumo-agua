import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Respaldos sin color-mix (Safari/iOS < 16.2, Chrome < 111) de las hojas del
// landing y de las páginas legales. Cada regla (o @keyframes) que usa color-mix
// va seguida, justo detrás, de un `@supports not (color: color-mix(…))` con el
// mismo selector, las mismas propiedades y valores sin color-mix. Un valor
// anterior no sirve de respaldo: con var() se acepta al leer y se invalida al
// calcular, y para entonces el anterior ya se descartó.

const SUPPORTS_NOT = '@supports not (color: color-mix(in srgb, red 50%, blue))'
const leer = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

interface Sentencia { prelude: string; cuerpo: string }

/** Sentencias de primer nivel de un bloque CSS: `prelude { cuerpo }` con llaves balanceadas. */
function sentencias(css: string): Sentencia[] {
  const out: Sentencia[] = []
  let i = 0
  while (i < css.length) {
    const abre = css.indexOf('{', i)
    if (abre === -1) break
    let depth = 0, j = abre
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++
      else if (css[j] === '}' && --depth === 0) break
    }
    out.push({ prelude: norm(css.slice(i, abre).replace(/^[\s;]+/, '')), cuerpo: css.slice(abre + 1, j) })
    i = j + 1
  }
  return out
}

/** Propiedades (no custom) cuyo valor usa color-mix en un cuerpo de regla. */
const propsConColorMix = (cuerpo: string) =>
  [...cuerpo.matchAll(/(?:^|;|\{)\s*([a-z][a-z-]*)\s*:([^;}]*)/g)].filter((m) => m[2].includes('color-mix(')).map((m) => m[1])

/** Recorre un bloque y comprueba el respaldo de cada sentencia con color-mix. Devuelve cuántas cubrió. */
function comprobar(css: string, archivo: string): number {
  const lista = sentencias(css)
  let cubiertas = 0
  lista.forEach((s, i) => {
    if (s.prelude === norm(SUPPORTS_NOT) || !s.cuerpo.includes('color-mix(')) return
    if (s.prelude.startsWith('@media') || s.prelude.startsWith('@supports')) {
      cubiertas += comprobar(s.cuerpo, archivo)
      return
    }
    const sig = lista[i + 1]
    const donde = `${archivo}: ${s.prelude}`
    expect(sig?.prelude, `${donde} sin @supports not detrás`).toBe(norm(SUPPORTS_NOT))
    expect(sig.cuerpo, `${donde}: el respaldo usa color-mix`).not.toContain('color-mix(')
    const internas = sentencias(sig.cuerpo)
    expect(internas.map((x) => x.prelude), donde).toEqual([s.prelude])
    if (s.prelude.startsWith('@keyframes')) {
      // Mismos pasos, y cada paso con las mismas propiedades.
      const pasos = (c: string) => sentencias(c).map((p) => `${p.prelude}: ${[...p.cuerpo.matchAll(/([a-z][a-z-]*)\s*:/g)].map((m) => m[1]).join(',')}`)
      expect(pasos(internas[0].cuerpo), donde).toEqual(pasos(s.cuerpo))
    } else {
      expect([...internas[0].cuerpo.matchAll(/([a-z][a-z-]*)\s*:/g)].map((m) => m[1]), donde).toEqual(propsConColorMix(s.cuerpo))
    }
    cubiertas++
  })
  return cubiertas
}

const INDEX = leer('src/index.css')

describe.each([
  ['src/components/legal/legal.css', 2],
  ['src/components/landing/landing.css', 47],
])('%s — respaldos sin color-mix', (archivo, esperadas) => {
  const css = leer(archivo)

  it('toda regla / @keyframes con color-mix tiene justo detrás su @supports not, mismas propiedades, sin color-mix', () => {
    expect(comprobar(css, archivo)).toBe(esperadas)
  })

  it('los respaldos sólo usan variables que existen (index.css o la propia hoja)', () => {
    const bloques = sentencias(css).filter((s) => s.prelude === norm(SUPPORTS_NOT))
    const usadas = new Set(bloques.flatMap((b) => [...b.cuerpo.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1])))
    expect(usadas.size).toBeGreaterThan(0)
    for (const v of usadas) {
      const definida = new RegExp(`${v}\\s*:`).test(INDEX) || new RegExp(`${v}\\s*:`).test(css)
      expect(definida, `${v} no está definida`).toBe(true)
    }
  })

  it('cada variable --at-* de los respaldos tiene valor en claro y en oscuro (sigue al tema)', () => {
    const bloques = sentencias(css).filter((s) => s.prelude === norm(SUPPORTS_NOT))
    const at = new Set(bloques.flatMap((b) => [...b.cuerpo.matchAll(/var\((--at-[\w-]+)/g)].map((m) => m[1])))
    const darkManual = sentencias(INDEX).find((s) => s.prelude === '[data-theme="dark"]')!.cuerpo
    for (const v of at) {
      expect(new RegExp(`${v}\\s*:`).test(sentencias(INDEX).find((s) => s.prelude === ':root')!.cuerpo), `${v} claro`).toBe(true)
      expect(new RegExp(`${v}\\s*:`).test(darkManual), `${v} oscuro`).toBe(true)
    }
  })
})
