// agua (D3) — Anomalías de consumo por medidor desde la RPC server-side
// agua_anomalias_consumo (SECURITY DEFINER, scope por tenant). Detección
// retrospectiva de fugas probables y medidores parados sobre el histórico.
import { useQuery } from '@tanstack/react-query'
import { db } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { aguaKeys } from './keys'

export type TipoAnomalia = 'fuga_probable' | 'medidor_parado'
export type SeveridadAnomalia = 'alta' | 'media'

export interface AnomaliaConsumo {
  contador_id: string
  cliente_id: string
  cliente_nombre: string
  project_id: string
  ultima_fecha: string
  ultimo_consumo: number
  promedio: number
  desviacion: number
  z_score: number
  ceros_consecutivos: number
  n_lecturas: number
  tipo_anomalia: TipoAnomalia
  severidad: SeveridadAnomalia
}

export const TIPO_ANOMALIA_META: Record<TipoAnomalia, { label: string; icon: string }> = {
  fuga_probable: { label: 'Fuga probable', icon: '💧' },
  medidor_parado: { label: 'Medidor parado', icon: '⏸️' },
}

/**
 * Anomalías de consumo del tenant (opcionalmente de un proyecto). El servidor
 * las ordena por prioridad (fugas primero, luego mayor z-score). Cache 5 min.
 */
export function useAnomaliasConsumoQuery(companyId?: string, projectId?: string | null) {
  return useQuery<AnomaliaConsumo[]>({
    queryKey: aguaKeys.anomaliasConsumo(companyId, projectId),
    queryFn: async () => {
      const rows = await runQuery((signal) =>
        db
          .rpc('agua_anomalias_consumo', projectId ? { p_project_id: projectId } : {})
          .abortSignal(signal),
      )
      return (rows ?? []) as AnomaliaConsumo[]
    },
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  })
}
