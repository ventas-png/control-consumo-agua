import type { SectionGroup } from './condominiosRoles'
import { MODULE_ACTIONS } from './moduleConfig'

// Platform-module permission groups (seeded by migrations 20260518000013 and
// 20260703000000): 6 modules × 6 actions (view / create / edit / change_status
// / approve / delete). Each "tab" entry is a full permission key, mirroring
// AGUA_MODULE_GROUPS.

/**
 * Las SEIS decisiones del circuito de compras y pagos, cada una con su propia llave RBAC. El servidor
 * (`compras_exigir_permiso`) exige exactamente estas llaves; la pantalla las usa para decidir qué OFRECER
 * (src/components/proveedores/permisos.ts) y la matriz de roles para mostrarlas. Una sola lista: si una llave
 * cambia aquí, cambian los botones y la matriz a la vez.
 *
 *  · la orden de compra REUTILIZA la llave de su pestaña («Autorizar / Denegar — Órdenes compra»);
 *  · las otras cinco las siembra la migración 20261027000900 (categoría `platform_contabilidad`).
 */
export const LLAVES_ACCION_COMPRAS = {
  aprobarOrdenCompra: 'condominios.tab.ordenes_compra.approve',
  registrarRecepcion: 'platform.contabilidad.compras.recepcion_registrar',
  aprobarFactura: 'platform.contabilidad.compras.factura_aprobar',
  aprobarOrdenPago: 'platform.contabilidad.compras.orden_pago_aprobar',
  ejecutarPago: 'platform.contabilidad.compras.pago_ejecutar',
  anularPago: 'platform.contabilidad.compras.pago_anular',
} as const

export type AccionCompras = keyof typeof LLAVES_ACCION_COMPRAS

/** Orden del circuito: orden de compra → recepción → factura → orden de pago → pago → anulación del pago. */
export const LLAVES_ACCION_COMPRAS_LISTA: string[] = Object.values(LLAVES_ACCION_COMPRAS)

/** Clave del grupo de la matriz que reúne las seis decisiones del circuito de compras y pagos. */
const GRUPO_COMPRAS_PAGOS = 'platform_compras_pagos'

export const PLATFORM_MODULE_GROUPS: SectionGroup[] = [
  { key: 'platform_clientes',      label: 'Plataforma: Clientes',      tabs: platformActions('clientes') },
  { key: 'platform_unidades',      label: 'Plataforma: Unidades',      tabs: platformActions('unidades') },
  { key: 'platform_configuracion', label: 'Plataforma: Configuración', tabs: platformActions('configuracion') },
  { key: 'platform_comunicacion',  label: 'Plataforma: Comunicación',  tabs: platformActions('comunicacion') },
  { key: 'platform_condominios',   label: 'Plataforma: Condominios',   tabs: platformActions('condominios') },
  { key: 'platform_contabilidad',  label: 'Plataforma: Contabilidad',  tabs: platformActions('contabilidad') },
  // Las seis decisiones de compras y pagos NO son una acción genérica (aprobar / cambiar estado) de un módulo: cada
  // una es una llave aparte y sin este grupo no se podrían conceder desde la matriz de permisos efectivos.
  { key: GRUPO_COMPRAS_PAGOS, label: 'Plataforma: Compras y pagos', tabs: LLAVES_ACCION_COMPRAS_LISTA },
]

/**
 * Los grupos de plataforma que la matriz de roles puede OFRECER con el catálogo de permisos que ya cargó.
 *
 * `PLATFORM_MODULE_GROUPS` es estático, pero las cinco llaves de «Compras y pagos» las siembra una migración: si la
 * pantalla sale antes que la migración (o en un entorno donde no se aplicó), esas casillas se verían —con el nombre de
 * respaldo «compras» en las cinco— y al guardar la base las rechazaría (`role_permissions.permission_key` es clave foránea
 * de `permissions`). Aquí el grupo muestra solo las llaves que el catálogo tiene y se oculta si no queda ninguna. Los demás
 * grupos son las seis acciones genéricas de cada módulo y no cambian.
 */
export function gruposPlataformaDisponibles(catalogo: ReadonlyMap<string, unknown>): SectionGroup[] {
  return PLATFORM_MODULE_GROUPS.flatMap((g) => {
    if (g.key !== GRUPO_COMPRAS_PAGOS) return [g]
    const tabs = g.tabs.filter((llave) => catalogo.has(llave))
    return tabs.length > 0 ? [{ ...g, tabs }] : []
  })
}

function platformActions(module: string): string[] {
  return MODULE_ACTIONS.map(a => `platform.${module}.${a}`)
}
