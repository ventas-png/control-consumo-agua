// Compras (Fase 6) — Hooks de ESCRITURA.
//
// Flujo: el operador CAPTURA (borradores); aprobar la orden, registrar la
// recepción, aprobar la factura y pagar es de admin/owner o de quien tenga el
// permiso RBAC. Los asientos, las existencias, el alta de activos y el reparto
// de saldos los hacen triggers de BD — aquí solo se cambian estados y se
// escriben las líneas.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { comprasKeys } from './keys'
import { cxpKeys } from '../cxp/keys'
import { contabilidadKeys } from '../contabilidad/keys'
import type { ContrasenaPago, OrdenCompra, Recepcion } from '../../types/compras'
import type {
  ContrasenaFormInput,
  OrdenCompraFormInput,
  ProveedorDocumentoInput,
  ProveedorEstadoInput,
  RecepcionFormInput,
} from './schemas'

/**
 * Los triggers de esta fase escriben en TRES dominios a la vez (compras, CxP y
 * contabilidad): registrar una recepción mueve la orden, el kardex, los activos
 * y genera una póliza. Invalidar solo `compras` dejaría la pantalla de CxP y la
 * de pólizas mostrando datos viejos.
 */
function useInvalidarCompras() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: comprasKeys.all })
    void qc.invalidateQueries({ queryKey: cxpKeys.all })
    void qc.invalidateQueries({ queryKey: contabilidadKeys.all })
  }
}

// ── Proveedor autorizado ────────────────────────────────────────────────────

