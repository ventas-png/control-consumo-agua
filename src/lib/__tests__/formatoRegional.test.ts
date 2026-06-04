import { describe, it, expect } from 'vitest'
import {
  monedaInfo,
  normalizarPreferencias,
  localeIntl,
  formatFechaHora,
  formatMoneda,
  PREFERENCIAS_DEFAULT,
  type PreferenciasRegionales,
} from '../formatoRegional'

// plat:P18 — Formateo regional. Para Intl usamos aserciones ROBUSTAS (relativas /
// estructurales) que no dependen de la versión de ICU del entorno.

describe('monedaInfo', () => {
  it('mapea código y símbolo de las monedas soportadas', () => {
    expect(monedaInfo('GTQ')).toEqual({ codigo: 'GTQ', simbolo: 'Q' })
    expect(monedaInfo('MXN')).toEqual({ codigo: 'MXN', simbolo: '$' })
    expect(monedaInfo('USD')).toEqual({ codigo: 'USD', simbolo: '$' })
  })
  it('desconocida → código tal cual, sin símbolo', () => {
    expect(monedaInfo('EUR')).toEqual({ codigo: 'EUR', simbolo: '' })
  })
})

describe('normalizarPreferencias', () => {
  it('null/undefined → defaults', () => {
    expect(normalizarPreferencias(null)).toEqual(PREFERENCIAS_DEFAULT)
    expect(normalizarPreferencias(undefined)).toEqual(PREFERENCIAS_DEFAULT)
  })
  it('valores inválidos caen a default (locale, currency, timezone vacío)', () => {
    expect(normalizarPreferencias({ locale: 'fr', currency: 'EUR', timezone: '  ' }))
      .toEqual(PREFERENCIAS_DEFAULT)
  })
  it('respeta valores válidos', () => {
    expect(normalizarPreferencias({ locale: 'en', currency: 'MXN', timezone: 'America/Mexico_City' }))
      .toEqual({ locale: 'en', currency: 'MXN', timezone: 'America/Mexico_City' })
  })
})

describe('localeIntl', () => {
  it('en → en-US; es+GTQ → es-GT; es+MXN → es-MX', () => {
    expect(localeIntl({ locale: 'en', timezone: 'UTC', currency: 'USD' })).toBe('en-US')
    expect(localeIntl({ locale: 'es', timezone: 'UTC', currency: 'GTQ' })).toBe('es-GT')
    expect(localeIntl({ locale: 'es', timezone: 'UTC', currency: 'MXN' })).toBe('es-MX')
  })
})

describe('formatFechaHora', () => {
  const iso = '2026-06-04T18:00:00Z'
  it('nulo/ inválido → guion', () => {
    expect(formatFechaHora(null, PREFERENCIAS_DEFAULT)).toBe('—')
    expect(formatFechaHora('no-es-fecha', PREFERENCIAS_DEFAULT)).toBe('—')
  })
  it('produce un string no vacío para una fecha válida', () => {
    expect(formatFechaHora(iso, PREFERENCIAS_DEFAULT).length).toBeGreaterThan(0)
  })
  it('la zona horaria CAMBIA el resultado para el mismo instante (robusto)', () => {
    const utc: PreferenciasRegionales = { locale: 'es', timezone: 'UTC', currency: 'GTQ' }
    const gt: PreferenciasRegionales = { locale: 'es', timezone: 'America/Guatemala', currency: 'GTQ' }
    expect(formatFechaHora(iso, utc)).not.toBe(formatFechaHora(iso, gt))
  })
})

describe('formatMoneda', () => {
  it('formatea un monto como string que contiene los dígitos', () => {
    const s = formatMoneda(1234.5, PREFERENCIAS_DEFAULT)
    expect(typeof s).toBe('string')
    expect(s).toMatch(/234/)
  })
  it('NaN/Infinity se tratan como 0', () => {
    expect(formatMoneda(Number.NaN, PREFERENCIAS_DEFAULT)).toMatch(/0/)
    expect(formatMoneda(Number.POSITIVE_INFINITY, PREFERENCIAS_DEFAULT)).toMatch(/0/)
  })
})
