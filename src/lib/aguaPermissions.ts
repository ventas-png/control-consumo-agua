import type { SectionGroup } from './condominiosRoles'
import { MODULE_ACTIONS } from './moduleConfig'

// Water service permission groups. Each "tab" entry is a permission key.
// One group per water module; each module exposes 6 actions
// (view / create / edit / change_status / approve / delete).
export const AGUA_MODULE_GROUPS: SectionGroup[] = [
  { key: 'agua_dashboard',         label: 'Agua: Dashboard',          tabs: aguaActions('dashboard') },
  { key: 'agua_lecturas',          label: 'Agua: Lecturas',           tabs: aguaActions('lecturas') },
  { key: 'agua_cobros',            label: 'Agua: Cobros',             tabs: aguaActions('cobros') },
  { key: 'agua_rutas',             label: 'Agua: Rutas',              tabs: aguaActions('rutas') },
  { key: 'agua_calidad',           label: 'Agua: Calidad',            tabs: aguaActions('calidad') },
  { key: 'agua_mapa',              label: 'Agua: Mapa',               tabs: aguaActions('mapa') },
  { key: 'agua_tabla',             label: 'Agua: Tabla',              tabs: aguaActions('tabla') },
  { key: 'agua_contadores',        label: 'Agua: Contadores',         tabs: aguaActions('contadores') },
  { key: 'agua_tarifas',           label: 'Agua: Tarifas',            tabs: aguaActions('tarifas') },
  { key: 'agua_servicios_energia', label: 'Agua: Servicios energía',  tabs: aguaActions('servicios_energia') },
]

function aguaActions(module: string): string[] {
  return MODULE_ACTIONS.map(a => `agua.${module}.${a}`)
}
