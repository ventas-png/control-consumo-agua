// Contabilidad — Hooks de LECTURA (TanStack Query + runQuery, patrón del repo).
// La agregación pesada (balanza, libro mayor) corre 100% en servidor vía RPC;
// el cliente nunca descarga líneas masivas.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery, runQueryAll } from '../queryFetch'
import { contabilidadKeys } from './keys'
import { normalizarMoneda } from './schemas'
import type {
  AsientoConLineas,
  AsientoContable,
  BalanzaFila,
  CuentaContable,
  MapeoCuenta,
  CuentaEspecialEstado,
  MovimientoMayor,
  TipoCambio,
  ReglaProveedor,
  ReglaCargo,
  ResolucionImputacion,
  DestinoImputacion,
} from '../../types/contabilidad'

/** Moneda base contable de la empresa (ISO, espejo de conta_moneda_base). */
export function useMonedaBaseQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: [...contabilidadKeys.all, 'moneda-base', companyId ?? null, projectId ?? null] as const,
    enabled: !!companyId,
    queryFn: async () => {
      // Fuente única con BD: el RPC resuelve empresa (default_currency) o
      // proyecto (su moneda predominante) según el ledger.
      const moneda = await runQuery<string>((signal) =>
        supabase
          .rpc('conta_moneda_base', { p_company_id: companyId!, p_project_id: projectId ?? null })
          .abortSignal(signal),
      )
      return normalizarMoneda(moneda) ?? 'GTQ'
    },
  })
}

/** Catálogo del LEDGER (empresa con projectId null, o proyecto). */
export function useCuentasQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: contabilidadKeys.cuentas(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase
        .from('conta_cuentas')
        .select('*')
        .eq('company_id', companyId!)
        .order('codigo')
      q = projectId ? q.eq('project_id', projectId) : q.is('project_id', null)
      return (await runQuery<CuentaContable[]>((signal) => q.abortSignal(signal))) ?? []
    },
  })
}

/** Filtros de la lista de pólizas. projectId null/ausente = ledger EMPRESA. */
interface AsientosFiltro {
  projectId?: string | null
  periodo?: string
  estado?: string
}

/** Pólizas del ledger, más recientes primero (filtros opcionales). */
export function useAsientosQuery(companyId?: string, filtro: AsientosFiltro = {}) {
  return useQuery({
    queryKey: contabilidadKeys.asientos(companyId, filtro.projectId, filtro.periodo, filtro.estado),
    enabled: !!companyId,
    // PR-25 (auditoría 2026-07-28): el `.limit(500)` anterior truncaba EN SILENCIO
    // el libro. Un tenant con más de 500 asientos veía un ledger incompleto sin
    // ningún aviso — y sobre ese listado se calculan totales. `runQueryAll` trae
    // todo por chunks y avisa si topa el techo de seguridad.
    //
    // El `.order('id')` secundario NO es decorativo: `range()` necesita un orden
    // TOTAL o los chunks se solapan/saltan filas cuando hay empates en `fecha`
    // y `created_at`, que es justo lo que pasa con asientos cargados en lote.
    queryFn: async () =>
      await runQueryAll<AsientoContable>((from, to, signal) => {
        let q = supabase
          .from('conta_asientos')
          .select('*')
          .eq('company_id', companyId!)
          .order('fecha', { ascending: false })
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
        // Ledger estricto: null/undefined = contabilidad de la EMPRESA.
        q = filtro.projectId ? q.eq('project_id', filtro.projectId) : q.is('project_id', null)
        if (filtro.periodo) q = q.eq('periodo', filtro.periodo)
        if (filtro.estado) q = q.eq('estado', filtro.estado)
        return q.range(from, to).abortSignal(signal)
      }),
  })
}

/** Detalle de una póliza: cabecera + líneas con su cuenta (código/nombre). */
export function useAsientoDetalleQuery(asientoId?: string) {
  return useQuery({
    queryKey: contabilidadKeys.asiento(asientoId),
    enabled: !!asientoId,
    queryFn: async () => {
      const rows = await runQuery<AsientoConLineas[]>((signal) =>
        supabase
          .from('conta_asientos')
          .select('*, conta_asiento_lineas(*, conta_cuentas(codigo, nombre))')
          .eq('id', asientoId!)
          .limit(1)
          .abortSignal(signal),
      )
      const asiento = rows?.[0] ?? null
      if (asiento) {
        asiento.conta_asiento_lineas.sort((a, b) => a.orden - b.orden)
      }
      return asiento
    },
  })
}

/** Balanza de comprobación del periodo (RPC server-side, RLS aplica). */
export function useBalanzaQuery(companyId?: string, projectId?: string | null, periodo?: string) {
  return useQuery({
    queryKey: contabilidadKeys.balanza(companyId, projectId, periodo),
    enabled: !!companyId && !!periodo,
    queryFn: async () =>
      (await runQuery<BalanzaFila[]>((signal) =>
        supabase
          .rpc('conta_balanza_comprobacion', {
            p_company_id: companyId!,
            p_project_id: projectId ?? null,
            p_periodo: periodo!,
          })
          .abortSignal(signal),
      )) ?? [],
  })
}

/** Libro mayor de una cuenta en un rango (RPC con saldo acumulado). */
export function useLibroMayorQuery(cuentaId?: string, desde?: string, hasta?: string) {
  return useQuery({
    queryKey: contabilidadKeys.mayor(cuentaId, desde, hasta),
    enabled: !!cuentaId && !!desde && !!hasta,
    queryFn: async () =>
      (await runQuery<MovimientoMayor[]>((signal) =>
        supabase
          .rpc('conta_libro_mayor', {
            p_cuenta_id: cuentaId!,
            p_desde: desde!,
            p_hasta: hasta!,
          })
          .abortSignal(signal),
      )) ?? [],
  })
}

