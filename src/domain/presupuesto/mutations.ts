// Presupuesto — Hooks de ESCRITURA.
// Estados: borrador → propuesto → aprobado (archiva la versión vigente por
// trigger) → archivado. Las partidas solo son editables en borrador/propuesto
// (trigger de inmutabilidad en BD).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { presupuestoKeys } from './keys'
import type { Presupuesto } from '../../types/presupuesto'
import type { PartidaInput, PresupuestoFormInput } from './schemas'
import type { EstadoPresupuesto } from '../../types/presupuesto'

export function useCrearPresupuestoMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: PresupuestoFormInput) => {
      if (!companyId) throw new Error('Falta companyId.')
      const { data: auth } = await supabase.auth.getUser()
      const rows = await runQuery<Presupuesto[]>((signal) =>
        supabase
          .from('presupuestos')
          .insert({ ...input, company_id: companyId, created_by: auth.user?.id ?? null })
          .select()
          .abortSignal(signal),
      )
      const p = rows?.[0]
      if (!p) throw new Error('No se pudo crear el presupuesto.')
      return p
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: presupuestoKeys.all })
    },
  })
}

/**
 * Reemplaza las partidas del presupuesto (delete + insert). Solo válido en
 * borrador/propuesto — en aprobado la BD lo rechaza.
 */
export function useGuardarPartidasMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { presupuestoId: string; partidas: PartidaInput[] }) => {
      if (!companyId) throw new Error('Falta companyId.')
      await runQuery((signal) =>
        supabase
          .from('presupuesto_partidas')
          .delete()
          .eq('presupuesto_id', vars.presupuestoId)
          .abortSignal(signal),
      )
      const filas = vars.partidas.filter((p) => p.monto > 0)
      if (filas.length > 0) {
        await runQuery((signal) =>
          supabase
            .from('presupuesto_partidas')
            .insert(
              filas.map((p) => ({
                presupuesto_id: vars.presupuestoId,
                company_id: companyId,
                cuenta_id: p.cuenta_id,
                periodo: p.periodo,
                monto: p.monto,
              })),
            )
            .abortSignal(signal),
        )
      }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: presupuestoKeys.all })
      void qc.invalidateQueries({ queryKey: presupuestoKeys.partidas(vars.presupuestoId) })
    },
  })
}

/**
 * Borra un presupuesto y sus partidas (CASCADE). Solo borrador/propuesto: la BD
 * rechaza los aprobados y archivados (trigger presupuesto_proteger_borrado),
 * porque el comparativo vs real y las alertas de partida excedida se apoyan en
 * ellos — una corrección es una versión nueva, no un borrado.
 */
export function useEliminarPresupuestoMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (presupuestoId: string) => {
      if (!companyId) throw new Error('Falta companyId.')
      await runQuery((signal) =>
        supabase
          .from('presupuestos')
          .delete()
          .eq('id', presupuestoId)
          .eq('company_id', companyId)
          .abortSignal(signal),
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: presupuestoKeys.all })
    },
  })
}

export function useCambiarEstadoPresupuestoMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { presupuestoId: string; estado: EstadoPresupuesto }) => {
      const patch: Record<string, unknown> = {
        estado: vars.estado,
        updated_at: new Date().toISOString(),
      }
      if (vars.estado === 'aprobado') {
        const { data: auth } = await supabase.auth.getUser()
        patch.aprobado_por = auth.user?.id ?? null
        patch.aprobado_at = new Date().toISOString()
      }
      await runQuery((signal) =>
        supabase
          .from('presupuestos')
          .update(patch)
          .eq('id', vars.presupuestoId)
          .abortSignal(signal),
      )
      void companyId
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: presupuestoKeys.all })
    },
  })
}
