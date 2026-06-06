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
