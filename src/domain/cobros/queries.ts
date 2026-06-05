// Cobros pluggable (payfac) — Hooks de LECTURA.
//
// El SECRETO de la bóveda payfac_secrets NUNCA se lee desde el cliente: la config
// efectiva usa solo columnas NO sensibles de companies/projects; el estatus viene
// de la RPC payfac_estatus (proveedor + estado_conexion + flags, sin credenciales).
// Espeja src/domain/fiscal/queries.ts.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { payfacKeys } from './keys'
import { resolverConfigPagoEfectiva } from '../../lib/businessPagos'
import type { ConfigPagoEfectiva, PayfacEstatus } from '../../types/pagos'
import type { Pago, ConvenioPago } from '../../types'

/** Pagos (no borrados) + convenios del tenant, más recientes primero. */
export interface PagosYConvenios {
  pagos: Pago[]
  convenios: ConvenioPago[]
}

/**
 * Carga pagos manuales (con deleted_at null) y convenios del tenant para la
 * pantalla de cobros. Lectura imperativa (no-hook) para usarse desde un
 * `useCallback` que llena estado local. Defaultea a `[]` ante datos ausentes.
 */
export async function fetchPagosYConvenios(): Promise<PagosYConvenios> {
  const [pagosRes, conveniosRes] = await Promise.all([
    supabase
      .from('pagos')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('convenios_pago')
      .select('*')
      .order('created_at', { ascending: false }),
  ])
  return {
    pagos: (pagosRes.data as Pago[]) ?? [],
    convenios: (conveniosRes.data as ConvenioPago[]) ?? [],
  }
}

interface CompanyPagoRow {
  id: string
  proveedor_pago?: string | null
  default_currency?: string | null
}
interface ProjectPagoRow {
  id: string
  proveedor_pago?: string | null
}

/**
 * Config de pago EFECTIVA de una locación: lee proveedor_pago/default_currency de
 * companies (empresa) y proveedor_pago de projects (override) y los resuelve con
 * resolverConfigPagoEfectiva. Si projectId es undefined, resuelve a NIVEL EMPRESA.
 */
export function useConfigPagoEfectivaQuery(companyId?: string, projectId?: string) {
  return useQuery<ConfigPagoEfectiva | null>({
    queryKey: payfacKeys.configEfectiva(companyId, projectId),
    queryFn: async () => {
      const company = (await runQuery<CompanyPagoRow[]>((signal) =>
        supabase
          .from('companies')
          .select('id,proveedor_pago,default_currency')
          .eq('id', companyId!)
          .limit(1)
          .abortSignal(signal),
      ))?.[0]
      if (!company) return null

      let project: ProjectPagoRow | undefined
      if (projectId) {
        project = (await runQuery<ProjectPagoRow[]>((signal) =>
          supabase
            .from('projects')
            .select('id,proveedor_pago')
            .eq('id', projectId)
            .limit(1)
            .abortSignal(signal),
        ))?.[0]
      }

      return resolverConfigPagoEfectiva(
        { proveedorPago: company.proveedor_pago ?? null, monedaDefault: company.default_currency ?? null },
        project ? { proveedorPago: project.proveedor_pago ?? null } : null,
      )
    },
    enabled: !!companyId,
  })
}

/**
 * Estatus (NO sensible) de las credenciales del payfac de un tenant. Lee la RPC
 * payfac_estatus (SECURITY DEFINER acotada a admin/owner), que devuelve proveedor
 * + estado_conexion + flags tiene_sandbox/tiene_prod — NUNCA `credenciales`.
 */
export function useEstatusPayfacQuery(companyId?: string) {
  return useQuery<PayfacEstatus[]>({
    queryKey: payfacKeys.estatus(companyId),
    queryFn: async () =>
      (await runQuery<PayfacEstatus[]>((signal) =>
        supabase.rpc('payfac_estatus', { p_company_id: companyId! }).abortSignal(signal),
      )) ?? [],
    enabled: !!companyId,
  })
}
