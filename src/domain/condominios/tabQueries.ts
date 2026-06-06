// domain/condominios/tabQueries.ts — Lecturas "bespoke" de los tabs complejos de
// condominios (T7/PR3, sección A). A diferencia del CRUD genérico de
// tabMutations.ts, estos tabs leen su propia data (selects con joins/filtros
// propios, counts, rangos de fecha). Aquí baja sólo el acceso a datos; la
// agregación/derivación (KPIs, reducciones) se queda en la UI. Genéricos en la
// fila (`<T>`) para no acoplar el dominio a los tipos de la UI; degradan a `[]`.
import { supabase } from '../../lib/supabase'

// ── DirectorioTab ──

/** Unidades + su cliente (join) para el directorio de residentes. Degrada a `[]`. */
export async function fetchDirectorioResidentes(
  projectId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data } = await supabase
    .from('unidades')
    .select('nombre, clientes(nombre, telefono, email, identificacion)')
    .eq('project_id', projectId)
    .order('nombre')
  return (data as Array<Record<string, unknown>> | null) ?? []
}

// ── MultiCondominioTab ──

export interface ProyectoResumenRaw {
  cuotas: Array<{ estado: string; monto: number | null; fecha_vencimiento: string | null }>
  tickets: Array<{ estado: string }>
  unidadesCount: number
  visitantesCount: number
}

/**
 * Data cruda del resumen comparativo de un proyecto: cuotas + tickets (filas
 * para que la UI agregue) y counts de unidades/visitantes-hoy. `hoy` (yyyy-mm-dd)
 * lo pasa la UI para el filtro de visitantes.
 */
export async function fetchProyectoResumen(
  projectId: string,
  companyId: string,
  hoy: string,
): Promise<ProyectoResumenRaw> {
  const [cuotasRes, ticketsRes, unidadesRes, visitantesRes] = await Promise.all([
    supabase.from('cuotas_condominio').select('estado, monto, fecha_vencimiento').eq('project_id', projectId).eq('company_id', companyId).is('deleted_at', null),
    supabase.from('tickets_mantenimiento').select('estado').eq('project_id', projectId).eq('company_id', companyId).is('deleted_at', null),
    supabase.from('unidades').select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('company_id', companyId),
    supabase.from('visitantes').select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('company_id', companyId).gte('hora_entrada', hoy),
  ])
  return {
    cuotas: (cuotasRes.data as ProyectoResumenRaw['cuotas'] | null) ?? [],
    tickets: (ticketsRes.data as ProyectoResumenRaw['tickets'] | null) ?? [],
    unidadesCount: unidadesRes.count ?? 0,
    visitantesCount: visitantesRes.count ?? 0,
  }
}

// ── PortalResidenteTab ──

/** Mensajes del portal de una unidad (más recientes primero). Degrada a `[]`. */
export async function fetchMensajesPortal<T>(unidadId: string): Promise<T[]> {
  const { data } = await supabase
    .from('mensajes_portal')
    .select('*')
    .eq('unidad_id', unidadId)
    .order('created_at', { ascending: false })
  return (data as T[] | null) ?? []
}

/** Activa el portal de una unidad guardando su token de acceso. */
export async function activarPortalUnidad(
  unidadId: string,
  token: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('unidades')
    .update({ token_portal: token, portal_activo: true })
    .eq('id', unidadId)
  return { error: error?.message ?? null }
}

// ── PortalTransparenciaTab ──

/** Fondo de reserva aprobado (modelo legacy), 50 más recientes. Degrada a `[]`. */
export async function fetchFondoReservaAprobado<T>(projectId: string): Promise<T[]> {
  const { data } = await supabase
    .from('fondo_reserva')
    .select('*')
    .eq('project_id', projectId)
    .eq('estado', 'aprobado')
    .order('fecha', { ascending: false })
    .limit(50)
  return (data as T[] | null) ?? []
}

/** Movimientos del fondo de reserva (modelo moderno), 50 más recientes. */
export async function fetchFondoReservaMovimientos<T>(projectId: string): Promise<T[]> {
  const { data } = await supabase
    .from('fondo_reserva_movimientos')
    .select('*')
    .eq('project_id', projectId)
    .order('fecha', { ascending: false })
    .limit(50)
  return (data as T[] | null) ?? []
}

