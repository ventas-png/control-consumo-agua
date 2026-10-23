import { describe, it, expect } from 'vitest'
import {
  PORTAL_TABS, PORTAL_TABS_CONFIGURABLES, PORTAL_TABS_FIJOS,
  esTabSoloPropietario, normalizarTabsOcultos, tabsForRol, tabsVisiblesPortal,
} from '../portalTabs'

// Visibilidad de tabs del portal por rol del residente (portal propietario/
// inquilino): el propietario ve todo; el inquilino/familiar solo lo operativo.
describe('tabsForRol', () => {
  const todos = PORTAL_TABS.map(t => t.id)

  it('propietario ve todos los tabs', () => {
    expect(tabsForRol('propietario')).toEqual(todos)
  })

  it('sin rol (dato legacy/degradado) se asume propietario', () => {
    expect(tabsForRol(null)).toEqual(todos)
    expect(tabsForRol(undefined)).toEqual(todos)
    expect(tabsForRol('')).toEqual(todos)
  })

  it('arrendatario ve solo los tabs operativos (mudanza, mascotas y vehículos incluidos)', () => {
    expect(tabsForRol('arrendatario')).toEqual([
      'mi_unidad', 'reservas', 'cuenta', 'tickets', 'visitantes', 'paquetes',
      'correspondencia', 'anuncios', 'mudanza', 'mascotas', 'vehiculos',
    ])
  })

  it('el inquilino registra sus mascotas y vehículos, pero no ve rentas', () => {
    // 20261031000500: cualquier residente de la unidad registra lo suyo.
    expect(tabsForRol('arrendatario')).toEqual(expect.arrayContaining(['mascotas', 'vehiculos']))
    expect(tabsForRol('arrendatario')).not.toContain('rentas')
  })

  it('el inquilino ve la correspondencia de su unidad', () => {
    // Lo que llega a la unidad es de quien la habita. El RLS solo le proyecta
    // las piezas con SU unidad_id; la dirigida a la administración no lleva
    // unidad y nunca aparece aquí.
    expect(tabsForRol('arrendatario')).toContain('correspondencia')
  })

  it('arrendatario NO ve rentas, asambleas ni transparencia', () => {
    const visibles = tabsForRol('arrendatario')
    for (const oculto of ['rentas', 'asambleas', 'transparencia']) {
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

// Pestañas que la empresa apaga por condominio (projects.portal_tabs_ocultos,
// 20261106000000). Se suman al recorte por rol: nunca devuelven una pestaña que
// el rol no tiene.
describe('configuración del portal por condominio', () => {
  it('Mi Unidad es la única fija y todas las demás son configurables', () => {
    expect(PORTAL_TABS_FIJOS).toEqual(['mi_unidad'])
    expect(PORTAL_TABS_CONFIGURABLES).not.toContain('mi_unidad')
    expect([...PORTAL_TABS_FIJOS, ...PORTAL_TABS_CONFIGURABLES].sort())
      .toEqual(PORTAL_TABS.map(t => t.id).sort())
  })

  it('cada pestaña trae la descripción que lee quien configura el portal', () => {
    for (const t of PORTAL_TABS) expect(t.descripcion.length, t.id).toBeGreaterThan(10)
  })

  it('sin nada apagado, el portal es exactamente el recorte por rol de siempre', () => {
    for (const rol of ['propietario', 'arrendatario', 'familiar', 'otro', null]) {
      expect(tabsVisiblesPortal(rol, [])).toEqual(tabsForRol(rol))
      expect(tabsVisiblesPortal(rol, null)).toEqual(tabsForRol(rol))
      expect(tabsVisiblesPortal(rol, undefined)).toEqual(tabsForRol(rol))
    }
  })

  it('quita las apagadas y conserva el orden de PORTAL_TABS', () => {
    expect(tabsVisiblesPortal('propietario', ['transparencia', 'paquetes', 'rentas'])).toEqual([
      'mi_unidad', 'reservas', 'cuenta', 'tickets', 'visitantes',
      'correspondencia', 'anuncios', 'asambleas', 'mudanza', 'mascotas', 'vehiculos',
    ])
  })

  it('apagar no le da al inquilino una pestaña que su rol no tiene', () => {
    const visibles = tabsVisiblesPortal('arrendatario', ['paquetes'])
    expect(visibles).not.toContain('paquetes')
    for (const id of visibles) expect(tabsForRol('arrendatario')).toContain(id)
    expect(visibles).not.toContain('rentas')
  })

  it('Mi Unidad no se puede apagar aunque la lista lo pida', () => {
    expect(tabsVisiblesPortal('propietario', ['mi_unidad'])).toContain('mi_unidad')
    expect(tabsVisiblesPortal('arrendatario', [...PORTAL_TABS_CONFIGURABLES, 'mi_unidad'])).toEqual(['mi_unidad'])
  })

  it('normaliza lo que llega de la base: sólo ids configurables, sin repetidos, en orden', () => {
    expect(normalizarTabsOcultos(['vehiculos', 'cuenta', 'cuenta', 'mi_unidad', 'no_existe', 7, null]))
      .toEqual(['cuenta', 'vehiculos'])
  })

  it('un dato que no entiende se lee como «nada apagado» (el portal no pierde pestañas)', () => {
    for (const raw of [null, undefined, 'cuenta', { cuenta: true }, 42]) {
      expect(normalizarTabsOcultos(raw)).toEqual([])
    }
  })

  it('solo-propietario son exactamente rentas, asambleas y transparencia', () => {
    expect(PORTAL_TABS.filter(t => esTabSoloPropietario(t.id)).map(t => t.id).sort())
      .toEqual(['asambleas', 'rentas', 'transparencia'])
  })
})
