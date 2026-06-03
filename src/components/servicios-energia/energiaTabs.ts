// serv:S1 — Helpers de routing de los tabs de Energía (módulo de 1er nivel).
// El tab activo vive en la URL (`/energia/<tab>`), no en useState: refresh
// mantiene el tab, deep-link a `/energia/facturas` funciona y el botón "atrás"
// del navegador navega entre tabs.

export type EnergyTab = 'proveedores' | 'tarifas' | 'fuentes' | 'facturas' | 'dashboard'

export const ENERGY_TABS: readonly EnergyTab[] = ['proveedores', 'tarifas', 'fuentes', 'facturas', 'dashboard']

// El tab por defecto ('proveedores') vive en `/energia` (sin segmento), igual
// que el patrón de condominios; el resto viaja como `/energia/<tab>`.
export function energiaTabToPath(tab: EnergyTab): string {
  return tab === 'proveedores' ? '/energia' : `/energia/${tab}`
}

// Convierte el param de URL en un tab válido. Tabs desconocidos caen en el default.
export function pathParamToEnergiaTab(param: string | undefined): EnergyTab {
  if (!param) return 'proveedores'
  return (ENERGY_TABS as readonly string[]).includes(param) ? (param as EnergyTab) : 'proveedores'
}
