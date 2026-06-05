// Hooks de LECTURA del dominio Superadmin (plataforma).
//
// Consumen VISTAS MATERIALIZADAS vía RPC SECURITY DEFINER (migración
// 20260605200000) en vez de agregar listas completas en el cliente:
//   · get_superadmin_plataforma_kpis() — KPIs globales del SaaS (1 fila).
//   · get_superadmin_empresas()        — listado paginado/buscable (plat:P14).
// Ambas RPC están acotadas a super_admin en la BD. Convención de
// src/domain/README.md (queryFn con runQuery). El `.rpc(...)` se tipa laxo sin
// los tipos generados de Supabase, así que se castea — igual que sesiones/agua.
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { superadminKeys } from './keys'

/** Una entrada de la distribución por plan dentro de los KPIs de plataforma. */
export interface PlanDistributionEntry {
  planCode: string
  planName: string
  count: number
}

/** KPIs globales del SaaS — fila única de mv_superadmin_plataforma. */
export interface PlataformaKpis {
  total_empresas: number
  empresas_activas: number
  empresas_inactivas: number
  total_usuarios: number
  total_proyectos: number
  total_unidades: number
  mrr_cents: number
  suscripciones_activas: number
  suscripciones_trialing: number
  canceladas_30d: number
  suscripciones_vigentes: number
  plan_distribution: PlanDistributionEntry[]
  refreshed_at: string
}

/**
 * KPIs globales del SaaS para el panel superadmin. La RPC devuelve una tabla de
 * una fila; aquí se devuelve esa fila (o null si todavía no hay datos).
 */
export function usePlataformaKpisQuery(enabled = true) {
  return useQuery<PlataformaKpis | null>({
    queryKey: superadminKeys.plataformaKpis(),
    queryFn: async () => {
      const rows = ((await runQuery((signal) =>
        supabase.rpc('get_superadmin_plataforma_kpis').abortSignal(signal))) ??
        []) as unknown as PlataformaKpis[]
      return rows[0] ?? null
    },
    enabled,
  })
}

/** Una fila del listado paginado de empresas (escalares en vivo + conteos MV). */
export interface EmpresaSuperadminRow {
  id: string
  nombre: string
  nit: string | null
  email: string | null
  telefono: string | null
  plan: string
  activa: boolean
  max_projects: number
  max_units: number
  servicio_agua: boolean
  servicio_condominios: boolean
  project_count: number
  user_count: number
  unit_count: number
  /** Total de empresas que casan con la búsqueda (window count, igual en cada fila). */
  total_count: number
}

export interface EmpresasSuperadminPage {
  rows: EmpresaSuperadminRow[]
  total: number
}

export interface EmpresasSuperadminParams {
  search?: string
  limit?: number
  offset?: number
}

/**
 * Listado de empresas paginado + buscable server-side (plat:P14). Mantiene la
 * página anterior visible mientras llega la siguiente (sin parpadeo al paginar/
 * buscar). El `total` se deriva del window count de la primera fila.
 */
export function useEmpresasSuperadminQuery(
  { search, limit = 25, offset = 0 }: EmpresasSuperadminParams = {},
  enabled = true,
) {
  return useQuery<EmpresasSuperadminPage>({
    queryKey: superadminKeys.empresas(search, limit, offset),
    queryFn: async () => {
      const rows = ((await runQuery((signal) =>
        supabase
          .rpc('get_superadmin_empresas', {
            p_search: search ?? null,
            p_limit: limit,
            p_offset: offset,
          })
          .abortSignal(signal))) ?? []) as unknown as EmpresaSuperadminRow[]
      return { rows, total: rows[0]?.total_count ?? 0 }
    },
    enabled,
    placeholderData: keepPreviousData,
  })
}
