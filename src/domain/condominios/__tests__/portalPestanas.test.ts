// Lectura y guardado de las pestañas apagadas del portal por condominio
// (projects.portal_tabs_ocultos, 20261106000000).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { result: unknown; calls: Array<[string, unknown[]]> } = { result: { data: null, error: null }, calls: [] }
  const b: Record<string, unknown> = {}
  for (const m of ['from', 'select', 'update', 'eq', 'maybeSingle']) {
    b[m] = (...args: unknown[]) => { state.calls.push([m, args]); return b }
  }
  b.then = (resolve: (v: unknown) => void) => resolve(state.result)
  return { state, b }
})
vi.mock('../../../lib/supabase', () => {
  const client = { from: (...args: unknown[]) => { h.state.calls.push(['from', args]); return h.b } }
  return { supabase: client, db: client }
})

import { fetchPortalTabsOcultos, guardarPortalTabsOcultos } from '../portalPestanas'

beforeEach(() => { h.state.result = { data: null, error: null }; h.state.calls = [] })

describe('fetchPortalTabsOcultos', () => {
  it('lee la columna del proyecto y la devuelve saneada', async () => {
    h.state.result = { data: { portal_tabs_ocultos: ['rentas', 'mi_unidad', 'cuenta', 'viejo'] }, error: null }
    expect(await fetchPortalTabsOcultos('p1')).toEqual({ ocultos: ['cuenta', 'rentas'], error: null })
    expect(h.state.calls).toContainEqual(['from', ['projects']])
    expect(h.state.calls).toContainEqual(['select', ['portal_tabs_ocultos']])
    expect(h.state.calls).toContainEqual(['eq', ['id', 'p1']])
  })

  it('un fallo se informa: la pantalla no ofrece guardar sobre un estado que no conoce', async () => {
    h.state.result = { data: null, error: { message: 'column projects.portal_tabs_ocultos does not exist' } }
    expect(await fetchPortalTabsOcultos('p1')).toEqual({
      ocultos: [], error: 'column projects.portal_tabs_ocultos does not exist',
    })
  })

  it('sin fila (proyecto ajeno o borrado) también es un error', async () => {
    h.state.result = { data: null, error: null }
    expect((await fetchPortalTabsOcultos('p1')).error).toBeTruthy()
  })
})

describe('guardarPortalTabsOcultos', () => {
  it('escribe la lista normalizada en el proyecto y pide la fila de vuelta', async () => {
    h.state.result = { data: [{ id: 'p1' }], error: null }
    expect(await guardarPortalTabsOcultos('p1', ['vehiculos', 'cuenta', 'cuenta'])).toEqual({ error: null })
    expect(h.state.calls).toContainEqual(['update', [{ portal_tabs_ocultos: ['cuenta', 'vehiculos'] }]])
    expect(h.state.calls).toContainEqual(['eq', ['id', 'p1']])
    expect(h.state.calls).toContainEqual(['select', ['id']])
  })

  it('cero filas (projects_update no lo dejó) NO es un éxito', async () => {
    h.state.result = { data: [], error: null }
    const { error } = await guardarPortalTabsOcultos('p1', ['cuenta'])
    expect(error).toMatch(/no aplicó el cambio/)
  })

  it('propaga el error del servidor (p.ej. el CHECK)', async () => {
    h.state.result = { data: null, error: { message: 'violates check constraint "projects_portal_tabs_ocultos_check"' } }
    expect(await guardarPortalTabsOcultos('p1', ['cuenta'])).toEqual({
      error: 'violates check constraint "projects_portal_tabs_ocultos_check"',
    })
  })
})
