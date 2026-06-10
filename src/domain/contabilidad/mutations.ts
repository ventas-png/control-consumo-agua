// Contabilidad — Hooks de ESCRITURA.
//
// Reglas del módulo:
//   - Cuentas, borradores de póliza, mapeos y tipos de cambio se escriben
//     DIRECTO vía RLS (solo company_owner/admin).
//   - PUBLICAR y ANULAR pasan SIEMPRE por RPC (conta_publicar_asiento /
//     conta_anular_asiento): el servidor valida debe=haber, cuentas de detalle
//     y periodo cerrado, y asigna el folio. Un asiento publicado es inmutable
//     (trigger de BD); la anulación genera un asiento de reverso.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { contabilidadKeys } from './keys'
import type { AsientoContable, CuentaContable } from '../../types/contabilidad'
import type { AsientoFormInput, CuentaFormInput, TipoCambioFormInput } from './schemas'

// ── Catálogo de cuentas ─────────────────────────────────────────────────────

export function useCrearCuentaMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CuentaFormInput) => {
      if (!companyId) throw new Error('Falta companyId.')
      const rows = await runQuery<CuentaContable[]>((signal) =>
        supabase
          .from('conta_cuentas')
          .insert({ ...input, company_id: companyId })
          .select()
          .abortSignal(signal),
      )
      return rows?.[0] ?? null
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.cuentas(companyId) })
    },
  })
}

export function useActualizarCuentaMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<CuentaFormInput> & { activa?: boolean } }) => {
      const rows = await runQuery<CuentaContable[]>((signal) =>
        supabase
          .from('conta_cuentas')
          .update({ ...vars.patch, updated_at: new Date().toISOString() })
          .eq('id', vars.id)
          .select()
          .abortSignal(signal),
      )
      return rows?.[0] ?? null
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.cuentas(companyId) })
    },
  })
}

// ── Pólizas ─────────────────────────────────────────────────────────────────

/** Inserta cabecera + líneas como BORRADOR (la publicación es otra acción). */
export function useCrearAsientoBorradorMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AsientoFormInput & { moneda_base: string }) => {
      if (!companyId) throw new Error('Falta companyId.')
      const cab = await runQuery<AsientoContable[]>((signal) =>
        supabase
          .from('conta_asientos')
          .insert({
            company_id: companyId,
            project_id: input.project_id,
            fecha: input.fecha,
            tipo: input.tipo,
            concepto: input.concepto,
            estado: 'borrador',
            origen: 'manual',
            moneda_base: input.moneda_base,
          })
          .select()
          .abortSignal(signal),
      )
      const asiento = cab?.[0]
      if (!asiento) throw new Error('No se pudo crear la póliza.')
      await runQuery((signal) =>
        supabase
          .from('conta_asiento_lineas')
          .insert(
            input.lineas.map((l, i) => ({
              asiento_id: asiento.id,
              company_id: companyId,
              cuenta_id: l.cuenta_id,
              orden: i + 1,
              descripcion: l.descripcion || null,
              debe: l.debe,
              haber: l.haber,
              moneda_origen: l.moneda_origen ?? null,
              monto_origen: l.monto_origen ?? null,
              tipo_cambio: l.tipo_cambio ?? null,
            })),
          )
          .abortSignal(signal),
      )
      return asiento
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.all })
    },
  })
}

/** Publica un borrador vía RPC (valida y asigna folio en servidor). */
export function usePublicarAsientoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (asientoId: string) =>
      await runQuery<AsientoContable>((signal) =>
        supabase.rpc('conta_publicar_asiento', { p_asiento_id: asientoId }).abortSignal(signal),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.all })
    },
  })
}

/** Anula: borrador→anulado; publicado→asiento de reverso (vía RPC). */
export function useAnularAsientoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { asientoId: string; motivo?: string }) =>
      await runQuery<AsientoContable>((signal) =>
        supabase
          .rpc('conta_anular_asiento', {
            p_asiento_id: vars.asientoId,
            p_motivo: vars.motivo ?? null,
          })
          .abortSignal(signal),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.all })
    },
  })
}

// ── Mapeo evento → cuenta ───────────────────────────────────────────────────

export function useGuardarMapeoMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { evento: string; cuentaId: string; projectId?: string | null }) => {
      if (!companyId) throw new Error('Falta companyId.')
      // upsert manual: el UNIQUE de BD usa COALESCE(project_id, uuid-cero), que
      // PostgREST no puede inferir como conflict target.
      let q = supabase
        .from('conta_mapeo_cuentas')
        .select('id')
        .eq('company_id', companyId)
        .eq('evento', vars.evento)
        .limit(1)
      q = vars.projectId ? q.eq('project_id', vars.projectId) : q.is('project_id', null)
      const existentes = await runQuery<{ id: string }[]>((signal) => q.abortSignal(signal))
      const existente = existentes?.[0]
      if (existente) {
        await runQuery((signal) =>
          supabase
            .from('conta_mapeo_cuentas')
            .update({ cuenta_id: vars.cuentaId, updated_at: new Date().toISOString() })
            .eq('id', existente.id)
            .abortSignal(signal),
        )
      } else {
        await runQuery((signal) =>
          supabase
            .from('conta_mapeo_cuentas')
            .insert({
              company_id: companyId,
              project_id: vars.projectId ?? null,
              evento: vars.evento,
              cuenta_id: vars.cuentaId,
            })
            .abortSignal(signal),
        )
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.mapeo(companyId) })
    },
  })
}

// ── Tipos de cambio ─────────────────────────────────────────────────────────

export function useGuardarTipoCambioMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: TipoCambioFormInput) => {
      if (!companyId) throw new Error('Falta companyId.')
      await runQuery((signal) =>
        supabase
          .from('conta_tipos_cambio')
          .upsert(
            { company_id: companyId, ...input },
            { onConflict: 'company_id,moneda,fecha' },
          )
          .abortSignal(signal),
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.tiposCambio(companyId) })
    },
  })
}