/** Mapeos evento→cuenta de la empresa (defaults + overrides de proyectos). */
export function useMapeoQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: contabilidadKeys.mapeo(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase
        .from('conta_mapeo_cuentas')
        .select('*')
        .eq('company_id', companyId!)
      q = projectId ? q.eq('project_id', projectId) : q.is('project_id', null)
      return (await runQuery<MapeoCuenta[]>((signal) => q.abortSignal(signal))) ?? []
    },
  })
}

/**
 * Estado de las cuentas ESPECIALES del sistema en el ledger activo: cuáles
 * están resueltas y, si no, por qué (sin mapeo / inactiva / agrupadora / de
 * otra contabilidad). Lo resuelve el servidor —anclado a `get_my_company_id()`,
 * sin aceptar la empresa por parámetro— porque el motivo depende del estado de
 * la cuenta, no sólo de que exista la fila de mapeo.
 */
export function useCuentasEspecialesQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: contabilidadKeys.cuentasEspeciales(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<CuentaEspecialEstado[]>((signal) =>
        supabase
          .rpc('conta_cuentas_especiales_estado', { p_project_id: projectId ?? null })
          .abortSignal(signal),
      )) ?? [],
  })
}

/** Tipos de cambio de la empresa, más recientes primero. */
export function useTiposCambioQuery(companyId?: string) {
  return useQuery({
    queryKey: contabilidadKeys.tiposCambio(companyId),
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<TipoCambio[]>((signal) =>
        supabase
          .from('conta_tipos_cambio')
          .select('*')
          .eq('company_id', companyId!)
          .order('fecha', { ascending: false })
          .limit(200)
          .abortSignal(signal),
      )) ?? [],
  })
}

// ── Reglas de imputación ────────────────────────────────────────────────────

/** Reglas por proveedor del LEDGER activo (empresa si projectId es null). */
export function useReglasProveedorQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: contabilidadKeys.reglasProveedor(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase
        .from('conta_reglas_proveedor')
        .select('*')
        .eq('company_id', companyId!)
      q = projectId ? q.eq('project_id', projectId) : q.is('project_id', null)
      return (await runQuery<ReglaProveedor[]>((signal) => q.abortSignal(signal))) ?? []
    },
  })
}

/**
 * Reglas por cliente/unidad/categoría del LEDGER activo, ya ordenadas de la
 * MÁS específica a la más general: es el mismo orden con el que el resolutor
 * las evalúa, así que la pantalla muestra lo que la BD va a hacer.
 */
export function useReglasCargoQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: contabilidadKeys.reglasCargo(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase
        .from('conta_reglas_cargo')
        .select('*')
        .eq('company_id', companyId!)
        .order('especificidad', { ascending: false })
        .order('id', { ascending: true })
      q = projectId ? q.eq('project_id', projectId) : q.is('project_id', null)
      return (await runQuery<ReglaCargo[]>((signal) => q.abortSignal(signal))) ?? []
    },
  })
}

/**
 * PREVISUALIZACIÓN: qué cuenta se elegiría y por qué, sin escribir nada.
 *
 * Llama a `conta_resolver_imputacion`, que es STABLE: no deja rastro en la
 * bitácora. La resolución que sí se registra es la que hace el documento al
 * contabilizarse, no ésta.
 *
 * Se habilita sólo cuando hay alguna dimensión por la que preguntar; sin
 * ninguna, la respuesta sería siempre el mapeo del evento y la pantalla
 * estaría mintiendo sobre lo que va a pasar con un documento real.
 */
export function useResolucionImputacionQuery(params: {
  companyId?: string
  projectId?: string | null
  destino?: DestinoImputacion | null
  proveedorId?: string | null
  clienteId?: string | null
  unidadId?: string | null
  categoria?: string | null
  enabled?: boolean
}) {
  const { companyId, projectId, destino, proveedorId, clienteId, unidadId, categoria } = params
  const hayDimension = !!(destino || proveedorId || clienteId || unidadId || categoria)
  return useQuery({
    queryKey: contabilidadKeys.resolucion(
      companyId, projectId, destino, proveedorId, clienteId, unidadId, categoria),
    enabled: !!companyId && hayDimension && params.enabled !== false,
    queryFn: async () => {
      const filas = await runQuery<ResolucionImputacion[]>((signal) =>
        supabase
          .rpc('conta_resolver_imputacion', {
            p_project_id: projectId ?? null,
            p_destino: destino ?? null,
            p_proveedor_id: proveedorId ?? null,
            p_cliente_id: clienteId ?? null,
            p_unidad_id: unidadId ?? null,
            p_categoria: categoria ?? null,
            p_evento: null,
            p_cuenta_explicita: null,
          })
          .abortSignal(signal),
      )
      // La RPC devuelve SIEMPRE una fila. Si no llegara ninguna, tratarlo como
      // «no resuelto» es más honesto que devolver null y que la UI decida.
      return filas?.[0] ?? {
        cuenta_id: null,
        origen_resolucion: 'sin_resolver' as const,
        regla_tabla: null,
        regla_id: null,
        evento_usado: null,
        motivo: 'La consulta de resolución no devolvió respuesta.',
      }
    },
  })
}
