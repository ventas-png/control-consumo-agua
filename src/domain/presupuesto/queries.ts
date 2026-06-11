// Presupuesto — Hooks de LECTURA.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { presupuestoKeys } from './keys'
import type {
  PartidaEstado,
  PresupuestoConPartidas,
  PresupuestoPartida,
  PresupuestoVsRealFila,
} from '../../types/presupuesto'

/** Presupuestos de la empresa con sus montos (para totalizar en la lista). */
export function usePresupuestosQuery(companyId?: string, anio?: number) {
  return useQuery({
    queryKey: presupuestoKeys.lista(companyId, anio),
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase
        .from('presupuestos')
        .select('*, presupuesto_partidas(monto)')
        .eq('company_id', companyId!)
        .order('anio', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200)
      if (anio) q = q.eq('anio', anio)
      return (await runQuery<PresupuestoConPartidas[]>((signal) => q.abortSignal(signal))) ?? []
    },
  })
}

/** Partidas de un presupuesto (para el editor mensualizado). */
export function usePartidasQuery(presupuestoId?: string) {
  return useQuery({
    queryKey: presupuestoKeys.partidas(presupuestoId),
    enabled: !!presupuestoId,
    queryFn: async () =>
      (await runQuery<PresupuestoPartida[]>((signal) =>
        supabase
          .from('presupuesto_partidas')
          .select('*')
          .eq('presupuesto_id', presupuestoId!)
          .order('periodo')
          .abortSignal(signal),
      )) ?? [],
  })
}

/** Comparativo presupuesto vs real (RPC server-side desde la balanza). */
export function usePresupuestoVsRealQuery(presupuestoId?: string) {
  return useQuery({
    queryKey: presupuestoKeys.vsReal(presupuestoId),
    enabled: !!presupuestoId,
    queryFn: async () =>
      (await runQuery<PresupuestoVsRealFila[]>((signal) =>
        supabase
          .rpc('presupuesto_vs_real', { p_presupuesto_id: presupuestoId! })
          .abortSignal(signal),
      )) ?? [],
  })
}

/**
 * Control presupuestario en el alta de gastos: estado de la partida de la
 * cuenta mapeada a la categoría en el mes de la fecha (RPC). Vacío si no hay
 * mapeo contable o presupuesto aprobado del año.
 */
export function usePartidaEstadoQuery(projectId?: string, categoria?: string, fecha?: string) {
  return useQuery({
    queryKey: presupuestoKeys.partidaEstado(projectId, categoria, fecha),
    enabled: !!projectId && !!categoria && !!fecha,
    staleTime: 30_000,
    queryFn: async () => {
      const filas = await runQuery<PartidaEstado[]>((signal) =>
        supabase
          .rpc('presupuesto_estado_partida', {
            p_project_id: projectId!,
            p_categoria: categoria!,
            p_fecha: fecha!,
          })
          .abortSignal(signal),
      )
      return filas?.[0] ?? null
    },
  })
}
