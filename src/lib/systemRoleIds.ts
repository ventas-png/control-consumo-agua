// Stable UUIDs for system roles seeded by migrations 20260518000006 and
// 20260518000011. Keep in sync with those migrations.

export const SYSTEM_ROLE_IDS = {
  condominios: {
    administrador_general: '00000000-0000-0000-0000-000000000001',
    junta_directiva:       '00000000-0000-0000-0000-000000000002',
    finanzas:              '00000000-0000-0000-0000-000000000003',
    operaciones:           '00000000-0000-0000-0000-000000000004',
    seguridad:             '00000000-0000-0000-0000-000000000005',
    comunidad:             '00000000-0000-0000-0000-000000000006',
    recepcion:             '00000000-0000-0000-0000-000000000007',
    visualizador:          '00000000-0000-0000-0000-000000000008',
  },
  agua: {
    admin:     '00000000-0000-0000-0000-000000000101',
    operator:  '00000000-0000-0000-0000-000000000102',
    collector: '00000000-0000-0000-0000-000000000103',
    viewer:    '00000000-0000-0000-0000-000000000104',
  },
} as const

export type AguaSystemRoleKey = keyof typeof SYSTEM_ROLE_IDS.agua
export type CondominiosSystemRoleKey = keyof typeof SYSTEM_ROLE_IDS.condominios
