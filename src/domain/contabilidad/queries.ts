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
  ResolucionImputacion,
  DestinoImputacion,
  FacturaPendiente,
  FiltroPendiente,
  IntentoContabilizacion,
  ConfigTipoCargoEstado,
  AuxiliarCliente,
  CargoPendiente,
  FiltroCargoPendiente,
  ConciliacionEstadoCuenta,
  DocumentoFueraDeSaldo,
  EstadoCuenta,
  SujetoEstadoCuenta,
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

// ── Pendientes de contabilización ───────────────────────────────────────────

export const PENDIENTES_POR_PAGINA = 20

/**
 * Bandeja de facturas aprobadas SIN asiento, de la contabilidad activa.
 *
 * Filtro, búsqueda y paginación corren en SERVIDOR (`conta_facturas_pendientes`):
 * la RPC decide qué es un pendiente —aprobada, sin asiento de devengo y con al
 * menos un intento— y acota a la empresa de la sesión y a los proyectos del
 * usuario. El cliente no filtra nada por su cuenta.
 */
export function useFacturasPendientesQuery(params: {
  companyId?: string
  projectId?: string | null
  codigo?: FiltroPendiente | null
  busqueda?: string | null
  pagina?: number
}) {
  const { companyId, projectId, codigo, busqueda, pagina = 0 } = params
  return useQuery({
    queryKey: contabilidadKeys.pendientes(companyId, projectId, codigo, busqueda, pagina),
    enabled: !!companyId,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const filas = await runQuery<FacturaPendiente[]>((signal) =>
        supabase
          .rpc('conta_facturas_pendientes', {
            p_project_id: projectId ?? null,
            p_codigo: codigo ?? null,
            p_busqueda: busqueda?.trim() || null,
            p_limite: PENDIENTES_POR_PAGINA,
            p_offset: pagina * PENDIENTES_POR_PAGINA,
          })
          .abortSignal(signal),
      )
      const lista = filas ?? []
      return { filas: lista, total: lista[0]?.total_filas ?? 0 }
    },
  })
}

/** Historial de intentos de UNA factura (RLS: empresa y proyectos del usuario). */
export function useIntentosFacturaQuery(facturaId?: string | null) {
  return useQuery({
    queryKey: contabilidadKeys.intentos(facturaId),
    enabled: !!facturaId,
    queryFn: async () =>
      (await runQuery<IntentoContabilizacion[]>((signal) =>
        supabase
          .from('conta_intentos_contabilizacion')
          .select('*')
          .eq('origen_tabla', 'facturas_proveedor')
          .eq('origen_id', facturaId!)
          .order('created_at', { ascending: false })
          .limit(50)
          .abortSignal(signal),
      )) ?? [],
  })
}

/**
 * Bandeja de CARGOS sin asiento (cuotas clasificadas, su mora y cargos
 * adicionales) de la contabilidad activa. Igual que la de facturas: filtro,
 * búsqueda y paginación en servidor (`conta_cargos_pendientes`), que además
 * decide qué es pendiente y acota a la empresa y proyectos del usuario.
 */
export function useCargosPendientesQuery(params: {
  companyId?: string
  projectId?: string | null
  codigo?: FiltroCargoPendiente | null
  busqueda?: string | null
  pagina?: number
}) {
  const { companyId, projectId, codigo, busqueda, pagina = 0 } = params
  return useQuery({
    queryKey: contabilidadKeys.cargosPendientes(companyId, projectId, codigo, busqueda, pagina),
    enabled: !!companyId,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const filas = await runQuery<CargoPendiente[]>((signal) =>
        supabase
          .rpc('conta_cargos_pendientes', {
            p_project_id: projectId ?? null,
            p_codigo: codigo ?? null,
            p_busqueda: busqueda?.trim() || null,
            p_limite: PENDIENTES_POR_PAGINA,
            p_offset: pagina * PENDIENTES_POR_PAGINA,
          })
          .abortSignal(signal),
      )
      const lista = filas ?? []
      return { filas: lista, total: lista[0]?.total_filas ?? 0 }
    },
  })
}

