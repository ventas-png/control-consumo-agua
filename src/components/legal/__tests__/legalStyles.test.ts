import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

// La página legal es un chunk lazy propio (lazySections.ts). Sus estilos dependen de
// landing.css (tokens --c-* de `.at-root`, `.container`, el <Footer>), pero antes sólo
// importaba legal.css: entrando directo a la URL, landing.css no se cargaba y la página
// salía sin contenedor y con la barra superior transparente. Este test fija que todo lo
// que la página usa esté en las hojas que ella misma importa.

const raiz = process.cwd()
const PAGINA = resolve(raiz, 'src/components/legal/LegalPage.tsx')
const fuente = readFileSync(PAGINA, 'utf8')

/** Hojas CSS que importa LegalPage.tsx, en orden, como rutas absolutas. */
const hojas = [...fuente.matchAll(/^import\s+'([^']+\.css)'/gm)].map((m) => resolve(dirname(PAGINA), m[1]))
const css = hojas.map((h) => readFileSync(h, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n')

/** Clases de los className="…" literales de un fragmento de JSX. */
const clases = (jsx: string) => [...new Set([...jsx.matchAll(/className="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)))]
const definida = (cls: string) => new RegExp(`\\.${cls.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css)

describe('LegalPage — estilos autocontenidos (entrada directa a la URL)', () => {
  it('importa landing.css y, después, legal.css', () => {
    const rel = hojas.map((h) => h.slice(raiz.length + 1))
    expect(rel).toContain('src/components/landing/landing.css')
    expect(rel).toContain('src/components/legal/legal.css')
    expect(rel.indexOf('src/components/landing/landing.css')).toBeLessThan(rel.indexOf('src/components/legal/legal.css'))
  })

  it('toda variable --c-* que usa legal.css está definida en las hojas importadas', () => {
    const legal = readFileSync(resolve(raiz, 'src/components/legal/legal.css'), 'utf8')
    const usadas = [...new Set([...legal.matchAll(/var\((--c-[\w-]+)/g)].map((m) => m[1]))]
    expect(usadas.length).toBeGreaterThan(0)
    for (const v of usadas) expect(new RegExp(`${v}\\s*:`).test(css), v).toBe(true)
  })

  it('toda clase de LegalPage tiene reglas en las hojas importadas', () => {
    const cs = clases(fuente)
    expect(cs).toEqual(expect.arrayContaining(['at-root', 'container', 'legal-topbar', 'legal-prose']))
    for (const c of cs) expect(definida(c), `.${c}`).toBe(true)
  })

  it('el <Footer> del landing que reusa también tiene sus estilos', () => {
    const social = readFileSync(resolve(raiz, 'src/components/landing/Social.tsx'), 'utf8')
    const inicio = social.indexOf('export function Footer')
    const fin = social.indexOf('\nexport ', inicio + 1)
    const cs = clases(social.slice(inicio, fin === -1 ? undefined : fin))
    expect(cs).toContain('site-foot')
    // Clases-gancho sin regla CSS: su estilo va inline en el JSX.
    const SOLO_GANCHO = ['foot-cookie-btn']
    for (const c of cs.filter((x) => !SOLO_GANCHO.includes(x))) expect(definida(c), `.${c}`).toBe(true)
  })
})
