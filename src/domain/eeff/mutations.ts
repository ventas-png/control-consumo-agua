// Estados financieros — Hooks de ESCRITURA.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { eeffKeys } from './keys'
import { contabilidadKeys } from '../contabilidad/keys'
import type { AsientoContable } from '../../types/contabilidad'

/**
 * Cierre del ejercicio: la RPC genera y publica el asiento que salda
 * ingresos/gastos contra 3201 (un cierre por año, validado en BD).
 */
export function useCierreAnualMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (anio: number) =>
      await runQuery<AsientoContable>((signal) =>
        supabase.rpc('conta_cierre_anual', { p_anio: anio }).abortSignal(signal),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: eeffKeys.all })
      void qc.invalidateQueries({ queryKey: contabilidadKeys.all })
    },
  })
}
