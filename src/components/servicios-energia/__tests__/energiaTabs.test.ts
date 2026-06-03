import { describe, it, expect } from 'vitest'
import { ENERGY_TABS, energiaTabToPath, pathParamToEnergiaTab } from '../energiaTabs'

describe('energiaTabs (serv:S1 — sub-rutas /energia/<tab>)', () => {
  it('el tab por defecto (proveedores) vive en /energia, sin segmento', () => {
    expect(energiaTabToPath('proveedores')).toBe('/energia')
  })

  it('el resto de tabs viaja como /energia/<tab>', () => {
    expect(energiaTabToPath('tarifas')).toBe('/energia/tarifas')
    expect(energiaTabToPath('fuentes')).toBe('/energia/fuentes')
    expect(energiaTabToPath('facturas')).toBe('/energia/facturas')
    expect(energiaTabToPath('dashboard')).toBe('/energia/dashboard')
  })

  it('sin param de URL → cae en el tab por defecto', () => {
    expect(pathParamToEnergiaTab(undefined)).toBe('proveedores')
    expect(pathParamToEnergiaTab('')).toBe('proveedores')
  })

  it('param válido → ese mismo tab', () => {
    expect(pathParamToEnergiaTab('facturas')).toBe('facturas')
    expect(pathParamToEnergiaTab('dashboard')).toBe('dashboard')
  })

  it('param desconocido → default (no rompe el deep-link)', () => {
    expect(pathParamToEnergiaTab('inexistente')).toBe('proveedores')
  })

  it('round-trip: cada tab ↔ su path ↔ tab', () => {
    for (const tab of ENERGY_TABS) {
      const path = energiaTabToPath(tab)
      const param = path === '/energia' ? undefined : path.replace('/energia/', '')
      expect(pathParamToEnergiaTab(param)).toBe(tab)
    }
  })
})
