import { describe, it, expect } from 'vitest'
import { PARAMETROS_AGUA, PARAMETRO_AGUA, claveCuerpoAgua, nivelDe, parametrosFueraDeRango, textoRango, tipoCuerpoAgua } from '../piscina'
import type { ControlPiscina } from '../../../types'

describe('parámetros del agua (tiras de prueba)', () => {
  it('cada parámetro con franja ideal la tiene dentro de la de aviso', () => {
    for (const p of PARAMETROS_AGUA) {
      if (!p.ideal) continue
      expect(p.aviso, p.key).not.toBeNull()
      expect(p.aviso![0], p.key).toBeLessThanOrEqual(p.ideal[0])
      expect(p.aviso![1], p.key).toBeGreaterThanOrEqual(p.ideal[1])
    }
  })

  it('nivelDe: en rango, cerca del límite, fuera; sin valor o sin franja es ok', () => {
    const ph = PARAMETRO_AGUA.ph
    expect(nivelDe(ph, 7.4)).toBe('ok')
    expect(nivelDe(ph, 7.9)).toBe('warn')
    expect(nivelDe(ph, 8.6)).toBe('bad')
    expect(nivelDe(ph, null)).toBe('ok')
    expect(nivelDe(PARAMETRO_AGUA.sal, 8000)).toBe('ok')
    expect(nivelDe(PARAMETRO_AGUA.cobre, 0)).toBe('ok')
    expect(nivelDe(PARAMETRO_AGUA.cobre, 1.5)).toBe('bad')
  })

  it('textoRango y los rangos que ya usaba el tab', () => {
    expect(textoRango(PARAMETRO_AGUA.ph)).toBe('7.2–7.8')
    expect(textoRango(PARAMETRO_AGUA.cloro)).toBe('0.5–3')
    expect(textoRango(PARAMETRO_AGUA.sal)).toBe('')
  })

  it('parametrosFueraDeRango sólo cuenta lo medido que quedó mal', () => {
    const r = { ph: 7.4, cloro: 0.3, bromo: 12, dureza_total: null, sal: 9000 } as unknown as ControlPiscina
    expect(parametrosFueraDeRango(r).map(p => p.key)).toEqual(['bromo'])
  })

  it('el cuerpo de agua es tipo + nombre; sin tipo se asume piscina', () => {
    expect(claveCuerpoAgua({ tipo: 'jacuzzi', piscina: 'Terraza' })).toBe('jacuzzi:Terraza')
    expect(claveCuerpoAgua({ piscina: 'Principal' } as ControlPiscina)).toBe('piscina:Principal')
    expect(tipoCuerpoAgua(undefined).icon).toBe('🏊')
    expect(tipoCuerpoAgua('jacuzzi').label).toBe('Jacuzzi')
  })
})
