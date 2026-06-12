import type { SectionGroup } from './condominiosRoles'

// Platform-module permission groups (seeded by migration 20260518000013):
// 5 modules × 4 actions (view / create / edit / change_status). Each "tab"
// entry is a full permission key, mirroring AGUA_MODULE_GROUPS.
export const PLATFORM_MODULE_GROUPS: SectionGroup[] = [
  { key: 'platform_clientes',      label: 'Plataforma: Clientes',      tabs: platformActions('clientes') },
  { key: 'platform_unidades',      label: 'Plataforma: Unidades',      tabs: platformActions('unidades') },
  { key: 'platform_configuracion', label: 'Plataforma: Configuración', tabs: platformActions('configuracion') },
  { key: 'platform_comunicacion',  label: 'Plataforma: Comunicación',  tabs: platformActions('comunicacion') },
  { key: 'platform_condominios',   label: 'Plataforma: Condominios',   tabs: platformActions('condominios') },
]

function platformActions(module: string): string[] {
  return [
    `platform.${module}.view`,
    `platform.${module}.create`,
    `platform.${module}.edit`,
    `platform.${module}.change_status`,
  ]
}
