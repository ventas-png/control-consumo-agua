import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { luminanciaRelativa, mezclar } from '../../lib/branding'

// Respaldos de src/index.css para navegadores sin color-mix (Safari/iOS < 16.2,
// Chrome < 111). Antes estaban como doble declaración (`--x: #hex; --x:
// color-mix(…)`), que en una custom property NO funciona: el navegador viejo se
// queda con el color-mix y la propiedad que usa la var se anula (sin borde,
// fondo transparente). Ahora van en un bloque `@supports not (…)`.

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '') // sin comentarios

const SUPPORTS_NOT = '@supports not (color: color-mix(in srgb, red 50%, blue))'

/** Cuerpo del bloque @supports not (…) con llaves balanceadas. */
function bloqueRespaldo(): string {
  const i = css.indexOf(SUPPORTS_NOT)
  expect(i, 'falta el bloque @supports not (color-mix)').toBeGreaterThan(-1)
  let depth = 0
  for (let j = css.indexOf('{', i); j < css.length; j++) {
    if (css[j] === '{') depth++
    else if (css[j] === '}' && --depth === 0) return css.slice(css.indexOf('{', i) + 1, j)
  }
  throw new Error('bloque @supports sin cerrar')
}

/** Declaraciones `--x: valor` de la regla `selector { … }` (la más interna) dentro de `texto`. */
function vars(texto: string, selector: string): Record<string, string> {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(?:^|[\\s}])${esc}\\s*\\{([^{}]*)\\}`).exec(texto)
  expect(m, `falta la regla ${selector}`).not.toBeNull()
  return Object.fromEntries([...m![1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim().toLowerCase()]))
}

describe('src/index.css — respaldos sin color-mix', () => {
  it('ninguna regla declara dos veces la misma custom property (la doble declaración no es respaldo)', () => {
    for (const [, cuerpo] of css.matchAll(/\{([^{}]*)\}/g)) {
      const nombres = [...cuerpo.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])
      const repetidas = nombres.filter((n, i) => nombres.indexOf(n) !== i)
      expect(repetidas).toEqual([])
    }
  })

  it('los tokens arreglados siguen usando color-mix en los navegadores modernos', () => {
    expect(css).toMatch(/--at-border-organic:\s*color-mix\(in srgb, var\(--at-primary\) 16%, transparent\)/)
    expect(css).toMatch(/--at-table-row-border:\s*color-mix\(in srgb, var\(--at-primary\) 12%, transparent\)/)
    expect(css).toMatch(/--at-table-row-hover:\s*color-mix\(in srgb, var\(--at-primary\) 6%, transparent\)/)
    expect(css).toMatch(/--at-surface-tint:\s*color-mix\(in srgb, var\(--at-accent-2\) 8%, var\(--at-bg\)\)/)
    expect(css).toMatch(/--at-surface:\s*color-mix\(in oklch, var\(--at-bg\) 95%, var\(--at-primary\)\)/)
  })

  it('claro: el bloque da los hex de siempre en :root, y las filas el primario sobre --at-surface', () => {
    expect(vars(bloqueRespaldo(), ':root')).toEqual({
      '--at-border-organic': '#d0d2cb',
      '--at-surface-tint': '#e9ebe2',
      // Lo que el color-mix translúcido pinta sobre la fila (--at-surface #FFFFFF).
      '--at-table-row-border': mezclar('#1B3B36', '#FFFFFF', 0.12),
      '--at-table-row-hover': mezclar('#1B3B36', '#FFFFFF', 0.06),
    })
  })

  it('oscuro (auto y manual): superficies, borde y tinte con valores dark', () => {
    const bloque = bloqueRespaldo()
    const media = /@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?\})\s*\}/.exec(bloque)
    expect(media, 'falta el @media dark dentro del bloque').not.toBeNull()
    const auto = vars(media![1], ':root:not([data-theme="light"])')
    const manual = vars(bloque.replace(media![0], ''), '[data-theme="dark"]')

    // Las superficies dark tienen color-mix sólo en el bloque automático; el manual ya es hex.
    expect(auto['--at-surface']).toBe('#11201a')
    expect(auto['--at-surface-2']).toBe('#172821')
    for (const v of [auto, manual]) {
      // Lo que el color-mix da con la paleta dark: borde 16% de #5E9D8A sobre --at-surface,
      // tinte 8% de --at-accent-2 dark sobre --at-bg.
      expect(v['--at-border-organic']).toBe(mezclar('#5E9D8A', '#11201A', 0.16))
      expect(v['--at-surface-tint']).toBe(mezclar('#79A18E', '#0B1410', 0.08))
      expect(v['--at-table-row-border']).toBe(mezclar('#5E9D8A', '#11201A', 0.12))
      expect(v['--at-table-row-hover']).toBe(mezclar('#5E9D8A', '#11201A', 0.06))
      for (const k of ['--at-border-organic', '--at-surface-tint', '--at-table-row-border', '--at-table-row-hover']) {
        expect(luminanciaRelativa(v[k]), k).toBeLessThan(0.06)
      }
    }
  })

  it('todo token definido con color-mix tiene respaldo en el bloque (claro y ambos dark)', () => {
    const bloque = bloqueRespaldo()
    const fuera = css.replace(bloque, '')
    const conColorMix = [...new Set([...fuera.matchAll(/(--[\w-]+)\s*:\s*color-mix\(/g)].map((m) => m[1]))]
    expect(conColorMix.length).toBeGreaterThan(0)
    for (const k of conColorMix) {
      // --at-surface / -2 sólo usan color-mix en el dark automático; el resto en :root.
      const enDark = ['--at-surface', '--at-surface-2'].includes(k)
      if (!enDark) expect(vars(bloque, ':root'), k).toHaveProperty(k)
      expect(bloque.match(new RegExp(`${k}\\s*:`, 'g'))?.length ?? 0, k).toBeGreaterThanOrEqual(enDark ? 1 : 3)
    }
  })

  it('el bloque va DESPUÉS de los bloques dark (a igual especificidad gana por orden)', () => {
    expect(css.indexOf(SUPPORTS_NOT)).toBeGreaterThan(css.lastIndexOf('[data-theme="dark"] {', css.indexOf(SUPPORTS_NOT)))
    expect(css.indexOf(SUPPORTS_NOT)).toBeGreaterThan(css.indexOf('@media (prefers-color-scheme: dark)'))
  })
})