/** Presupuestos del condominio para un año. */
export async function fetchPresupuestosAnio<T>(projectId: string, anio: number): Promise<T[]> {
  const { data } = await supabase
    .from('presupuestos_condominio')
    .select('*')
    .eq('project_id', projectId)
    .eq('anio', anio)
    .order('categoria')
  return (data as T[] | null) ?? []
}

// ── MantenimientoPrevTab ──

/** Ejecuciones de un plan de mantenimiento (más recientes primero). Degrada a `[]`. */
export async function fetchEjecucionesMantenimiento<T>(planId: string): Promise<T[]> {
  const { data } = await supabase
    .from('ejecuciones_mantenimiento')
    .select('*')
    .eq('plan_id', planId)
    .order('fecha', { ascending: false })
  return (data as T[] | null) ?? []
}

// ── Asambleas / votaciones ──

/** Puntos de una asamblea con sus votos (join anidado a unidades). Degrada a `[]`. */
export async function fetchPuntosAsambleaConVotos(
  asambleaId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data } = await supabase
    .from('puntos_asamblea')
    .select('*, votos_asamblea(*, unidades(nombre))')
    .eq('asamblea_id', asambleaId)
    .order('orden')
  return (data as Array<Record<string, unknown>> | null) ?? []
}

/** Asambleas digitales de un proyecto (20 más recientes). Degrada a `[]`. */
export async function fetchAsambleasDigital<T>(projectId: string): Promise<T[]> {
  const { data } = await supabase
    .from('asambleas_digital')
    .select('*')
    .eq('project_id', projectId)
    .order('fecha_hora', { ascending: false })
    .limit(20)
  return (data as T[] | null) ?? []
}

/** Puntos de varias asambleas por id (`.in`), ordenados. Degrada a `[]`. */
export async function fetchPuntosByAsambleaIds<T>(ids: string[]): Promise<T[]> {
  const { data } = await supabase
    .from('puntos_asamblea')
    .select('*')
    .in('asamblea_id', ids)
    .order('orden')
  return (data as T[] | null) ?? []
}

/** Votos previos de una unidad (punto_id + voto) para precargar el portal. */
export async function fetchVotosUnidad<T>(unidadId: string): Promise<T[]> {
  const { data } = await supabase
    .from('votos_asamblea')
    .select('punto_id, voto')
    .eq('unidad_id', unidadId)
  return (data as T[] | null) ?? []
}

/** Votos de una votación con el nombre de la unidad (join). Degrada a `[]`. */
export async function fetchVotosVotacion(
  votacionId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data } = await supabase
    .from('votos')
    .select('*, unidades(nombre)')
    .eq('votacion_id', votacionId)
  return (data as Array<Record<string, unknown>> | null) ?? []
}

// ── Rentas / STR ──

/** Huéspedes de un conjunto de reservas STR (`.in`). Degrada a `[]`. */
export async function fetchHuespedesByReservas<T>(reservaIds: string[]): Promise<T[]> {
  if (reservaIds.length === 0) return []
  const { data } = await supabase
    .from('huespedes_str')
    .select('*')
    .in('reserva_str_id', reservaIds)
  return (data as T[] | null) ?? []
}

/** Visitantes aún dentro (sin hora_salida) por reserva STR. Degrada a `[]`. */
export async function fetchVisitantesActivosByReservas(
  reservaIds: string[],
): Promise<Array<{ reserva_str_id?: string | null }>> {
  if (reservaIds.length === 0) return []
  const { data } = await supabase
    .from('visitantes')
    .select('reserva_str_id')
    .in('reserva_str_id', reservaIds)
    .is('hora_salida', null)
  return (data as Array<{ reserva_str_id?: string | null }> | null) ?? []
}

/** Contratos de arrendamiento de una unidad (más recientes primero). Degrada a `[]`. */
export async function fetchContratosByUnidad<T>(unidadId: string): Promise<T[]> {
  const { data } = await supabase
    .from('contratos_arrendamiento')
    .select('*')
    .eq('unidad_id', unidadId)
    .order('created_at', { ascending: false })
  return (data as T[] | null) ?? []
}

