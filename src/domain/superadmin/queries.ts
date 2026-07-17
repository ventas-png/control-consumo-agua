// Hooks de LECTURA del dominio Superadmin (plataforma).
//
// Consumen VISTAS MATERIALIZADAS vía RPC SECURITY DEFINER (migraciones
// 20260605200000 + 20260612180100) en vez de agregar listas completas en el
// cliente:
//   · get_superadmin_plataforma_kpis() — KPIs globales del SaaS (1 fila).
//   · get_superadmin_empresas()        — listado paginado/buscable/filtrable.
//   · get_superadmin_trends()          — altas/bajas por mes (gráficas).
//   · get_superadmin_mrr_trend()       — serie diaria de MRR (snapshot cron).
// Todas las RPC están acotadas a super_admin en la BD. Convención de
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
  /** F2 (C6): partición del MRR active por cobrabilidad (con/sin Stripe). */
  mrr_cobrable_cents: number
  mrr_potencial_cents: number
  /** Pilotos con suscripción active SIN stripe_subscription_id (operan gratis). */
  empresas_grandfathered: number
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

/** Una fila del listado paginado de empresas (escalares en vivo + MV). */
export interface EmpresaSuperadminRow {
  id: string
  nombre: string
  nit: string | null
  email: string | null
  telefono: string | null
  activa: boolean
  suspended_at: string | null
  suspended_reason: string | null
  created_at: string | null
  max_projects: number
  max_units: number
  servicio_agua: boolean
  servicio_condominios: boolean
  project_count: number
  user_count: number
  unit_count: number
  /** Código del billing plan activo (agua_only/condominios_only/bundle), null sin suscripción viva. */
  plan_code: string | null
  /** Estado de la suscripción activa (trialing/active/past_due/incomplete), null sin suscripción viva. */
  subscription_status: string | null
  /** Total mensual estimado en cents (base + proyectos extra + unidades), frescura de la MV. */
  monthly_total_cents: number
  /** Total de empresas que casan con la búsqueda (window count, igual en cada fila). */
  total_count: number
}

export interface EmpresasSuperadminPage {
  rows: EmpresaSuperadminRow[]
  total: number
}

export type EmpresaStatusFilter = '' | 'activas' | 'suspendidas'
export type EmpresaModuleFilter = '' | 'agua' | 'condominios' | 'ambos'
export type EmpresaSortOption = 'nombre' | 'created_at' | 'unidades' | 'monto'

export interface EmpresasSuperadminParams {
  search?: string
  limit?: number
  offset?: number
  status?: EmpresaStatusFilter
  module?: EmpresaModuleFilter
  sort?: EmpresaSortOption
}

/**
 * Listado de empresas paginado + buscable + filtrable server-side. Mantiene la
 * página anterior visible mientras llega la siguiente (sin parpadeo al paginar/
 * buscar). El `total` se deriva del window count de la primera fila.
 */
export function useEmpresasSuperadminQuery(
  { search, limit = 25, offset = 0, status, module: moduleFilter, sort }: EmpresasSuperadminParams = {},
  enabled = true,
) {
  return useQuery<EmpresasSuperadminPage>({
    queryKey: superadminKeys.empresas(search, limit, offset, status, moduleFilter, sort),
    queryFn: async () => {
      const rows = ((await runQuery((signal) =>
        supabase
          .rpc('get_superadmin_empresas', {
            p_search: search ?? null,
            p_limit: limit,
            p_offset: offset,
            p_status: status || null,
            p_module: moduleFilter || null,
            p_sort: sort ?? 'nombre',
          })
          .abortSignal(signal))) ?? []) as unknown as EmpresaSuperadminRow[]
      return { rows, total: rows[0]?.total_count ?? 0 }
    },
    enabled,
    placeholderData: keepPreviousData,
  })
}

/** Un mes de la tendencia de altas/bajas. */
export interface SuperadminTrendPoint {
  mes: string
  altas: number
  bajas: number
}

/** Altas de empresas y bajas de suscripciones por mes (gráfica del dashboard). */
export function useSuperadminTrendsQuery(months = 12, enabled = true) {
  return useQuery<SuperadminTrendPoint[]>({
    queryKey: superadminKeys.trends(months),
    queryFn: async () =>
      ((await runQuery((signal) =>
        supabase.rpc('get_superadmin_trends', { p_months: months }).abortSignal(signal))) ??
        []) as unknown as SuperadminTrendPoint[],
    enabled,
  })
}

/** Un día de la serie de MRR (snapshot diario de platform_metrics_daily). */
export interface MrrTrendPoint {
  day: string
  mrr_cents: number
  empresas_activas: number
}

/** Serie diaria de MRR/empresas activas (gráfica del dashboard). */
export function useMrrTrendQuery(days = 90, enabled = true) {
  return useQuery<MrrTrendPoint[]>({
    queryKey: superadminKeys.mrrTrend(days),
    queryFn: async () =>
      ((await runQuery((signal) =>
        supabase.rpc('get_superadmin_mrr_trend', { p_days: days }).abortSignal(signal))) ??
        []) as unknown as MrrTrendPoint[],
    enabled,
  })
}

