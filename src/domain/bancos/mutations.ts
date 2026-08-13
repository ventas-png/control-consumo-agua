// Bancos — Hooks de ESCRITURA.
//
// La conciliación pasa SIEMPRE por RPCs (banco_conciliar_movimiento /
// banco_desconciliar_movimiento / banco_ajuste_conciliacion): la BD valida
// tenant, duplicidad del match y genera la póliza del ajuste. La importación
// del extracto inserta directo vía RLS (dedup por índice único).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { bancosKeys } from './keys'
import { contabilidadKeys } from '../contabilidad/keys'
import type { BancoMovimiento, CuentaBancaria } from '../../types/bancos'
import { construirLoteExtracto, type CuentaBancariaFormInput, type MovimientoImportado } from './schemas'

function useInvalidarBancos() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: bancosKeys.all })
    // los ajustes generan pólizas: refrescar también contabilidad
    void qc.invalidateQueries({ queryKey: contabilidadKeys.all })
  }
}

export function useGuardarCuentaBancariaMutation(companyId?: string, projectId?: string | null) {
  const invalidar = useInvalidarBancos()
  return useMutation({
    mutationFn: async (vars: { id?: string; input: CuentaBancariaFormInput }) => {
      if (!companyId) throw new Error('Falta companyId.')
      if (vars.id) {
        const rows = await runQuery<CuentaBancaria[]>((signal) =>
          supabase
            .from('cuentas_bancarias')
            .update({ ...vars.input, updated_at: new Date().toISOString() })
            .eq('id', vars.id!)
            .select()
            .abortSignal(signal),
        )
        return rows?.[0] ?? null
      }
      const rows = await runQuery<CuentaBancaria[]>((signal) =>
        supabase
          .from('cuentas_bancarias')
          .insert({ ...vars.input, company_id: companyId, project_id: projectId ?? null })
          .select()
          .abortSignal(signal),
      )
      return rows?.[0] ?? null
    },
    onSuccess: () => invalidar(),
  })
}

/**
 * Inserta un lote del extracto EN LA CONTABILIDAD DE LA CUENTA BANCARIA
 * (empresa o proyecto): `construirLoteExtracto` rechaza una cuenta que no sea
 * del ledger activo y la BD vuelve a sellar company_id/project_id desde la
 * cuenta, así que un extracto no puede aterrizar en la contabilidad de otro.
 *
 * upsert con ignoreDuplicates: las filas que ya existen (mismo banco+fecha+
 * monto+referencia) se omiten. El árbitro es `uq_banco_mov_dedup`, que debe ser
 * un índice COMPLETO: PostgREST manda `ON CONFLICT (<columnas>)` sin predicado,
 * y mientras el índice fue PARCIAL (WHERE referencia IS NOT NULL) Postgres no
 * podía inferirlo y rechazaba el lote entero con "there is no unique or
 * exclusion constraint matching the ON CONFLICT specification".
 * Devuelve cuántas filas se insertaron de verdad.
 */
export function useImportarMovimientosMutation(companyId?: string, projectId?: string | null) {
  const invalidar = useInvalidarBancos()
  return useMutation({
    mutationFn: async (vars: { cuenta: CuentaBancaria; movimientos: MovimientoImportado[] }) => {
      if (!companyId) throw new Error('Falta companyId.')
      const filas = construirLoteExtracto({
        cuenta: vars.cuenta,
        companyId,
        projectId: projectId ?? null,
        movimientos: vars.movimientos,
        loteId: crypto.randomUUID(),
      })
      const rows = await runQuery<{ id: string }[]>((signal) =>
        supabase
          .from('banco_movimientos')
          .upsert(filas, {
            onConflict: 'cuenta_bancaria_id,fecha,monto,referencia',
            ignoreDuplicates: true,
          })
          .select('id')
          .abortSignal(signal),
      )
      return rows?.length ?? 0
    },
    onSuccess: () => invalidar(),
  })
}

export function useConciliarMutation() {
  const invalidar = useInvalidarBancos()
  return useMutation({
    mutationFn: async (vars: { movimientoId: string; matchTipo: 'pago' | 'orden_pago'; matchId: string }) =>
      await runQuery<BancoMovimiento>((signal) =>
        supabase
          .rpc('banco_conciliar_movimiento', {
            p_movimiento_id: vars.movimientoId,
            p_match_tipo: vars.matchTipo,
            p_match_id: vars.matchId,
          })
          .abortSignal(signal),
      ),
    onSuccess: () => invalidar(),
  })
}

export function useDesconciliarMutation() {
  const invalidar = useInvalidarBancos()
  return useMutation({
    mutationFn: async (movimientoId: string) =>
      await runQuery<BancoMovimiento>((signal) =>
        supabase
          .rpc('banco_desconciliar_movimiento', { p_movimiento_id: movimientoId })
          .abortSignal(signal),
      ),
    onSuccess: () => invalidar(),
  })
}

/** Comisión/interés: la BD genera la póliza y concilia el movimiento. */
export function useAjusteConciliacionMutation() {
  const invalidar = useInvalidarBancos()
  return useMutation({
    mutationFn: async (vars: { movimientoId: string; descripcion?: string }) =>
      await runQuery<BancoMovimiento>((signal) =>
        supabase
          .rpc('banco_ajuste_conciliacion', {
            p_movimiento_id: vars.movimientoId,
            p_descripcion: vars.descripcion ?? null,
          })
          .abortSignal(signal),
      ),
    onSuccess: () => invalidar(),
  })
}

/** pendiente ↔ descartado (edición directa permitida por el guard de BD). */
export function useDescartarMovimientoMutation() {
  const invalidar = useInvalidarBancos()
  return useMutation({
    mutationFn: async (vars: { movimientoId: string; descartar: boolean }) => {
      await runQuery((signal) =>
        supabase
          .from('banco_movimientos')
          .update({ estado: vars.descartar ? 'descartado' : 'pendiente' })
          .eq('id', vars.movimientoId)
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}
