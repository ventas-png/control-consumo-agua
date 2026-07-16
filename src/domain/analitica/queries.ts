// analitica (C1) — Lectura de KPIs mensuales del tenant desde la MV
// mv_kpis_tenant_mensual vía la RPC get_kpis_tenant_mensual (SECURITY DEFINER,
// acotada a company_id = get_my_company_id()). Los agregados vienen del SERVIDOR:
// nada de bajar 5.000 filas y agregar en el cliente (cierra D1/D2/V2).
import { useQuery } from '@tanstack/react-query'
import { db } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { analiticaKeys } from './keys'

/** Una fila = un (proyecto, mes) con los KPIs de ambas verticales + gasto. */
export interface KpiTenantMensual {
  project_id: string
  mes: string
  cuotas_count: number
  cuotas_morosas: number
  unidades_con_deuda: number
  cuotas_emitido: number
  cuotas_cobrado: number
  agua_recibos: number
  agua_consumo_m3: number
  agua_emitido: number
  agua_cobrado: number
  gastos_total: number
  total_emitido: number
  total_cobrado: number
}

/** Devuelve los últimos `meses` meses en 'YYYY-MM' incluido el actual (UTC). */
export function rangoUltimosMeses(meses: number, hoy: Date = new Date()): { desde: string; hasta: string } {
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  const hasta = fmt(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)))
  const desde = fmt(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - (meses - 1), 1)))
  return { desde, hasta }
}

/**
 * KPIs mensuales del tenant en el rango [desde,hasta] ('YYYY-MM'), opcionalmente
 * de un proyecto. Cache 5 min (la MV se refresca cada 15). Habilitado solo con
 * companyId + rango.
 */
export function useKpisTenantMensualQuery(
  companyId?: string,
  desde?: string,
  hasta?: string,
  projectId?: string | null,
) {
  return useQuery<KpiTenantMensual[]>({
    queryKey: analiticaKeys.kpisMensuales(companyId, desde, hasta, projectId),
    queryFn: async () => {
      const rows = await runQuery((signal) =>
        db
          .rpc('get_kpis_tenant_mensual', {
            p_desde: desde!,
            p_hasta: hasta!,
            ...(projectId ? { p_project_id: projectId } : {}),
          })
          .abortSignal(signal),
      )
      return (rows ?? []) as KpiTenantMensual[]
    },
    enabled: !!companyId && !!desde && !!hasta,
    staleTime: 5 * 60 * 1000,
  })
}