/** Un usuario de la empresa (drawer de detalle del superadmin). */
export interface EmpresaUsuarioRow {
  id: string
  full_name: string | null
  role: string
  activo: boolean
  created_at: string | null
}

/** Usuarios de una empresa (la RLS de super_admin sobre app_users lo permite). */
export function useEmpresaUsuariosQuery(companyId: string | null, enabled = true) {
  return useQuery<EmpresaUsuarioRow[]>({
    queryKey: superadminKeys.empresaUsuarios(companyId ?? ''),
    queryFn: async () =>
      ((await runQuery((signal) =>
        supabase
          .from('app_users')
          .select('id, full_name, role, activo, created_at')
          .eq('company_id', companyId as string)
          .order('created_at', { ascending: true })
          .abortSignal(signal))) ?? []) as unknown as EmpresaUsuarioRow[],
    enabled: enabled && !!companyId,
  })
}

/**
 * Moneda de cobro de una empresa (companies.default_currency, ISO minúsculas).
 * Query puntual para el drawer: el listado (RPC v2) no la incluye y así se
 * evita recrear la firma de get_superadmin_empresas por un solo campo.
 */
export function useEmpresaMonedaQuery(companyId: string | null, enabled = true) {
  return useQuery<string | null>({
    queryKey: superadminKeys.empresaMoneda(companyId ?? ''),
    queryFn: async () => {
      const rows = ((await runQuery((signal) =>
        supabase
          .from('companies')
          .select('default_currency')
          .eq('id', companyId as string)
          .limit(1)
          .abortSignal(signal))) ?? []) as unknown as Array<{ default_currency: string | null }>
      return rows[0]?.default_currency ?? null
    },
    enabled: enabled && !!companyId,
  })
}

/** Desglose del total mensual de una empresa (RPC calculate_monthly_total_cents). */
export interface EmpresaBillingBreakdown {
  total_cents: number
  base_activation_cents: number
  extra_projects_subtotal: number
  primary_units_subtotal: number
  extra_units_subtotal: number
  extra_projects_count: number
  primary_units_count: number
  extra_units_count: number
  primary_project_id: string | null
}

/** Fila de comisión transaccional configurada (comision_config) — F7. */
export interface ComisionConfigFila {
  canal: string
  activo: boolean
  /** Fracción (0.025 = 2.5%). */
  pct: number
  /** Monto fijo por pago, en la moneda de cobro del tenant. */
  fijo: number
}

/**
 * Config de comisión de plataforma de una empresa (todas sus filas por canal).
 * La RLS permite leerla al superadmin y al propio tenant.
 */
export function useEmpresaComisionQuery(companyId: string | null, enabled = true) {
  return useQuery<ComisionConfigFila[]>({
    queryKey: superadminKeys.empresaComision(companyId ?? ''),
    queryFn: async () =>
      ((await runQuery((signal) =>
        supabase
          .from('comision_config')
          .select('canal, activo, pct, fijo')
          .eq('company_id', companyId as string)
          .order('canal', { ascending: true })
          .abortSignal(signal))) ?? []) as unknown as ComisionConfigFila[],
    enabled: enabled && !!companyId,
  })
}

/** Un mes del resumen de comisiones selladas (RPC superadmin_comisiones_resumen). */
export interface ComisionMesResumen {
  mes: string
  pagos: number
  monto_total: number
  comision_total: number
}

/** Comisiones de plataforma acumuladas por mes (pagos succeeded, últimos 6 meses). */
export function useEmpresaComisionResumenQuery(companyId: string | null, enabled = true) {
  return useQuery<ComisionMesResumen[]>({
    queryKey: superadminKeys.empresaComisionResumen(companyId ?? ''),
    queryFn: async () =>
      ((await runQuery((signal) =>
        supabase
          .rpc('superadmin_comisiones_resumen', { p_company_id: companyId as string })
          .abortSignal(signal))) ?? []) as unknown as ComisionMesResumen[],
    enabled: enabled && !!companyId,
  })
}

/**
 * Desglose de facturación de una empresa para el drawer del superadmin. La RPC
 * es SECURITY DEFINER con p_company_id, así que el super_admin puede pedirla
 * para cualquier tenant (misma RPC que consume PerfilSection para el propio).
 */
export function useEmpresaBillingQuery(companyId: string | null, enabled = true) {
  return useQuery<EmpresaBillingBreakdown | null>({
    queryKey: superadminKeys.empresaBilling(companyId ?? ''),
    queryFn: async () => {
      const rows = ((await runQuery((signal) =>
        supabase
          .rpc('calculate_monthly_total_cents', { p_company_id: companyId as string })
          .abortSignal(signal))) ?? []) as unknown as EmpresaBillingBreakdown[]
      return rows[0] ?? null
    },
    enabled: enabled && !!companyId,
  })
}
