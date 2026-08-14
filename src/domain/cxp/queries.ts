// CxP — Hooks de LECTURA (TanStack Query + runQuery, patrón del repo).
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery, runQueryAll } from '../queryFetch'
import { cxpKeys } from './keys'
import type {
  ProyeccionPagosFila,
  AgingProveedor,
  FacturaProveedorConProveedor,
  OrdenPagoConRelaciones,
  Proveedor,
} from '../../types/cxp'

export function useProveedoresQuery(companyId?: string) {
  return useQuery({
    queryKey: cxpKeys.proveedores(companyId),
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<Proveedor[]>((signal) =>
        supabase
          .from('proveedores')
          .select('*')
          .eq('company_id', companyId!)
          .order('nombre')
          .abortSignal(signal),
      )) ?? [],
  })
}

export interface FacturasFiltro {
  /**
   * IDENTIDAD de la contabilidad, no un filtro: `null` = la de la EMPRESA.
   * Mismo idioma que contabilidad/queries.ts y que los RPCs del ledger, que
   * comparan con `IS NOT DISTINCT FROM`. Antes esto se trataba como "filtro
   * opcional" y un `null` devolvía las facturas de TODAS las contabilidades.
   */
  projectId?: string | null
  estado?: string
}

/** Acota una consulta al ledger: NULL = empresa, uuid = ese proyecto. */
function alLedger<T extends { eq: (c: string, v: string) => T; is: (c: string, v: null) => T }>(
  q: T,
  projectId?: string | null,
): T {
  return projectId ? q.eq('project_id', projectId) : q.is('project_id', null)
}

export function useFacturasProveedorQuery(companyId?: string, filtro: FacturasFiltro = {}) {
  return useQuery({
    queryKey: cxpKeys.facturas(companyId, filtro.projectId, filtro.estado),
    enabled: !!companyId,
    // PR-25: el `.limit(500)` truncaba el listado de cuentas por pagar sin avisar.
    // `.order('id')` da el orden total que `range()` necesita para no saltar filas
    // con la misma `fecha_emision`.
    queryFn: async () =>
      await runQueryAll<FacturaProveedorConProveedor>((from, to, signal) => {
        let q = supabase
          .from('facturas_proveedor')
          .select('*, proveedores(nombre)')
          .eq('company_id', companyId!)
          .order('fecha_emision', { ascending: false })
          .order('id', { ascending: true })
        q = alLedger(q as never, filtro.projectId)
        if (filtro.estado) q = q.eq('estado', filtro.estado)
        return q.range(from, to).abortSignal(signal)
      }),
  })
}

export function useOrdenesPagoQuery(companyId?: string, filtro: FacturasFiltro = {}) {
  return useQuery({
    queryKey: cxpKeys.ordenes(companyId, filtro.projectId, filtro.estado),
    enabled: !!companyId,
    // PR-25: idem — el listado de órdenes de pago se cortaba en 500.
    queryFn: async () =>
      await runQueryAll<OrdenPagoConRelaciones>((from, to, signal) => {
        let q = supabase
          .from('ordenes_pago')
          .select('*, proveedores(nombre), facturas_proveedor(numero_factura, concepto, monto_total, monto_pagado)')
          .eq('company_id', companyId!)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
        q = alLedger(q as never, filtro.projectId)
        if (filtro.estado) q = q.eq('estado', filtro.estado)
        return q.range(from, to).abortSignal(signal)
      }),
  })
}

/** Antigüedad de saldos por pagar (RPC server-side, aging 30/60/90). */
export function useAgingQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: cxpKeys.aging(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<AgingProveedor[]>((signal) =>
        supabase
          .rpc('cxp_antiguedad_saldos', {
            p_company_id: companyId!,
            p_project_id: projectId ?? null,
          })
          .abortSignal(signal),
      )) ?? [],
  })
}

/** Proyección de pagos por proveedor según vencimientos (RPC, forward-looking). */
export function useProyeccionPagosQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: cxpKeys.proyeccion(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<ProyeccionPagosFila[]>((signal) =>
        supabase
          .rpc('cxp_proyeccion_pagos', {
            p_company_id: companyId!,
            p_project_id: projectId ?? null,
          })
          .abortSignal(signal),
      )) ?? [],
  })
}
