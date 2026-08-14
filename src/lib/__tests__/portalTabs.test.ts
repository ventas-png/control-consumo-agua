import { describe, it, expect } from 'vitest'
import { PORTAL_TABS, tabsForRol } from '../portalTabs'

// Visibilidad de tabs del portal por rol del residente (portal propietario/
// inquilino): el propietario ve todo; el inquilino/familiar solo lo operativo.
describe('tabsForRol', () => {
  const todos = PORTAL_TABS.map(t => t.id)

  it('propietario ve los 11 tabs', () => {
    expect(tabsForRol('propietario')).toEqual(todos)
  })

  it('sin rol (dato legacy/degradado) se asume propietario', () => {
    expect(tabsForRol(null)).toEqual(todos)
    expect(tabsForRol(undefined)).toEqual(todos)
    expect(tabsForRol('')).toEqual(todos)
  })

  it('arrendatario ve solo los tabs operativos', () => {
    expect(tabsForRol('arrendatario')).toEqual([
      'mi_unidad', 'reservas', 'cuenta', 'tickets', 'visitantes', 'paquetes', 'anuncios',
    ])
  })

  it('arrendatario NO ve rentas, mudanza, asambleas ni transparencia', () => {
    const visibles = tabsForRol('arrendatario')
    for (const oculto of ['rentas', 'mudanza', 'asambleas', 'transparencia']) {
      expect(visibles, `${oculto} es del propietario`).not.toContain(oculto)
    }
  })

  it('familiar y otro reciben el mismo recorte operativo', () => {
    expect(tabsForRol('familiar')).toEqual(tabsForRol('arrendatario'))
    expect(tabsForRol('otro')).toEqual(tabsForRol('arrendatario'))
  })

  it('todo tab visible existe en PORTAL_TABS (sin ids huérfanos)', () => {
    for (const rol of ['propietario', 'arrendatario', 'familiar', 'otro']) {
      for (const id of tabsForRol(rol)) expect(todos).toContain(id)
    }
  })
})
