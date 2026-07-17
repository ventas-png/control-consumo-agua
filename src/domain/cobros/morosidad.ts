// cobros (D2) — Aging de cartera + score de riesgo de morosidad por unidad,
// desde la RPC server-side cartera_morosidad (SECURITY INVOKER: RLS de cuotas
// aplica). Reemplaza el aging client-side truncable de AnalisisCarteraTab y
// suma el score de priorización de cobranza.
import { useQuery } from '@tanstack/react-query'
import { db } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { payfacKeys } from './keys'

export interface MorosidadUnidad {
  unidad_id: string
  bucket_0_30: number
  bucket_31_60: number
  bucket_61_90: number
  bucket_90_plus: number
  total_vencido: number
  cuotas_vencidas: number
  dias_atraso_max: number
  periodos_morosos: number
  /** 0..100 — mayor = más riesgo. Determinista (ver la RPC). */
  score: number
}

export type BandaRiesgo = 'alto' | 'medio' | 'bajo'

/** Banda de riesgo a partir del score (pura, para color/etiqueta en la UI). */
export function bandaRiesgo(score: number): BandaRiesgo {
  if (score >= 66) return 'alto'
  if (score >= 33) return 'medio'
  return 'bajo'
}

/**
 * Aging + score por unidad del tenant (opcionalmente de un proyecto). Ordenado
 * por score desc en el servidor. Habilitado con companyId (el RPC acota por RLS).
 */
export function useCarteraMorosidadQuery(companyId?: string, projectId?: string | null) {
  return useQuery<MorosidadUnidad[]>({
    queryKey: payfacKeys.morosidad(companyId, projectId),
    queryFn: async () => {
      const rows = await runQuery((signal) =>
        db
          .rpc('cartera_morosidad', projectId ? { p_project_id: projectId } : {})
          .abortSignal(signal),
      )
      return (rows ?? []) as MorosidadUnidad[]
    },
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  })
}
