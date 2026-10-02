// Compras (Fase 6) — Hooks de LECTURA (TanStack Query + runQuery).
//
// Idioma de ledger ESTRICTO, el mismo de contabilidad/queries.ts: `projectId`
// es la identidad de la contabilidad, no un filtro. `null` significa "la de la
// EMPRESA" y se consulta con `.is('project_id', null)` — nunca "todas".
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery, runQueryAll } from '../queryFetch'
import { comprasKeys } from './keys'
import type {
  ActivoFijo,
  ContrasenaConRelaciones,
  ContrasenaPagoFactura,
  ComprasConfig,
  FacturaCandidata,
  FilaCompromiso,
  FilaCuadre,
  FilaDuplicado,
  OrdenCompraConRelaciones,
  OrdenCompraLinea,
  ProveedorDocumento,
  RecepcionConRelaciones,
  SeguimientoOrden,
  FilaSeguimiento,
  InsumoAlmacen,
  RecepcionRespaldo,
  RecepcionLinea,
} from '../../types/compras'

/** Acota una consulta al ledger activo: NULL = empresa, uuid = ese proyecto. */
function alLedger<T extends { eq: (c: string, v: string) => T; is: (c: string, v: null) => T }>(
  q: T,
  projectId?: string | null,
): T {
  return projectId ? q.eq('project_id', projectId) : q.is('project_id', null)
}

export function useOrdenesCompraQuery(
  companyId?: string,
  projectId?: string | null,
  estado?: string,
) {
  return useQuery({
    queryKey: comprasKeys.ordenes(companyId, projectId, estado),
    enabled: !!companyId,
    queryFn: async () =>
      await runQueryAll<OrdenCompraConRelaciones>((from, to, signal) => {
        let q = supabase
          .from('ordenes_compra')
          .select('*, proveedores(nombre, estado)')
          .eq('company_id', companyId!)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
        q = alLedger(q as never, projectId)
        if (estado) q = q.eq('estado', estado)
        return q.range(from, to).abortSignal(signal)
      }),
  })
}

export function useOrdenCompraLineasQuery(ordenId?: string) {
  return useQuery({
    queryKey: comprasKeys.ordenLineas(ordenId),
    enabled: !!ordenId,
    queryFn: async () =>
      (await runQuery<OrdenCompraLinea[]>((signal) =>
        supabase
          .from('orden_compra_lineas')
          .select('*')
          .eq('orden_compra_id', ordenId!)
          .order('linea')
          .abortSignal(signal),
      )) ?? [],
  })
}

export function useRecepcionesQuery(
  companyId?: string,
  projectId?: string | null,
  estado?: string,
) {
  return useQuery({
    queryKey: comprasKeys.recepciones(companyId, projectId, estado),
    enabled: !!companyId,
    queryFn: async () =>
      await runQueryAll<RecepcionConRelaciones>((from, to, signal) => {
        let q = supabase
          .from('recepciones')
          .select('*, ordenes_compra(numero, concepto, proveedor_id)')
          .eq('company_id', companyId!)
          .order('fecha', { ascending: false })
          .order('id', { ascending: true })
        q = alLedger(q as never, projectId)
        if (estado) q = q.eq('estado', estado)
        return q.range(from, to).abortSignal(signal)
      }),
  })
}

export function useRecepcionLineasQuery(recepcionId?: string) {
  return useQuery({
    queryKey: comprasKeys.recepcionLineas(recepcionId),
    enabled: !!recepcionId,
    queryFn: async () =>
      (await runQuery<RecepcionLinea[]>((signal) =>
        supabase
          .from('recepcion_lineas')
          .select('*')
          .eq('recepcion_id', recepcionId!)
          .order('created_at')
          .abortSignal(signal),
      )) ?? [],
  })
}

export function useActivosFijosQuery(
  companyId?: string,
  projectId?: string | null,
  estado?: string,
) {
  return useQuery({
    queryKey: comprasKeys.activos(companyId, projectId, estado),
    enabled: !!companyId,
    queryFn: async () =>
      await runQueryAll<ActivoFijo>((from, to, signal) => {
        let q = supabase
          .from('activos_fijos')
          .select('*')
          .eq('company_id', companyId!)
          .order('codigo')
          .order('id', { ascending: true })
        q = alLedger(q as never, projectId)
        if (estado) q = q.eq('estado', estado)
        return q.range(from, to).abortSignal(signal)
      }),
  })
}

