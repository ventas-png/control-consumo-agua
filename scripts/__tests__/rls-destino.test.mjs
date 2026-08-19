// ════════════════════════════════════════════════════════════════════════════
// La validación del DESTINO, exhaustiva. Es la pieza más pequeña y la que más
// consecuencias tiene: la comparten el seed (que escribe con service_role), el
// preflight del workflow y el propio harness (que hace INSERT/UPDATE/DELETE).
//
// Es PURA a propósito. Eso no es una preferencia de estilo: significa que "esto
// aborta antes de abrir ninguna conexión" es una propiedad demostrable de su
// firma —no recibe cliente, no importa `@supabase/supabase-js`, no toca la red—
// y no una promesa sobre el orden en que alguien escribió los pasos.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { refDeUrl, validarDestino } from '../rls-destino.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const COBERTURA = JSON.parse(readFileSync(join(RAIZ, 'src', 'test', 'rls', 'coverage.json'), 'utf8'))
const PROD = COBERTURA.refProduccionProhibido
const SANDBOX = 'refdesandbox'

const validar = (url, esperado, variable = 'RLS_EXPECTED_PROJECT_REF') =>
  validarDestino({ url, esperado, cobertura: COBERTURA, variable })

describe('refDeUrl', () => {
  it('descompone una URL de Supabase', () => {
    expect(refDeUrl('https://abc123.supabase.co')).toEqual({ ref: 'abc123', dominio: 'supabase.co' })
  })

  it('tolera la barra final', () => {
    expect(refDeUrl('https://abc123.supabase.co/')).toEqual({ ref: 'abc123', dominio: 'supabase.co' })
  })

  it('rechaza lo que no tiene forma de URL de proyecto', () => {
    for (const mala of ['', null, undefined, 'supabase.co', 'http://abc.supabase.co', 'postgres://x/db']) {
      expect(refDeUrl(mala), `${mala} no debería parsearse`).toBeNull()
    }
  })
})

describe('validarDestino — PRODUCCIÓN', () => {
  it('rechaza el ref de producción aunque el operador lo declare', () => {
    // El caso más peligroso es justo éste: todo "cuadra". Alguien pega la URL de
    // prod y declara su ref, así que el cerrojo de la declaración previa no
    // salta. La lista negra explícita existe para este único escenario.
    const r = validar(`https://${PROD}.supabase.co`, PROD)
    expect(r.ok).toBe(false)
    expect(r.clave).toBe('produccion')
    expect(r.motivo).toContain('PRODUCCIÓN')
  })

  it('lo rechaza también sin declaración y con declaración distinta', () => {
    expect(validar(`https://${PROD}.supabase.co`, '').clave).toBe('produccion')
    expect(validar(`https://${PROD}.supabase.co`, 'otro').clave).toBe('produccion')
  })

  it('el ref de producción de coverage.json es el real, no un placeholder', () => {
    expect(PROD).toBe('nnsqmeigtgewatameexo')
  })
})

describe('validarDestino — DOMINIO desconocido', () => {
  it('rechaza un host que no es Supabase aunque el ref coincida', () => {
    const r = validar(`https://${SANDBOX}.evil.example.com`, SANDBOX)
    expect(r.ok).toBe(false)
    expect(r.clave).toBe('dominio-desconocido')
  })

  it('rechaza un dominio que sólo CONTIENE el permitido sin ser subdominio suyo', () => {
    // `supabase.co.evil.test` no es Supabase. Un `includes()` lo habría dejado
    // pasar; la comprobación es por igualdad o por sufijo `.<dominio>`.
    expect(validar(`https://${SANDBOX}.supabase.co.evil.test`, SANDBOX).clave).toBe('dominio-desconocido')
  })

  it('acepta los dominios declarados y sus subdominios', () => {
    for (const d of COBERTURA.dominiosSandboxPermitidos) {
      expect(validar(`https://${SANDBOX}.${d}`, SANDBOX).ok, `${d} debería aceptarse`).toBe(true)
    }
  })
})

