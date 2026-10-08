// CxP — Hooks de ESCRITURA.
//
// Flujo: el operador puede REGISTRAR facturas y órdenes (RLS lo permite);
// aprobar, pagar y anular es de admin/owner (RLS UPDATE). Los asientos
// contables y la actualización de saldos los hacen triggers de BD — aquí solo
// se cambian estados.
import { hoyLocalISO } from '../../lib/format'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runAfectando, runQuery } from '../queryFetch'
import { cxpKeys } from './keys'
import { contabilidadKeys } from '../contabilidad/keys'
import type { FacturaCreada, OrdenPago, Proveedor } from '../../types/cxp'
import type { FacturaCrearInput, OrdenPagoFormInput, ProveedorFormInput } from './schemas'

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

// El toggle de `activo` se eliminó en la Fase 6: `proveedores.activo` pasó a ser
// una PROYECCIÓN de `estado` (un trigger los mantiene sincronizados), así que
// escribirlo a mano ya no dice lo que parece —apagar el interruptor sobre un
// proveedor autorizado lo SUSPENDE, y sobre uno vetado no hace nada—. Autorizar
// y suspender se hacen con useCambiarEstadoProveedorMutation
// (src/domain/compras/mutations.ts), que además exige el motivo y deja la firma
// de quién autorizó.

// ── Facturas de proveedor ───────────────────────────────────────────────────

/**
 * Crea la factura (y, si viene de una orden, sus renglones) con UNA llamada a
 * `compras_factura_crear`: una sola transacción en el servidor.
 *  · todo o nada: si un renglón falla no queda ni la cabecera;
 *  · idempotente por `clave_idempotencia`: un doble clic o un reintento tras una
 *    respuesta perdida devuelve la MISMA factura; la misma clave con otro contenido
 *    se rechaza;
 *  · el servidor valida empresa, proyecto, proveedor, orden y renglones, y calcula
 *    total, IVA y moneda de una factura con orden a partir de los renglones.
 * Antes eran dos peticiones y un borrado compensatorio desde el cliente.
 */
export async function crearFacturaProveedor(
  companyId: string,
  input: FacturaCrearInput,
): Promise<FacturaCreada> {
  const { renglones, project_id, ...cabecera } = input
  if (!cabecera.clave_idempotencia) {
    throw new Error('Falta la clave de idempotencia de la factura.')
  }
  if (cabecera.orden_compra_id && !renglones?.length) {
    throw new Error('Una factura contra una orden se captura por renglón: indica qué se factura de cada uno.')
  }
  const creada = await runQuery<FacturaCreada>((signal) =>
    supabase
      .rpc('compras_factura_crear', {
        p_company_id: companyId,
        p_project_id: project_id ?? null,
        p_cabecera: cabecera,
        p_lineas: renglones?.length ? renglones : null,
      })
      .abortSignal(signal),
  )
  if (!creada?.factura) throw new Error('No se pudo crear la factura.')
  return creada
}

export function useCrearFacturaProveedorMutation(companyId?: string) {
  const invalidar = useInvalidarCxP(companyId)
  return useMutation({
    mutationFn: async (input: FacturaCrearInput) => {
      if (!companyId) throw new Error('Falta companyId.')
      return await crearFacturaProveedor(companyId, input)
    },
    onSuccess: () => invalidar(),
  })
}

/** Aprueba la factura: dispara el DEVENGO contable (gasto contra CxP). */
export function useAprobarFacturaMutation(companyId?: string) {
  const invalidar = useInvalidarCxP(companyId)
  return useMutation({
    mutationFn: async (facturaId: string) => {
      // Quién aprueba y cuándo lo sella el servidor (auth.uid(), now()): lo que mande el cliente no cuenta.
      await runAfectando((signal) =>
        supabase
          .from('facturas_proveedor')
          .update({
            estado: 'aprobada',
            updated_at: new Date().toISOString(),
          })
          .eq('id', facturaId)
          .select('id')
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
      await runAfectando((signal) =>
        supabase
          .from('facturas_proveedor')
          .update({ estado: 'anulada', updated_at: new Date().toISOString() })
          .eq('id', facturaId)
          .select('id')
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
      await runAfectando((signal) =>
        supabase
          .from('ordenes_pago')
          .update({
            estado: 'aprobada',
            aprobada_por: auth.user?.id ?? null,
            aprobada_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', ordenId)
          .select('id')
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
      await runAfectando((signal) =>
        supabase
          .from('ordenes_pago')
          .update({
            estado: 'pagada',
            fecha_pago: vars.fechaPago ?? hoyLocalISO(),
            pagada_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', vars.ordenId)
          .select('id')
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
      await runAfectando((signal) =>
        supabase
          .from('ordenes_pago')
          .update({ estado: 'anulada', updated_at: new Date().toISOString() })
          .eq('id', ordenId)
          .select('id')
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}