export function useContrasenasQuery(
  companyId?: string,
  projectId?: string | null,
  estado?: string,
) {
  return useQuery({
    queryKey: comprasKeys.contrasenas(companyId, projectId, estado),
    enabled: !!companyId,
    queryFn: async () =>
      await runQueryAll<ContrasenaConRelaciones>((from, to, signal) => {
        let q = supabase
          .from('contrasenas_pago')
          .select('*, proveedores(nombre)')
          .eq('company_id', companyId!)
          .order('fecha_pago_programada', { ascending: true })
          .order('id', { ascending: true })
        q = alLedger(q as never, projectId)
        if (estado) q = q.eq('estado', estado)
        return q.range(from, to).abortSignal(signal)
      }),
  })
}

export function useContrasenaFacturasQuery(contrasenaId?: string) {
  return useQuery({
    queryKey: comprasKeys.contrasenaFacturas(contrasenaId),
    enabled: !!contrasenaId,
    queryFn: async () =>
      (await runQuery<ContrasenaPagoFactura[]>((signal) =>
        supabase
          .from('contrasena_pago_facturas')
          .select('*')
          .eq('contrasena_id', contrasenaId!)
          .abortSignal(signal),
      )) ?? [],
  })
}

/** Comprometido vs recibido por proveedor (RPC server-side). */
export function useCompromisosQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: comprasKeys.compromisos(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<FilaCompromiso[]>((signal) =>
        supabase
          .rpc('compras_compromisos', {
            p_company_id: companyId!,
            p_project_id: projectId ?? null,
          })
          .abortSignal(signal),
      )) ?? [],
  })
}

/** Cuadre de 3 vías de una factura (RPC). Vacío si la factura no tiene orden. */
export function useCuadreQuery(facturaId?: string) {
  return useQuery({
    queryKey: comprasKeys.cuadre(facturaId),
    enabled: !!facturaId,
    queryFn: async () =>
      (await runQuery<FilaCuadre[]>((signal) =>
        supabase.rpc('compras_validar_match', { p_factura_id: facturaId! }).abortSignal(signal),
      )) ?? [],
  })
}

/**
 * Seguimiento compartido de una orden (RPC de solo lectura). El servidor decide
 * qué secciones ve cada quien; devuelve null si la orden no existe o no es
 * visible para el usuario.
 */
export function useSeguimientoOrdenQuery(ordenId?: string) {
  return useQuery({
    queryKey: comprasKeys.seguimiento(ordenId),
    enabled: !!ordenId,
    queryFn: async () =>
      (await runQuery<SeguimientoOrden | null>((signal) =>
        supabase.rpc('compras_seguimiento_orden', { p_orden_id: ordenId! }).abortSignal(signal),
      )) ?? null,
  })
}

export interface FiltrosSeguimiento {
  projectId?: string | null
  proveedorId?: string | null
  estado?: string | null
  desde?: string | null
  hasta?: string | null
  /** true = solo la contabilidad de la empresa (órdenes sin proyecto). */
  soloEmpresa?: boolean
}

/** Una fila por orden con comprometido / recibido / facturado / pagado por separado. */
export function useSeguimientoListaQuery(companyId: string | undefined, f: FiltrosSeguimiento = {}) {
  return useQuery({
    queryKey: comprasKeys.seguimientoLista(companyId, f.projectId, f.proveedorId, f.estado, f.desde, f.hasta, f.soloEmpresa),
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<FilaSeguimiento[]>((signal) =>
        supabase
          .rpc('compras_seguimiento_lista', {
            p_project_id: f.projectId ?? null,
            p_proveedor_id: f.proveedorId ?? null,
            p_estado: f.estado || null,
            p_desde: f.desde || null,
            p_hasta: f.hasta || null,
            p_solo_empresa: f.soloEmpresa ?? false,
          })
          .abortSignal(signal),
      )) ?? [],
  })
}

