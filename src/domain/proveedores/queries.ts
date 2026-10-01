// Proveedores compartidos (PR A) — Hooks de LECTURA.
//
// Todas las lecturas pasan por la RLS de las tablas nuevas: ver proveedor↔proyecto
// exige acceso al proyecto; ver contratos, el permiso de la pestaña y el proyecto;
// ver lotes de carga, haberlos creado. La UI no filtra por su cuenta: lo que la
// base no entrega, no existe para la pantalla.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery, runQueryAll } from '../queryFetch'
import { proveedoresKeys } from './keys'
import type {
  ContratoHistoricoVistaPrevia,
  ContratoProveedorCatalogo,
  EventoContrato,
  FilaConfigCompra,
  FilaImportacion,
  ProveedorContacto,
  ProveedorProyecto,
  ReglaCompra,
  ResumenLote,
  ResumenVinculacion,
  SugerenciaCuenta,
  TipoImportacion,
  EstadoLoteImportacion,
  DestinoCompra,
} from '../../types/proveedores'

/** Llama a una RPC con el timeout y el desempaquetado de `runQuery`. */
export async function rpc<T>(nombre: string, params: Record<string, unknown> = {}): Promise<T> {
  const data = await runQuery<T>(
    (signal) => supabase.rpc(nombre, params).abortSignal(signal) as unknown as PromiseLike<{ data: T | null; error: never }>,
  )
  return data as T
}

// ── Contactos y habilitación ────────────────────────────────────────────────

export function useContactosProveedorQuery(proveedorId?: string) {
  return useQuery({
    queryKey: proveedoresKeys.contactos(proveedorId),
    enabled: !!proveedorId,
    queryFn: async () =>
      (await runQuery<ProveedorContacto[]>((signal) =>
        supabase
          .from('proveedor_contactos')
          .select('*')
          .eq('proveedor_id', proveedorId!)
          .order('es_principal', { ascending: false })
          .order('nombre')
          .abortSignal(signal),
      )) ?? [],
  })
}

/**
 * Vínculos proveedor↔proyecto que el usuario puede ver. Con `projectId` string,
 * solo los de ese proyecto (lo que necesita el selector de un proyecto); con
 * `undefined`, todos los visibles.
 */
export function useAsignacionesQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: proveedoresKeys.asignaciones(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () =>
      await runQueryAll<ProveedorProyecto>((from, to, signal) => {
        let q = supabase
          .from('proveedor_proyectos')
          .select('*')
          .eq('company_id', companyId!)
          .order('created_at')
          .order('id')
        if (projectId) q = q.eq('project_id', projectId)
        return q.range(from, to).abortSignal(signal)
      }),
  })
}

export function useAsignacionesDeProveedorQuery(proveedorId?: string) {
  return useQuery({
    queryKey: proveedoresKeys.asignacionesDeProveedor(proveedorId),
    enabled: !!proveedorId,
    queryFn: async () =>
      (await runQuery<ProveedorProyecto[]>((signal) =>
        supabase
          .from('proveedor_proyectos')
          .select('*')
          .eq('proveedor_id', proveedorId!)
          .order('created_at')
          .abortSignal(signal),
      )) ?? [],
  })
}

// ── Contratos ───────────────────────────────────────────────────────────────

/** Los contratos de un proveedor que el usuario puede ver (por empresa, proyecto y permiso). */
export function useContratosDeProveedorQuery(proveedorId?: string, enabled = true) {
  return useQuery({
    queryKey: proveedoresKeys.contratosDeProveedor(proveedorId),
    enabled: !!proveedorId && enabled,
    queryFn: async () =>
      (await runQuery<ContratoProveedorCatalogo[]>((signal) =>
        supabase
          .from('contratos_proveedores')
          .select('*')
          .eq('proveedor_id', proveedorId!)
          .order('fecha_inicio', { ascending: false })
          .abortSignal(signal),
      )) ?? [],
  })
}

export function useEventosContratoQuery(contratoId?: string) {
  return useQuery({
    queryKey: proveedoresKeys.eventosContrato(contratoId),
    enabled: !!contratoId,
    queryFn: async () =>
      (await runQuery<EventoContrato[]>((signal) =>
        supabase
          .from('contrato_proveedor_eventos')
          .select('*')
          .eq('contrato_id', contratoId!)
          .order('created_at', { ascending: false })
          .abortSignal(signal),
      )) ?? [],
  })
}

// ── Históricos sin proveedor ────────────────────────────────────────────────

export function useVistaPreviaHistoricosQuery(companyId?: string, enabled = true) {
  return useQuery({
    queryKey: proveedoresKeys.historicosVistaPrevia(companyId),
    enabled: !!companyId && enabled,
    queryFn: async () => (await rpc<ContratoHistoricoVistaPrevia[]>('contratos_sin_proveedor_vista_previa')) ?? [],
  })
}

export function useResumenVinculacionQuery(companyId?: string, enabled = true) {
  return useQuery({
    queryKey: proveedoresKeys.historicosResumen(companyId),
    enabled: !!companyId && enabled,
    queryFn: async () => await rpc<ResumenVinculacion>('contratos_vinculacion_resumen'),
  })
}