describe('validarDestino — REF ausente o distinto', () => {
  it('sin declaración previa NO opera, aunque la URL sea un sandbox válido', () => {
    const r = validar(`https://${SANDBOX}.supabase.co`, '')
    expect(r.ok).toBe(false)
    expect(r.clave).toBe('ref-ausente')
    // El mensaje dice cuál sería el valor correcto: el objetivo es que el
    // operador declare a conciencia, no que adivine.
    expect(r.motivo).toContain(SANDBOX)
  })

  it('trata undefined y null como ausencia', () => {
    expect(validar(`https://${SANDBOX}.supabase.co`, undefined).clave).toBe('ref-ausente')
    expect(validar(`https://${SANDBOX}.supabase.co`, null).clave).toBe('ref-ausente')
  })

  it('un ref declarado DISTINTO del de la URL aborta, sin elegir ganador', () => {
    const r = validar('https://proyecto-de-otro.supabase.co', SANDBOX)
    expect(r.ok).toBe(false)
    expect(r.clave).toBe('ref-distinto')
    expect(r.motivo).toContain('proyecto-de-otro')
    expect(r.motivo).toContain(SANDBOX)
    expect(r.motivo).toContain('no se adivina cuál')
  })

  it('la coincidencia es exacta: ni prefijo ni sufijo bastan', () => {
    expect(validar(`https://${SANDBOX}.supabase.co`, SANDBOX.slice(0, -1)).clave).toBe('ref-distinto')
    expect(validar(`https://${SANDBOX}.supabase.co`, `${SANDBOX}x`).clave).toBe('ref-distinto')
  })
})

describe('validarDestino — el camino feliz y el mensaje', () => {
  it('acepta un sandbox declarado y devuelve su ref', () => {
    expect(validar(`https://${SANDBOX}.supabase.co`, SANDBOX)).toEqual({ ok: true, ref: SANDBOX })
  })

  it('el nombre de la variable viaja al mensaje, para que sea accionable', () => {
    expect(validar(`https://${SANDBOX}.supabase.co`, 'otro', 'SEED_EXPECTED_REF').motivo)
      .toContain('SEED_EXPECTED_REF')
    expect(validar(`https://${SANDBOX}.supabase.co`, 'otro', 'RLS_EXPECTED_PROJECT_REF').motivo)
      .toContain('RLS_EXPECTED_PROJECT_REF')
  })

  it('NINGÚN caso peligroso devuelve ok', () => {
    const peligrosos = [
      [`https://${PROD}.supabase.co`, PROD],
      [`https://${PROD}.supabase.co`, ''],
      [`https://${SANDBOX}.evil.example.com`, SANDBOX],
      [`https://${SANDBOX}.supabase.co`, ''],
      [`https://${SANDBOX}.supabase.co`, 'otro-ref'],
      ['no-es-una-url', SANDBOX],
      ['', SANDBOX],
    ]
    for (const [url, esperado] of peligrosos) {
      expect(validar(url, esperado).ok, `${url} / ${esperado} no debe aceptarse`).toBe(false)
    }
  })
})

describe('las tres piezas comparten ESTA función, no una copia', () => {
  const leer = (ruta) => readFileSync(join(RAIZ, ruta), 'utf8')

  it('el seed la importa', () => {
    expect(leer('scripts/seed-rls-sandbox.mjs')).toContain("from './rls-destino.mjs'")
  })

  it('el preflight la importa', () => {
    expect(leer('scripts/rls-preflight.mjs')).toContain("from './rls-destino.mjs'")
  })

  it('el harness la importa', () => {
    expect(leer('src/test/rls/rlsHarness.test.ts')).toContain("scripts/rls-destino.mjs")
  })

  it('ninguna de las tres reimplementa la lista negra por su cuenta', () => {
    // Si el ref de producción aparece literal en otro archivo, hay una segunda
    // copia de la regla — y una copia es una que se puede quedar corta.
    for (const ruta of [
      'scripts/seed-rls-sandbox.mjs',
      'scripts/rls-preflight.mjs',
      'src/test/rls/rlsHarness.test.ts',
      'scripts/rls-destino.mjs',
    ]) {
      expect(leer(ruta), `${ruta} no debe llevar el ref de producción escrito a mano`).not.toContain(PROD)
    }
  })
})
