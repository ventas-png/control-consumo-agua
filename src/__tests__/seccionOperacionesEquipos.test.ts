// El tab Equipos vive en Operaciones, a la par de Suministros (antes, en
// Instalaciones). Las dos listas que deciden la pestaña —la del panel y la de los
// grupos por rol— tienen que decir lo mismo.
import { describe, it, expect } from 'vitest'
import { SECTIONS } from '../components/condominios/sections'
import { CONDOMINIOS_SECTION_GROUPS } from '../lib/condominiosRoles'

const tabsDe = (lista: { id?: string; key?: string; tabs: readonly string[] }[], id: string) =>
  lista.find(s => s.id === id || s.key === id)?.tabs ?? []

describe('Equipos está en Operaciones, junto a Suministros', () => {
  it('en las secciones del panel va justo después de Suministros y ya no en Instalaciones', () => {
    const operaciones = tabsDe(SECTIONS as never, 'operaciones')
    const instalaciones = tabsDe(SECTIONS as never, 'instalaciones')
    expect(operaciones.indexOf('equipos')).toBe(operaciones.indexOf('suministros') + 1)
    expect(instalaciones).not.toContain('equipos')
  })

  it('en los grupos por rol, igual', () => {
    const grupos = CONDOMINIOS_SECTION_GROUPS as unknown as { id?: string; key?: string; label?: string; tabs: readonly string[] }[]
    const operaciones = grupos.find(g => g.id === 'operaciones' || g.key === 'operaciones' || /operaciones/i.test(g.label ?? ''))
    const instalaciones = grupos.find(g => g.id === 'instalaciones' || g.key === 'instalaciones' || /instalaciones/i.test(g.label ?? ''))
    expect(operaciones).toBeTruthy()
    expect(instalaciones).toBeTruthy()
    expect(operaciones!.tabs.indexOf('equipos')).toBe(operaciones!.tabs.indexOf('suministros') + 1)
    expect(instalaciones!.tabs).not.toContain('equipos')
  })
})
