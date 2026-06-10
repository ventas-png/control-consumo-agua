// CxP — Hooks de ESCRITURA.
//
// Flujo: el operador puede REGISTRAR facturas y órdenes (RLS lo permite);
// aprobar, pagar y anular es de admin/owner (RLS UPDATE). Los asientos
// contables y la actualización de saldos los hacen triggers de BD — aquí solo
// se cambian estados.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { cxpKeys } from './keys'
import { contabilidadKeys } from '../contabilidad/keys'
import type { FacturaProveedor, OrdenPago, Proveedor } from '../../types/cxp'
import type { FacturaProveedorFormInput, OrdenPagoFormInput, ProveedorFormInput } from './schemas'

function useInvalidarCxP(companyId?: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: cxpKeys.all })
    // los triggers generan pólizas: refrescar también contabilidad
    void qc.invalidateQueries({ queryKey: contabilidadKeys.all })
    void companyId
  }
}

// ── Proveedores ─────────────────────────────────────────────────────────────

export function useGuardarProveedorMutation(companyId?: string) {
  const invalidar = useInvalidarCxP(companyId)
  return useMutation({
    mutationFn: async (vars: { id?: string; input: ProveedorFormInput }) => {
      if (!companyId) throw new Error('Falta companyId.')
      if (vars.id) {
        const rows = await runQuery<Proveedor[]>((signal) =>
          supabase
            .from('proveedores')
            .update({ ...vars.input, updated_at: new Date().toISOString() })
            .eq('id', vars.id!)
            .select()
            .abortSignal(signal),
        )
        return rows?.[0] ?? null
      }
      const rows = await runQuery<Proveedor[]>((signal) =>
        supabase
          .from('proveedores')
          .insert({ ...vars.input, company_id: companyId })
          .select()
          .abortSignal(signal),
      )
      return rows?.[0] ?? null
    },
    onSuccess: () => invalidar(),
  })
}

export function useToggleProveedorActivoMutation(companyId?: string) {
  const invalidar = useInvalidarCxP(companyId)
  return useMutation({
    mutationFn: async (vars: { id: string; activo: boolean }) => {
      await runQuery((signal) =>
        supabase
          .from('proveedores')
          .update({ activo: vars.activo, updated_at: new Date().toISOString() })
          .eq('id', vars.id)
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

// ── Facturas de proveedor ───────────────────────────────────────────────────

export function useCrearFacturaProveedorMutation(companyId?: string) {
  const invalidar = useInvalidarCxP(companyId)
  return useMutation({
    mutationFn: async (input: FacturaProveedorFormInput) => {
      if (!companyId) throw new Error('Falta companyId.')
      const rows = await runQuery<FacturaProveedor[]>((signal) =>
        supabase
          .from('facturas_proveedor')
          .insert({ ...input, company_id: companyId, estado: 'registrada' })
          .select()
          .abortSignal(signal),
      )
      return rows?.[0] ?? null
    },
    onSuccess: () => invalidar(),
  })
}

/** Aprueba la factura: dispara el DEVENGO contable (gasto contra CxP). */
export function useAprobarFacturaMutation(companyId?: string) {
  const invalidar = useInvalidarCxP(companyId)
  return useMutation({
    mutationFn: async (facturaId: string) => {
      const { data: auth } = await supabase.auth.getUser()
      await runQuery((signal) =>
        supabase
          .from('facturas_proveedor')
          .update({
            estado: 'aprobada',
            aprobada_por: auth.user?.id ?? null,
            aprobada_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', facturaId)
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

/** Anula la factura (la BD bloquea si tiene pagos vivos y reversa el devengo). */
export function useAnularFacturaMutation(companyId?: string) {
  const invalidar = useInvalidarCxP(companyId)
  return useMutation({
    mutationFn: async (facturaId: string) => {
      await runQuery((signal) =>
        supabase
          .from('facturas_proveedor')
          .update({ estado: 'anulada', updated_at: new Date().toISOString() })
          .eq('id', facturaId)
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

// ── Órdenes de pago ─────────────────────────────────────────────────────────

export function useCrearOrdenPagoMutation(companyId?: string) {
  const invalidar = useInvalidarCxP(companyId)
  return useMutation({
    mutationFn: async (vars: { input: OrdenPagoFormInput; proveedorId: string; projectId: string | null }) => {
      if (!companyId) throw new Error('Falta companyId.')
      const { data: auth } = await supabase.auth.getUser()
      const rows = await runQuery<OrdenPago[]>((signal) =>
        supabase
          .from('ordenes_pago')
          .insert({
            ...vars.input,
            company_id: companyId,
            proveedor_id: vars.proveedorId,
            project_id: vars.projectId,
            estado: 'borrador',
            solicitada_por: auth.user?.id ?? null,
          })
          .select()
          .abortSignal(signal),
      )
      return rows?.[0] ?? null
    },
    onSuccess: () => invalidar(),
  })
}

export function useAprobarOrdenMutation(companyId?: string) {
  const invalidar = useInvalidarCxP(companyId)
  return useMutation({
    mutationFn: async (ordenId: string) => {
      const { data: auth } = await supabase.auth.getUser()
      await runQuery((signal) =>
        supabase
          .from('ordenes_pago')
          .update({
            estado: 'aprobada',
            aprobada_por: auth.user?.id ?? null,
            aprobada_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', ordenId)
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

/** Marca pagada: la BD genera el asiento (CxP contra banco/caja) y actualiza
 *  el saldo/estado de la factura. */
export function useMarcarOrdenPagadaMutation(companyId?: string) {
  const invalidar = useInvalidarCxP(companyId)
  return useMutation({
    mutationFn: async (vars: { ordenId: string; fechaPago?: string }) => {
      await runQuery((signal) =>
        supabase
          .from('ordenes_pago')
          .update({
            estado: 'pagada',
            fecha_pago: vars.fechaPago ?? new Date().toISOString().slice(0, 10),
            pagada_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', vars.ordenId)
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

export function useAnularOrdenMutation(companyId?: string) {
  const invalidar = useInvalidarCxP(companyId)
  return useMutation({
    mutationFn: async (ordenId: string) => {
      await runQuery((signal) =>
        supabase
          .from('ordenes_pago')
          .update({ estado: 'anulada', updated_at: new Date().toISOString() })
          .eq('id', ordenId)
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}
