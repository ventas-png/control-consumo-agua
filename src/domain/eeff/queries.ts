// Estados financieros — Hooks de LECTURA (RPCs server-side, RLS aplica).
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { eeffKeys } from './keys'
import type {
  BalanceFila,
  ConsolidadoFila,
  CierreEjercicio,
  EstadoResultadosFila,
  FlujoEfectivoFila,
} from '../../types/eeff'

export function useEstadoResultadosQuery(
  companyId?: string,
  projectId?: string | null,
  desde?: string,
  hasta?: string,
) {
  return useQuery({
    queryKey: eeffKeys.estadoResultados(companyId, projectId, desde, hasta),
    enabled: !!companyId && !!desde && !!hasta,
    queryFn: async () =>
      (await runQuery<EstadoResultadosFila[]>((signal) =>
        supabase
          .rpc('conta_estado_resultados', {
            p_company_id: companyId!,
            p_project_id: projectId ?? null,
            p_desde: desde!,
            p_hasta: hasta!,
          })
          .abortSignal(signal),
      )) ?? [],
  })
}

export function useBalanceGeneralQuery(companyId?: string, projectId?: string | null, periodo?: string) {
  return useQuery({
    queryKey: eeffKeys.balance(companyId, projectId, periodo),
    enabled: !!companyId && !!periodo,
    queryFn: async () =>
      (await runQuery<BalanceFila[]>((signal) =>
        supabase
          .rpc('conta_balance_general', {
            p_company_id: companyId!,
            p_project_id: projectId ?? null,
            p_periodo: periodo!,
          })
          .abortSignal(signal),
      )) ?? [],
  })
}

export function useFlujoEfectivoQuery(companyId?: string, projectId?: string | null, periodo?: string) {
  return useQuery({
    queryKey: eeffKeys.flujo(companyId, projectId, periodo),
    enabled: !!companyId && !!periodo,
    queryFn: async () =>
      (await runQuery<FlujoEfectivoFila[]>((signal) =>
        supabase
          .rpc('conta_flujo_efectivo', {
            p_company_id: companyId!,
            p_project_id: projectId ?? null,
            p_periodo: periodo!,
          })
          .abortSignal(signal),
      )) ?? [],
  })
}

export function useCierresAnualesQuery(companyId?: string) {
  return useQuery({
    queryKey: eeffKeys.cierres(companyId),
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<CierreEjercicio[]>((signal) =>
        supabase
          .from('conta_cierres_anuales')
          .select('*')
          .eq('company_id', companyId!)
          .order('anio', { ascending: false })
          .abortSignal(signal),
      )) ?? [],
  })
}

/**
 * Vista consolidada (solo lectura): una fila por entidad contable (empresa +
 * proyectos) con P&L del rango y balance al corte, convertidos a la moneda de
 * la empresa con la tasa de cierre del periodo. Ledger sin tasa → tasa null.
 */
export function useConsolidadoQuery(
  companyId?: string,
  desde?: string,
  hasta?: string,
) {
  return useQuery({
    queryKey: eeffKeys.consolidado(companyId, desde, hasta),
    enabled: !!companyId && !!desde && !!hasta,
    queryFn: async () =>
      (await runQuery<ConsolidadoFila[]>((signal) =>
        supabase
          .rpc('conta_consolidado', {
            p_company_id: companyId!,
            p_desde: desde!,
            p_hasta: hasta!,
          })
          .abortSignal(signal),
      )) ?? [],
  })
}