/**
 * Configuración por tipo de cargo del LEDGER activo, con su estado.
 *
 * Una fila por tipo del catálogo declarado en el servidor, configurado o no.
 * El estado lo calcula `conta_config_tipos_cargo_estado` (SECURITY INVOKER,
 * con la RLS de la sesión): una cuenta que era válida al configurar y se
 * desactivó después aparece como `cuenta_invalida` aquí, no al contabilizar.
 */
export function useConfigTiposCargoQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: contabilidadKeys.configTiposCargo(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<ConfigTipoCargoEstado[]>((signal) =>
        supabase
          .rpc('conta_config_tipos_cargo_estado', { p_project_id: projectId ?? null })
          .abortSignal(signal),
      )) ?? [],
  })
}

/** Tope de clientes por consulta: la búsqueda y el filtro corren en servidor. */
export const AUXILIARES_LIMITE = 100

/**
 * Clientes ACTIVOS de la empresa con su nomenclatura de auxiliar, si la tienen.
 *
 * La búsqueda por nombre se resuelve en servidor y la lista se acota a
 * `AUXILIARES_LIMITE`; la nomenclatura se lee sólo para los clientes de la
 * página, por id.
 */
export function useAuxiliaresQuery(companyId?: string, busqueda?: string | null) {
  const termino = (busqueda ?? '').trim()
  return useQuery({
    queryKey: contabilidadKeys.auxiliares(companyId, termino || null),
    enabled: !!companyId,
    queryFn: async (): Promise<AuxiliarCliente[]> => {
      let q = supabase
        .from('company_clientes')
        .select('cliente_id, clientes!company_clientes_cliente_id_fkey!inner(nombre, codigo)')
        .eq('company_id', companyId!)
        .eq('activo', true)
        .order('nombre', { referencedTable: 'clientes' })
        .limit(AUXILIARES_LIMITE)
      if (termino) q = q.ilike('clientes.nombre', `%${termino}%`)
      // El cliente sin tipos infiere el embed como arreglo; PostgREST devuelve
      // un objeto para una FK a uno. Se aceptan las dos formas.
      type ClienteEmbed = { nombre: string; codigo: string | null }
      const filas = (await runQuery<Array<{
        cliente_id: string
        clientes: ClienteEmbed | ClienteEmbed[] | null
      }>>((signal) => q.abortSignal(signal))) ?? []
      const clientes = filas.map((f) => ({
        cliente_id: f.cliente_id,
        clientes: Array.isArray(f.clientes) ? (f.clientes[0] ?? null) : f.clientes,
      }))
      if (clientes.length === 0) return []

      const ids = clientes.map((c) => c.cliente_id)
      const aux = (await runQuery<Array<{ id: string; cliente_id: string; codigo: string; activo: boolean }>>(
        (signal) =>
          supabase
            .from('conta_auxiliares')
            .select('id, cliente_id, codigo, activo')
            .eq('company_id', companyId!)
            .in('cliente_id', ids)
            .abortSignal(signal),
      )) ?? []
      const porCliente = new Map(aux.map((a) => [a.cliente_id, a]))
      return clientes
        .map((c) => {
          const a = porCliente.get(c.cliente_id)
          return {
            cliente_id: c.cliente_id,
            cliente_nombre: c.clientes?.nombre ?? '',
            cliente_codigo: c.clientes?.codigo ?? null,
            auxiliar_id: a?.id ?? null,
            codigo: a?.codigo ?? null,
            activo: a?.activo ?? null,
          }
        })
        .sort((x, y) => x.cliente_nombre.localeCompare(y.cliente_nombre, 'es'))
    },
  })
}

// ── Estado de cuenta por auxiliar (cliente) y por unidad ─────────────────────

export const ESTADO_CUENTA_POR_PAGINA = 50
export const FUERA_DE_SALDO_POR_PAGINA = 20

function argsSujeto(sujeto: SujetoEstadoCuenta) {
  return sujeto.tipo === 'cliente'
    ? { p_cliente_id: sujeto.id, p_unidad_id: null }
    : { p_cliente_id: null, p_unidad_id: sujeto.id }
}