/** Grupos de proveedores LEGADOS con la misma identificación fiscal (solo informa). */
export function useDuplicadosFiscalesQuery(companyId?: string, enabled = true) {
  return useQuery({
    queryKey: proveedoresKeys.duplicados(companyId),
    enabled: !!companyId && enabled,
    queryFn: async () =>
      (await rpc<
        { identificacion_norm: string; cantidad: number; paises: string[] | null;
          proveedores: { id: string; codigo: string | null; nombre: string; pais: string | null; estado: string }[] }[]
      >('proveedores_duplicados_fiscales')) ?? [],
  })
}

// ── Reglas de compra y cuentas sugeridas ────────────────────────────────────

/** Acota una consulta al ledger activo: NULL = empresa, uuid = ese proyecto. */
function alLedger<T extends { eq: (c: string, v: string) => T; is: (c: string, v: null) => T }>(
  q: T,
  projectId?: string | null,
): T {
  return projectId ? q.eq('project_id', projectId) : q.is('project_id', null)
}

export function useReglasCompraQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: proveedoresKeys.reglasCompra(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () =>
      await runQueryAll<ReglaCompra>((from, to, signal) => {
        let q = supabase
          .from('conta_reglas_compra')
          .select('*')
          .eq('company_id', companyId!)
          .order('destino')
          .order('especificidad', { ascending: false })
          .order('vigente_desde', { ascending: false })
          .order('id')
        q = alLedger(q as never, projectId)
        return q.range(from, to).abortSignal(signal)
      }),
  })
}

export function useConfigCompraQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: proveedoresKeys.configCompra(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () => (await rpc<FilaConfigCompra[]>('compras_config_estado', { p_project_id: projectId ?? null })) ?? [],
  })
}

export interface ParamsSugerencia {
  projectId: string | null
  destino: DestinoCompra
  categoria: string | null
  suministroId: string | null
  proveedorId: string | null
  /** Fecha del documento (vigencia de las reglas). */
  fecha: string
}

/**
 * La cuenta que se SUGIERE al capturar una línea. El servidor la resuelve (la
 * pantalla no reimplementa la precedencia): línea > regla de compra > regla del
 * proveedor > mapeo del evento > sin_resolver.
 */
export function useSugerenciaCuentaQuery(p: ParamsSugerencia, enabled = true) {
  return useQuery({
    queryKey: proveedoresKeys.sugerencia(p.projectId, p.destino, p.categoria, p.suministroId, p.proveedorId, p.fecha),
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const filas = await rpc<SugerenciaCuenta[]>('compras_sugerir_cuenta', {
        p_project_id: p.projectId,
        p_destino: p.destino,
        p_categoria: p.categoria,
        p_suministro_id: p.suministroId,
        p_proveedor_id: p.proveedorId,
        p_fecha: p.fecha,
      })
      return filas?.[0] ?? null
    },
  })
}

// ── Carga masiva ────────────────────────────────────────────────────────────

export interface LoteImportacion {
  id: string
  tipo: TipoImportacion
  archivo_nombre: string | null
  estado: EstadoLoteImportacion
  modo: string | null
  opciones: { actualizar_existentes: boolean; vaciar_vacios: boolean }
  resumen: ResumenLote
  resultado: Record<string, unknown> | null
  created_at: string
  aplicado_at: string | null
}

export function useLotesImportacionQuery(companyId?: string, tipo?: TipoImportacion) {
  return useQuery({
    queryKey: proveedoresKeys.lotes(companyId, tipo),
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<LoteImportacion[]>((signal) => {
        let q = supabase
          .from('proveedor_importaciones')
          .select('id, tipo, archivo_nombre, estado, modo, opciones, resumen, resultado, created_at, aplicado_at')
          .eq('company_id', companyId!)
          .order('created_at', { ascending: false })
          .limit(20)
        if (tipo) q = q.eq('tipo', tipo)
        return q.abortSignal(signal)
      })) ?? [],
  })
}

/** Resultado por fila de un lote (hasta 2000). */
export function useFilasLoteQuery(loteId?: string) {
  return useQuery({
    queryKey: proveedoresKeys.filasLote(loteId),
    enabled: !!loteId,
    queryFn: async () =>
      await runQueryAll<FilaImportacion>((from, to, signal) =>
        supabase
          .from('proveedor_importacion_filas')
          .select('*')
          .eq('lote_id', loteId!)
          .order('fila')
          .range(from, to)
          .abortSignal(signal),
      ),
  })
}

// ── Ficha del proveedor: documentos relacionados ────────────────────────────

export interface ActividadProveedor {
  ordenes: { id: string; numero: string | null; concepto: string; estado: string; total: number; moneda: string | null; project_id: string | null }[]
  recepciones: { id: string; numero: string | null; fecha: string; estado: string; orden_numero: string | null }[]
  facturas: { id: string; numero_factura: string | null; concepto: string; estado: string; monto_total: number; monto_pagado: number; moneda: string | null }[]
  pagos: { id: string; monto: number; estado: string; fecha_pago: string | null; metodo_pago: string }[]
}