export function useCambiarEstadoProveedorMutation() {
  const invalidar = useInvalidarCompras()
  return useMutation({
    mutationFn: async (vars: { id: string; input: ProveedorEstadoInput }) => {
      await runQuery((signal) =>
        supabase
          .from('proveedores')
          .update({ ...vars.input, updated_at: new Date().toISOString() })
          .eq('id', vars.id)
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

export function useGuardarDocumentoProveedorMutation(companyId?: string) {
  const invalidar = useInvalidarCompras()
  return useMutation({
    mutationFn: async (vars: { id?: string; proveedorId: string; input: ProveedorDocumentoInput }) => {
      if (!companyId) throw new Error('Falta companyId.')
      if (vars.id) {
        await runQuery((signal) =>
          supabase.from('proveedor_documentos').update(vars.input).eq('id', vars.id!).abortSignal(signal),
        )
        return
      }
      await runQuery((signal) =>
        supabase
          .from('proveedor_documentos')
          .insert({ ...vars.input, company_id: companyId, proveedor_id: vars.proveedorId })
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

export function useEliminarDocumentoProveedorMutation() {
  const invalidar = useInvalidarCompras()
  return useMutation({
    mutationFn: async (id: string) => {
      await runQuery((signal) =>
        supabase.from('proveedor_documentos').delete().eq('id', id).abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

// ── Orden de compra ─────────────────────────────────────────────────────────

/** Crea la orden en BORRADOR con sus líneas. Aprobarla es un paso aparte. */
export function useCrearOrdenCompraMutation(companyId?: string, projectId?: string | null) {
  const invalidar = useInvalidarCompras()
  return useMutation({
    mutationFn: async (input: OrdenCompraFormInput & { proveedorNombre: string }) => {
      if (!companyId) throw new Error('Falta companyId.')
      const { lineas, proveedorNombre, ...cabecera } = input
      const filas = await runQuery<OrdenCompra[]>((signal) =>
        supabase
          .from('ordenes_compra')
          .insert({
            ...cabecera,
            company_id: companyId,
            project_id: projectId ?? null,
            // La columna heredada sigue siendo NOT NULL: se llena con el nombre
            // del proveedor elegido para no romper la vista de condominios.
            proveedor_nombre: proveedorNombre,
            estado: 'borrador',
          })
          .select()
          .abortSignal(signal),
      )
      const orden = filas?.[0]
      if (!orden) throw new Error('No se pudo crear la orden.')

      await runQuery((signal) =>
        supabase
          .from('orden_compra_lineas')
          .insert(lineas.map((l, i) => ({ ...l, company_id: companyId, orden_compra_id: orden.id, linea: i + 1 })))
          .abortSignal(signal),
      )
      return orden
    },
    onSuccess: () => invalidar(),
  })
}

/**
 * Cambia el estado de la orden. El candado del proveedor autorizado, el
 * correlativo y el sello de aprobación los pone la BD.
 */
export function useCambiarEstadoOrdenCompraMutation() {
  const invalidar = useInvalidarCompras()
  return useMutation({
    mutationFn: async (vars: { id: string; estado: string; motivo?: string }) => {
      await runQuery((signal) =>
        supabase
          .from('ordenes_compra')
          .update({
            estado: vars.estado,
            ...(vars.motivo ? { motivo_anulacion: vars.motivo } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq('id', vars.id)
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

export function useEliminarOrdenCompraMutation() {
  const invalidar = useInvalidarCompras()
  return useMutation({
    mutationFn: async (id: string) => {
      await runQuery((signal) =>
        supabase.from('ordenes_compra').delete().eq('id', id).abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

// ── Recepción ───────────────────────────────────────────────────────────────

/**
 * Crea la recepción en BORRADOR con sus líneas y la deja lista para registrar.
 * Se separa a propósito: al pasar a `registrada` la BD contabiliza, mueve
 * existencias y da de alta activos, y eso no debe ocurrir a media captura.
 */
export function useCrearRecepcionMutation(companyId?: string, projectId?: string | null) {
  const invalidar = useInvalidarCompras()
  return useMutation({
    mutationFn: async (input: RecepcionFormInput) => {
      if (!companyId) throw new Error('Falta companyId.')
      const { lineas, ...cabecera } = input
      const filas = await runQuery<Recepcion[]>((signal) =>
        supabase
          .from('recepciones')
          .insert({ ...cabecera, company_id: companyId, project_id: projectId ?? null, estado: 'borrador' })
          .select()
          .abortSignal(signal),
      )
      const rec = filas?.[0]
      if (!rec) throw new Error('No se pudo crear la recepción.')

      await runQuery((signal) =>
        supabase
          .from('recepcion_lineas')
          .insert(lineas.map((l) => ({ ...l, company_id: companyId, recepcion_id: rec.id })))
          .abortSignal(signal),
      )
      return rec
    },
    onSuccess: () => invalidar(),
  })
}

/** Registrar dispara el asiento GR/IR, el kardex y el alta de activos. */
export function useCambiarEstadoRecepcionMutation() {
  const invalidar = useInvalidarCompras()
  return useMutation({
    mutationFn: async (vars: { id: string; estado: 'registrada' | 'anulada'; motivo?: string }) => {
      await runQuery((signal) =>
        supabase
          .from('recepciones')
          .update({
            estado: vars.estado,
            ...(vars.motivo ? { motivo_anulacion: vars.motivo } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq('id', vars.id)
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

// ── Contraseña de pago ──────────────────────────────────────────────────────

export function useCrearContrasenaMutation(companyId?: string, projectId?: string | null) {
  const invalidar = useInvalidarCompras()
  return useMutation({
    mutationFn: async (input: ContrasenaFormInput) => {
      if (!companyId) throw new Error('Falta companyId.')
      const { facturas, ...cabecera } = input
      const filas = await runQuery<ContrasenaPago[]>((signal) =>
        supabase
          .from('contrasenas_pago')
          .insert({ ...cabecera, company_id: companyId, project_id: projectId ?? null })
          .select()
          .abortSignal(signal),
      )
      const cp = filas?.[0]
      if (!cp) throw new Error('No se pudo emitir la contraseña.')

      await runQuery((signal) =>
        supabase
          .from('contrasena_pago_facturas')
          .insert(facturas.map((f) => ({ ...f, company_id: companyId, contrasena_id: cp.id })))
          .abortSignal(signal),
      )
      return cp
    },
    onSuccess: () => invalidar(),
  })
}

export function useAnularContrasenaMutation() {
  const invalidar = useInvalidarCompras()
  return useMutation({
    mutationFn: async (vars: { id: string; motivo: string }) => {
      await runQuery((signal) =>
        supabase
          .from('contrasenas_pago')
          .update({ estado: 'anulada', motivo_anulacion: vars.motivo, updated_at: new Date().toISOString() })
          .eq('id', vars.id)
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

/**
 * Orden de pago que liquida una CONTRASEÑA (varias facturas de una vez). La
 * BD exige que el monto sea el total de la contraseña y reparte el pago entre
 * sus facturas al marcarla pagada.
 */
export function useCrearOrdenPagoDeContrasenaMutation(companyId?: string) {
  const invalidar = useInvalidarCompras()
  return useMutation({
    mutationFn: async (vars: {
      contrasena: Pick<ContrasenaPago, 'id' | 'project_id' | 'proveedor_id' | 'total'>
      metodo_pago: string
      referencia: string | null
      notas: string | null
    }) => {
      if (!companyId) throw new Error('Falta companyId.')
      const { data: auth } = await supabase.auth.getUser()
      await runQuery((signal) =>
        supabase
          .from('ordenes_pago')
          .insert({
            company_id: companyId,
            project_id: vars.contrasena.project_id,
            proveedor_id: vars.contrasena.proveedor_id,
            contrasena_pago_id: vars.contrasena.id,
            monto: vars.contrasena.total,
            metodo_pago: vars.metodo_pago,
            referencia: vars.referencia,
            notas: vars.notas,
            estado: 'borrador',
            solicitada_por: auth.user?.id ?? null,
          })
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

// ── Duplicados gasto ↔ factura ──────────────────────────────────────────────

/**
 * Declara que un gasto y una factura son el MISMO desembolso.
 *
 * Si el gasto ya está contabilizado hay que anularlo en la misma operación: su
 * asiento tiene que desaparecer y el reverso por anulación es el único camino
 * limpio —un asiento reversado sigue ocupando su clave única, así que no se
 * puede «re-emitir»—. La BD rechaza el enlace sin anulación, y aquí se manda
 * todo junto para que el reverso lo dispare el trigger de siempre.
 */
export function useEnlazarGastoAFacturaMutation() {
  const invalidar = useInvalidarCompras()
  return useMutation({
    mutationFn: async (vars: { gastoId: string; facturaId: string; yaContabilizado: boolean }) => {
      await runQuery((signal) =>
        supabase
          .from('gastos_condominio')
          .update({
            factura_id: vars.facturaId,
            ...(vars.yaContabilizado ? { estado: 'anulado' } : {}),
          })
          .eq('id', vars.gastoId)
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

/** El par se revisó y NO es duplicado: no vuelve a aparecer en el reporte. */
export function useDescartarDuplicadoMutation(companyId?: string) {
  const invalidar = useInvalidarCompras()
  return useMutation({
    mutationFn: async (vars: { gastoId: string; facturaId: string; motivo: string }) => {
      if (!companyId) throw new Error('Falta companyId.')
      const { data: auth } = await supabase.auth.getUser()
      await runQuery((signal) =>
        supabase
          .from('conta_duplicados_descartados')
          .insert({
            company_id: companyId,
            gasto_id: vars.gastoId,
            factura_id: vars.facturaId,
            motivo: vars.motivo,
            revisado_por: auth.user?.id ?? null,
          })
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

// ── Factura contra orden (cuadre) ───────────────────────────────────────────

/**
 * Aprueba la factura. Si el cuadre falla, la BD la rechaza; para forzarla hay
 * que mandar quién autoriza y por qué — y eso queda guardado en la factura.
 */
export function useAprobarFacturaConCuadreMutation() {
  const invalidar = useInvalidarCompras()
  return useMutation({
    mutationFn: async (vars: { facturaId: string; justificacion?: string }) => {
      const { data: auth } = await supabase.auth.getUser()
      await runQuery((signal) =>
        supabase
          .from('facturas_proveedor')
          .update({
            estado: 'aprobada',
            aprobada_por: auth.user?.id ?? null,
            aprobada_at: new Date().toISOString(),
            ...(vars.justificacion
              ? { match_forzado_por: auth.user?.id ?? null, match_justificacion: vars.justificacion }
              : {}),
            updated_at: new Date().toISOString(),
          })
          .eq('id', vars.facturaId)
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}