/**
 * Estado de cuenta del sujeto en el ledger activo. El servidor valida permiso,
 * proyecto y sujeto, y calcula saldo inicial, totales, saldo final y saldo
 * acumulado sobre TODO el rango antes de paginar: la página sólo recorta filas.
 */
export function useEstadoCuentaQuery(params: {
  companyId?: string
  projectId: string | null
  sujeto: SujetoEstadoCuenta | null
  desde: string | null
  hasta: string | null
  pagina: number
}) {
  const { companyId, projectId, sujeto, desde, hasta, pagina } = params
  return useQuery({
    queryKey: contabilidadKeys.estadoCuenta(companyId, projectId, sujeto ? `${sujeto.tipo}:${sujeto.id}` : null, desde, hasta, pagina),
    enabled: !!companyId && !!sujeto,
    placeholderData: (prev) => prev,
    queryFn: async () =>
      (await runQuery<EstadoCuenta>((signal) =>
        supabase
          .rpc('conta_estado_cuenta', {
            p_project_id: projectId,
            ...argsSujeto(sujeto!),
            p_desde: desde,
            p_hasta: hasta,
            p_limite: ESTADO_CUENTA_POR_PAGINA,
            p_offset: pagina * ESTADO_CUENTA_POR_PAGINA,
          })
          .abortSignal(signal),
      )) as EstadoCuenta,
  })
}

/** Documentos del sujeto que NO están en su saldo contable, con su motivo. */
export function useEstadoCuentaFueraQuery(params: {
  companyId?: string
  projectId: string | null
  sujeto: SujetoEstadoCuenta | null
  hasta: string | null
  pagina: number
}) {
  const { companyId, projectId, sujeto, hasta, pagina } = params
  return useQuery({
    queryKey: contabilidadKeys.estadoCuentaFuera(companyId, projectId, sujeto ? `${sujeto.tipo}:${sujeto.id}` : null, hasta, pagina),
    enabled: !!companyId && !!sujeto,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const filas = (await runQuery<DocumentoFueraDeSaldo[]>((signal) =>
        supabase
          .rpc('conta_estado_cuenta_pendientes', {
            p_project_id: projectId,
            ...argsSujeto(sujeto!),
            p_hasta: hasta,
            p_limite: FUERA_DE_SALDO_POR_PAGINA,
            p_offset: pagina * FUERA_DE_SALDO_POR_PAGINA,
          })
          .abortSignal(signal),
      )) ?? []
      return { filas, total: filas[0]?.total_filas ?? 0 }
    },
  })
}

/** Conciliación del saldo contable del sujeto con sus documentos, al corte. */
export function useEstadoCuentaConciliacionQuery(params: {
  companyId?: string
  projectId: string | null
  sujeto: SujetoEstadoCuenta | null
  corte: string | null
  enabled?: boolean
}) {
  const { companyId, projectId, sujeto, corte, enabled = true } = params
  return useQuery({
    queryKey: contabilidadKeys.estadoCuentaConciliacion(companyId, projectId, sujeto ? `${sujeto.tipo}:${sujeto.id}` : null, corte),
    enabled: enabled && !!companyId && !!sujeto,
    queryFn: async () =>
      (await runQuery<ConciliacionEstadoCuenta>((signal) =>
        supabase
          .rpc('conta_estado_cuenta_conciliacion', {
            p_project_id: projectId,
            ...argsSujeto(sujeto!),
            p_corte: corte,
          })
          .abortSignal(signal),
      )) as ConciliacionEstadoCuenta,
  })
}

/** Unidades del proyecto del ledger activo (el ledger de empresa no tiene). */
export function useUnidadesLedgerQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: contabilidadKeys.unidadesLedger(companyId, projectId),
    enabled: !!companyId && !!projectId,
    queryFn: async () =>
      (await runQuery<Array<{ id: string; nombre: string }>>((signal) =>
        supabase
          .from('unidades')
          .select('id, nombre')
          .eq('company_id', companyId!)
          .eq('project_id', projectId!)
          .order('nombre', { ascending: true })
          .abortSignal(signal),
      )) ?? [],
  })
}