export interface SeccionesActividad {
  ordenes: boolean
  recepciones: boolean
  facturas: boolean
  pagos: boolean
}

const LIMITE_ACTIVIDAD = 5

/**
 * Lo último que hay de un proveedor, por tipo de documento. Cada sección se
 * consulta SOLO si el usuario tiene permiso para verla; la RLS de cada tabla
 * decide además qué filas llegan (empresa, proyecto). Que una sección esté
 * apagada no es un botón oculto: la consulta ni se hace.
 */
export function useActividadProveedorQuery(proveedorId: string | undefined, secciones: SeccionesActividad) {
  return useQuery({
    queryKey: [...proveedoresKeys.all, 'actividad', proveedorId ?? null, secciones] as const,
    enabled: !!proveedorId && Object.values(secciones).some(Boolean),
    queryFn: async (): Promise<ActividadProveedor> => {
      const [ordenes, recepciones, facturas, pagos] = await Promise.all([
        secciones.ordenes
          ? runQuery<ActividadProveedor['ordenes']>((signal) =>
              supabase
                .from('ordenes_compra')
                .select('id, numero, concepto, estado, total, moneda, project_id')
                .eq('proveedor_id', proveedorId!)
                .order('created_at', { ascending: false })
                .limit(LIMITE_ACTIVIDAD)
                .abortSignal(signal),
            )
          : Promise.resolve(null),
        secciones.recepciones
          ? runQuery<{ id: string; numero: string | null; fecha: string; estado: string; ordenes_compra: { numero: string | null } | { numero: string | null }[] | null }[]>((signal) =>
              supabase
                .from('recepciones')
                .select('id, numero, fecha, estado, ordenes_compra!inner(proveedor_id, numero)')
                .eq('ordenes_compra.proveedor_id', proveedorId!)
                .order('fecha', { ascending: false })
                .limit(LIMITE_ACTIVIDAD)
                .abortSignal(signal),
            )
          : Promise.resolve(null),
        secciones.facturas
          ? runQuery<ActividadProveedor['facturas']>((signal) =>
              supabase
                .from('facturas_proveedor')
                .select('id, numero_factura, concepto, estado, monto_total, monto_pagado, moneda')
                .eq('proveedor_id', proveedorId!)
                .order('fecha_emision', { ascending: false })
                .limit(LIMITE_ACTIVIDAD)
                .abortSignal(signal),
            )
          : Promise.resolve(null),
        secciones.pagos
          ? runQuery<ActividadProveedor['pagos']>((signal) =>
              supabase
                .from('ordenes_pago')
                .select('id, monto, estado, fecha_pago, metodo_pago')
                .eq('proveedor_id', proveedorId!)
                .order('created_at', { ascending: false })
                .limit(LIMITE_ACTIVIDAD)
                .abortSignal(signal),
            )
          : Promise.resolve(null),
      ])
      return {
        ordenes: ordenes ?? [],
        recepciones: (recepciones ?? []).map((r) => {
          // PostgREST devuelve el embed como objeto (muchos-a-uno) o arreglo, según el esquema.
          const oc = Array.isArray(r.ordenes_compra) ? r.ordenes_compra[0] : r.ordenes_compra
          return { id: r.id, numero: r.numero, fecha: r.fecha, estado: r.estado, orden_numero: oc?.numero ?? null }
        }),
        facturas: facturas ?? [],
        pagos: pagos ?? [],
      }
    },
  })
}

/** Nombre de la empresa activa, para dejar claro en pantalla dónde se está trabajando. */
export function useEmpresaNombreQuery(companyId?: string) {
  return useQuery({
    queryKey: [...proveedoresKeys.all, 'empresa-nombre', companyId ?? null] as const,
    enabled: !!companyId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const fila = await runQuery<{ nombre: string }>((signal) =>
        supabase.from('companies').select('nombre').eq('id', companyId!).abortSignal(signal).maybeSingle(),
      )
      return fila?.nombre ?? null
    },
  })
}

/** Usuarios activos de la empresa que pueden ser responsables de un contrato. */
export function useResponsablesQuery(companyId?: string) {
  return useQuery({
    queryKey: proveedoresKeys.responsables(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (await runQuery<{ id: string; full_name: string | null }[]>((signal) =>
        supabase.from('app_users').select('id, full_name').eq('company_id', companyId!).eq('activo', true).order('full_name').abortSignal(signal),
      )) ?? [],
  })
}

/** Insumos del proyecto (para las reglas de compra por producto). */
export function useSuministrosProyectoQuery(projectId?: string | null) {
  return useQuery({
    queryKey: proveedoresKeys.suministros(projectId),
    enabled: !!projectId,
    queryFn: async () =>
      (await runQuery<{ id: string; nombre: string; categoria: string }[]>((signal) =>
        supabase.from('suministros_condominio').select('id, nombre, categoria').eq('project_id', projectId!).eq('activo', true).order('nombre').abortSignal(signal),
      )) ?? [],
  })
}