/** Reservas STR de una unidad (por fecha de entrada desc). Degrada a `[]`. */
export async function fetchReservasStrByUnidad<T>(unidadId: string): Promise<T[]> {
  const { data } = await supabase
    .from('reservas_str')
    .select('*')
    .eq('unidad_id', unidadId)
    .order('fecha_entrada', { ascending: false })
  return (data as T[] | null) ?? []
}

// ── Seguridad / accesos ──

/**
 * Historial de visitantes con una identificación (DPI) en la empresa, con nombre de unidad.
 * Devuelve `{ data, error }` (con shape `{ message }`) porque el buscador del puesto de
 * seguridad distingue "error" de "sin resultados".
 */
export async function fetchVisitantesPorDpi<T>(
  companyId: string,
  dpi: string,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('visitantes')
    .select('*, unidades(nombre)')
    .eq('company_id', companyId)
    .eq('identificacion', dpi)
    .order('hora_entrada', { ascending: false })
    .limit(50)
  return { data: (data as T[] | null) ?? [], error }
}

// ── Cuotas / cobranza ──

/** Cuotas de un plan de pago, ordenadas por número. Degrada a `[]`. */
export async function fetchCuotasPlanPago<T>(planId: string): Promise<T[]> {
  const { data } = await supabase
    .from('cuotas_plan_pago')
    .select('*')
    .eq('plan_id', planId)
    .order('numero')
  return (data as T[] | null) ?? []
}

/** Cantidad de recibos digitales emitidos en un proyecto (para numerar el siguiente). */
export async function countRecibosByProyecto(projectId: string): Promise<number> {
  const { count } = await supabase
    .from('recibos_digitales')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
  return count ?? 0
}

/** Bitácora de generación de cuotas de un proyecto (50 más recientes). Degrada a `[]`. */
export async function fetchGeneracionCuotasLogs<T>(projectId: string, companyId: string): Promise<T[]> {
  const { data } = await supabase
    .from('generacion_cuotas_log')
    .select('*')
    .eq('project_id', projectId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(50)
  return (data as T[] | null) ?? []
}

/** Notas actuales de una cuota de condominio (para anexar en conciliación). */
export async function fetchCuotaCondominioNotas(id: string): Promise<string | null> {
  const { data } = await supabase
    .from('cuotas_condominio')
    .select('notas')
    .eq('id', id)
    .single()
  return (data as { notas?: string | null } | null)?.notas ?? null
}

// ── Paquetería / mudanza (portal residente) ──

/** Solicitudes de mudanza de una unidad (más recientes primero). Degrada a `[]`. */
export async function fetchSolicitudesMudanzaByUnidad<T>(unidadId: string): Promise<T[]> {
  const { data } = await supabase
    .from('solicitud_mudanza_unidad')
    .select('*')
    .eq('unidad_id', unidadId)
    .order('created_at', { ascending: false })
  return (data as T[] | null) ?? []
}

/** Términos de mudanza del proyecto (vista del residente, sólo por project_id). */
export async function fetchTerminosMudanzaPorProyecto(projectId: string): Promise<string | null> {
  const { data } = await supabase
    .from('config_condominio')
    .select('terminos_mudanza')
    .eq('project_id', projectId)
    .maybeSingle()
  return (data as { terminos_mudanza: string | null } | null)?.terminos_mudanza ?? null
}

/** Fila de config del condominio (id + términos de mudanza) o `null` si no existe. */
export async function fetchConfigCondominioTerminos(
  projectId: string,
  companyId: string,
): Promise<{ id: string; terminos_mudanza: string | null } | null> {
  const { data } = await supabase
    .from('config_condominio')
    .select('id, terminos_mudanza')
    .eq('project_id', projectId)
    .eq('company_id', companyId)
    .maybeSingle()
  return (data as { id: string; terminos_mudanza: string | null } | null) ?? null
}

/** Montos de gastos del condominio dentro de un año (para "ejecutado"). */
export async function fetchGastosAnioMontos(
  projectId: string,
  year: number,
): Promise<Array<{ monto: number }>> {
  const { data } = await supabase
    .from('gastos_condominio')
    .select('monto')
    .eq('project_id', projectId)
    .gte('fecha', `${year}-01-01`)
    .lte('fecha', `${year}-12-31`)
  return (data as Array<{ monto: number }> | null) ?? []
}
