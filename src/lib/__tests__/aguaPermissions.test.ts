import { describe, it, expect } from 'vitest'
import { AGUA_MODULE_GROUPS } from '../aguaPermissions'

// ════════════════════════════════════════════════════════════════════════════
// plat:P15 — Grupos de permisos del servicio Agua. Metadata PURA.
//
// AGUA_MODULE_GROUPS alimenta la UI de permisos (qué checkboxes existen) y, por
// transición, las permission keys que se persisten por rol. Un drift aquí (key
// mal formada, acción faltante, duplicado) se traduce en permisos que la UI
// muestra pero el backend no reconoce — o viceversa. Estos tests fijan el
// contrato estructural: 10 módulos × 4 acciones, keys únicas y bien formadas.
// ════════════════════════════════════════════════════════════════════════════

const EXPECTED_ACTIONS = ['view', 'create', 'edit', 'change_status']
const EXPECTED_MODULES = [
  'dashboard',
  'lecturas',
  'cobros',
  'rutas',
  'calidad',
  'mapa',
  'tabla',
  'contadores',
  'tarifas',
  'servicios_energia',
]

describe('AGUA_MODULE_GROUPS — forma', () => {
  it('expone un grupo por módulo de agua (10 módulos)', () => {
    expect(AGUA_MODULE_GROUPS).toHaveLength(EXPECTED_MODULES.length)
  })

  it('los keys de grupo son agua_<module> y cubren todos los módulos', () => {
    const keys = AGUA_MODULE_GROUPS.map((g) => g.key)
    expect(keys).toEqual(EXPECTED_MODULES.map((m) => `agua_${m}`))
  })

  it('cada grupo tiene label no vacío con prefijo "Agua: "', () => {
    for (const g of AGUA_MODULE_GROUPS) {
      expect(g.label.startsWith('Agua: ')).toBe(true)
      expect(g.label.length).toBeGreaterThan('Agua: '.length)
    }
  })
})

describe('AGUA_MODULE_GROUPS — acciones por módulo', () => {
  it('cada grupo expone exactamente las 4 acciones agua.<module>.<action>', () => {
    for (const g of AGUA_MODULE_GROUPS) {
      const module = g.key.replace(/^agua_/, '')
      expect(g.tabs).toEqual(EXPECTED_ACTIONS.map((a) => `agua.${module}.${a}`))
    }
  })

  it('el módulo del key coincide con el segmento de la permission key', () => {
    for (const g of AGUA_MODULE_GROUPS) {
      const module = g.key.replace(/^agua_/, '')
      for (const tab of g.tabs) {
        // formato estricto: agua.<module>.<action>
        const [prefix, mod, action] = tab.split('.')
        expect(prefix).toBe('agua')
        expect(mod).toBe(module)
        expect(EXPECTED_ACTIONS).toContain(action)
      }
    }
  })
})

describe('AGUA_MODULE_GROUPS — unicidad', () => {
  it('no hay keys de grupo duplicados', () => {
    const keys = AGUA_MODULE_GROUPS.map((g) => g.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('todas las permission keys son únicas globalmente (40 = 10×4)', () => {
    const allTabs = AGUA_MODULE_GROUPS.flatMap((g) => g.tabs)
    expect(allTabs).toHaveLength(EXPECTED_MODULES.length * EXPECTED_ACTIONS.length)
    expect(new Set(allTabs).size).toBe(allTabs.length)
  })
})
