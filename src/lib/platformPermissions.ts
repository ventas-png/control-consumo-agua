import type { SectionGroup } from './condominiosRoles'
import { MODULE_ACTIONS } from './moduleConfig'

// Platform-module permission groups (seeded by migrations 20260518000013 and
// 20260703000000): 6 modules × 6 actions (view / create / edit / change_status
// / approve / delete). Each "tab" entry is a full permission key, mirroring
// AGUA_MODULE_GROUPS.
export const PLATFORM_MODULE_GROUPS: SectionGroup[] = [
  { key: 'platform_clientes',      label: 'Plataforma: Clientes',      tabs: platformActions('clientes') },
  { key: 'platform_unidades',      label: 'Plataforma: Unidades',      tabs: platformActions('unidades') },
  { key: 'platform_configuracion', label: 'Plataforma: Configuración', tabs: platformActions('configuracion') },
  { key: 'platform_comunicacion',  label: 'Plataforma: Comunicación',  tabs: platformActions('comunicacion') },
  { key: 'platform_condominios',   label: 'Plataforma: Condominios',   tabs: platformActions('condominios') },
  { key: 'platform_contabilidad',  label: 'Plataforma: Contabilidad',  tabs: platformActions('contabilidad') },
]

function platformActions(module: string): string[] {
  return MODULE_ACTIONS.map(a => `platform.${module}.${a}`)
}
