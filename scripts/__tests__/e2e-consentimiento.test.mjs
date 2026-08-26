// ════════════════════════════════════════════════════════════════════════════
// Contrato del consentimiento sembrado: el aviso de cookies no tapa los clics.
// ════════════════════════════════════════════════════════════════════════════
// EL FALLO QUE ESTO CIERRA (run 32884549901): dos pruebas de agua agotaron los
// 60 s de timeout porque <div class="cookie-card"> interceptaba el clic sobre
// «Guardar Lectura». La prueba clave de este archivo es la PRIMERA: que la
// clave que sembramos sea LITERALMENTE la que lee src/lib/cookieConsent.ts.
// Si ese módulo versiona su clave (…-v2) y aquí no, el banner reaparece y
// volvemos a perder quince minutos por corrida diagnosticando un clic mudo.
import { describe, expect, it } from 'vitest'

import {
  CLAVE_CONSENTIMIENTO,
  VALOR_CONSENTIMIENTO,
  conConsentimientoSembrado,
} from '../../e2e/fixtures/consentimiento'
import { readConsent } from '../../src/lib/cookieConsent'

const BASE = 'https://preview-abc123.vercel.app'
const OTRO = 'https://otro-origen.example'

/** readConsent() lee de localStorage; le damos uno de mentira. */
function conLocalStorage(valor, fn) {
  const previo = globalThis.localStorage
  globalThis.localStorage = { getItem: (k) => (k === CLAVE_CONSENTIMIENTO ? valor : null) }
  try {
    return fn()
  } finally {
    globalThis.localStorage = previo
  }
}

describe('lo sembrado es exactamente lo que la app lee', () => {
  it('la app da por DECIDIDO el consentimiento que sembramos', () => {
    // Esto ata las dos puntas: si cambia STORAGE_KEY o la forma del valor en
    // src/lib/cookieConsent.ts, este assert cae antes que la suite de E2E.
    const c = conLocalStorage(VALOR_CONSENTIMIENTO, readConsent)
    expect(c.decided).toBe(true)
  })

  it('sin nada sembrado la app NO lo da por decidido (el banner saldría)', () => {
    expect(conLocalStorage(null, readConsent).decided).toBe(false)
  })

  it('se elige "solo esenciales": la analítica queda apagada', () => {
    // Una suite de robots no debe entrar en las métricas de producto.
    const c = conLocalStorage(VALOR_CONSENTIMIENTO, readConsent)
    expect(c.analytics).toBe(false)
    expect(c.functional).toBe(false)
  })
})

describe('la siembra va al origen del Preview y sólo a ése', () => {
  it('crea la entrada de localStorage en el origen de baseURL', () => {
    const estado = conConsentimientoSembrado({ cookies: [] }, `${BASE}/alguna/ruta?x=1`)
    expect(estado.origins).toEqual([
      { origin: BASE, localStorage: [{ name: CLAVE_CONSENTIMIENTO, value: VALOR_CONSENTIMIENTO }] },
    ])
  })

  it('no toca otros orígenes que ya estuvieran en el estado', () => {
    const previo = { origins: [{ origin: OTRO, localStorage: [{ name: 'ajeno', value: '1' }] }] }
    const estado = conConsentimientoSembrado(previo, BASE)
    const otro = estado.origins.find((o) => o.origin === OTRO)
    expect(otro.localStorage).toEqual([{ name: 'ajeno', value: '1' }])
    expect(estado.origins).toHaveLength(2)
  })

  it('conserva las demás claves del MISMO origen y sustituye sólo la nuestra', () => {
    const previo = {
      origins: [
        {
          origin: BASE,
          localStorage: [
            { name: 'at:condominio-activo:x', value: 'proj-1' },
            { name: CLAVE_CONSENTIMIENTO, value: 'basura-vieja' },
          ],
        },
      ],
    }
    const estado = conConsentimientoSembrado(previo, BASE)
    expect(estado.origins[0].localStorage).toEqual([
      { name: 'at:condominio-activo:x', value: 'proj-1' },
      { name: CLAVE_CONSENTIMIENTO, value: VALOR_CONSENTIMIENTO },
    ])
  })

  it('conserva las cookies del bypass: sembrar consentimiento no las pisa', () => {
    // El storageState lleva la cookie de bypass de Vercel. Perderla aquí
    // dejaría todas las navegaciones en 401 — fallo peor que el banner.
    const cookies = [{ name: '_vercel_jwt', value: 'x', domain: 'preview-abc123.vercel.app' }]
    expect(conConsentimientoSembrado({ cookies }, BASE).cookies).toEqual(cookies)
  })

  it('no MUTA el estado recibido', () => {
    const previo = { cookies: [], origins: [{ origin: BASE, localStorage: [] }] }
    conConsentimientoSembrado(previo, BASE)
    expect(previo.origins[0].localStorage).toEqual([])
  })

  it('sin baseURL utilizable devuelve el estado intacto, no revienta el setup', () => {
    // Fallar aquí dejaría al proyecto chromium sin storageState que cargar.
    for (const malo of ['', 'no-es-una-url', undefined]) {
      const previo = { cookies: [{ name: 'a', value: 'b' }] }
      expect(conConsentimientoSembrado(previo, malo)).toBe(previo)
    }
  })
})

describe('el setup escribe el estado con las dos cosas', () => {
  it('bypass.setup.ts usa conConsentimientoSembrado antes de guardar', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const codigo = readFileSync(resolve(import.meta.dirname, '../../e2e/bypass.setup.ts'), 'utf8')
    // Guardar con `request.storageState({ path })` a secas se lleva SÓLO las
    // cookies y tira el localStorage al suelo: el banner volvería.
    expect(codigo).toContain('conConsentimientoSembrado')
    expect(codigo).not.toMatch(/storageState\(\s*\{\s*path/)
  })
})