export function useDocumentosProveedorQuery(proveedorId?: string) {
  return useQuery({
    queryKey: comprasKeys.documentosProveedor(proveedorId),
    enabled: !!proveedorId,
    queryFn: async () =>
      (await runQuery<ProveedorDocumento[]>((signal) =>
        supabase
          .from('proveedor_documentos')
          .select('*')
          .eq('proveedor_id', proveedorId!)
          .order('vence_el', { ascending: true, nullsFirst: false })
          .abortSignal(signal),
      )) ?? [],
  })
}

/**
 * Pares (gasto, factura) que probablemente son el mismo desembolso.
 * El servidor ya excluye los enlazados, los anulados y los descartados.
 */
export function useDuplicadosQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: comprasKeys.duplicados(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<FilaDuplicado[]>((signal) =>
        supabase
          .rpc('conta_gastos_duplicados', {
            p_company_id: companyId!,
            p_project_id: projectId ?? null,
          })
          .abortSignal(signal),
      )) ?? [],
  })
}

/**
 * Aviso al capturar: facturas del mismo proveedor y ledger que calzan con el
 * gasto que se está escribiendo. Solo consulta con proveedor, monto y fecha
 * puestos — sin los tres no hay nada que comparar.
 */
export function useDuplicadoProbableQuery(args: {
  companyId?: string
  projectId?: string | null
  proveedorId?: string | null
  monto?: number | null
  fecha?: string | null
  comprobante?: string | null
}) {
  const { companyId, projectId, proveedorId, monto, fecha, comprobante } = args
  const listo = !!companyId && !!proveedorId && !!monto && monto > 0 && !!fecha
  return useQuery({
    queryKey: comprasKeys.duplicadoProbable(companyId, projectId, proveedorId, monto, fecha),
    enabled: listo,
    queryFn: async () =>
      (await runQuery<FacturaCandidata[]>((signal) =>
        supabase
          .rpc('conta_gasto_duplicado_probable', {
            p_company_id: companyId!,
            p_project_id: projectId ?? null,
            p_proveedor_id: proveedorId!,
            p_monto: monto!,
            p_fecha: fecha!,
            p_comprobante: comprobante ?? null,
          })
          .abortSignal(signal),
      )) ?? [],
  })
}

export function useComprasConfigQuery(companyId?: string) {
  return useQuery({
    queryKey: comprasKeys.config(companyId),
    enabled: !!companyId,
    queryFn: async () => {
      const filas = await runQuery<ComprasConfig[]>((signal) =>
        supabase.from('compras_config').select('*').eq('company_id', companyId!).abortSignal(signal),
      )
      // Sin fila configurada rigen los mismos valores que asume la BD, para que
      // la UI no muestre tolerancias distintas de las que aplicará el trigger.
      return filas?.[0] ?? {
        company_id: companyId!,
        tolerancia_cantidad_pct: 0,
        tolerancia_precio_pct: 5,
        monto_minimo_oc: 0,
        requiere_recepcion: true,
      }
    },
  })
}

/**
 * Insumos ACTIVOS del almacén del proyecto, para elegirlos en un renglón de inventario. Solo
 * hay bodega en un proyecto: con `projectId` null (contabilidad de la empresa) no hay insumos.
 */
export function useInsumosAlmacenQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: comprasKeys.insumos(companyId, projectId),
    enabled: !!companyId && !!projectId,
    queryFn: async () =>
      (await runQuery<InsumoAlmacen[]>((signal) =>
        supabase
          .from('suministros_condominio')
          .select('id, nombre, unidad_medida, stock_actual')
          .eq('company_id', companyId!)
          .eq('project_id', projectId!)
          .eq('activo', true)
          .order('nombre', { ascending: true })
          .abortSignal(signal),
      )) ?? [],
  })
}

/** Evidencia (entrega o conformidad) de una recepción: solo-añadir, con quién y cuándo. */
export function useRespaldosRecepcionQuery(recepcionId?: string) {
  return useQuery({
    queryKey: comprasKeys.respaldos(recepcionId),
    enabled: !!recepcionId,
    queryFn: async () =>
      (await runQuery<RecepcionRespaldo[]>((signal) =>
        supabase
          .from('recepcion_respaldos')
          .select('*')
          .eq('recepcion_id', recepcionId!)
          .order('created_at', { ascending: true })
          .abortSignal(signal),
      )) ?? [],
  })
}
