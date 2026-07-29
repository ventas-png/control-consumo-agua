// Bancos — Hooks de LECTURA.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery, runQueryAll } from '../queryFetch'
import { bancosKeys } from './keys'
import type {
  BancoMovimiento,
  CuentaBancaria,
  EstadoConciliacion,
  SugerenciaConciliacion,
} from '../../types/bancos'

export function useCuentasBancariasQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: bancosKeys.cuentas(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase
        .from('cuentas_bancarias')
        .select('*')
        .eq('company_id', companyId!)
        .order('nombre')
      q = projectId ? q.eq('project_id', projectId) : q.is('project_id', null)
      return (await runQuery<CuentaBancaria[]>((signal) => q.abortSignal(signal))) ?? []
    },
  })
}

export function useMovimientosBancoQuery(cuentaBancariaId?: string, estado?: string) {
  return useQuery({
    queryKey: bancosKeys.movimientos(cuentaBancariaId, estado),
    enabled: !!cuentaBancariaId,
    // PR-25: el `.limit(500)` cortaba el extracto bancario, que es la base de la
    // conciliación: faltar movimientos ahí produce descuadres que parecen reales.
    queryFn: async () =>
      await runQueryAll<BancoMovimiento>((from, to, signal) => {
        let q = supabase
          .from('banco_movimientos')
          .select('*')
          .eq('cuenta_bancaria_id', cuentaBancariaId!)
          .order('fecha', { ascending: false })
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
        if (estado) q = q.eq('estado', estado)
        return q.range(from, to).abortSignal(signal)
      }),
  })
}

/** Matching automático monto exacto ±3 días (RPC server-side). */
export function useSugerenciasQuery(cuentaBancariaId?: string) {
  return useQuery({
    queryKey: bancosKeys.sugerencias(cuentaBancariaId),
    enabled: !!cuentaBancariaId,
    queryFn: async () =>
      (await runQuery<SugerenciaConciliacion[]>((signal) =>
        supabase
          .rpc('banco_sugerencias_conciliacion', { p_cuenta_bancaria_id: cuentaBancariaId! })
          .abortSignal(signal),
      )) ?? [],
  })
}

/** Saldo libro vs saldo banco + pendientes del periodo (RPC). */
export function useEstadoConciliacionQuery(cuentaBancariaId?: string, periodo?: string) {
  return useQuery({
    queryKey: bancosKeys.estadoConciliacion(cuentaBancariaId, periodo),
    enabled: !!cuentaBancariaId && !!periodo,
    queryFn: async () => {
      const rows = await runQuery<EstadoConciliacion[]>((signal) =>
        supabase
          .rpc('banco_estado_conciliacion', {
            p_cuenta_bancaria_id: cuentaBancariaId!,
            p_periodo: periodo!,
          })
          .abortSignal(signal),
      )
      return rows?.[0] ?? null
    },
  })
}
