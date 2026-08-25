// domain/condominios/tabQueries.ts — Lecturas "bespoke" de los tabs complejos de
// condominios (T7/PR3, sección A). A diferencia del CRUD genérico de
// tabMutations.ts, estos tabs leen su propia data (selects con joins/filtros
// propios, counts, rangos de fecha). Aquí baja sólo el acceso a datos; la
// agregación/derivación (KPIs, reducciones) se queda en la UI. Genéricos en la
// fila (`<T>`) para no acoplar el dominio a los tipos de la UI; degradan a `[]`.
//
// P2 tipos: migrado al cliente tipado `db` (tablas/columnas/embeds chequeados
// contra el esquema generado). `supabase` (sin tipar) queda SOLO para las dos
// tablas que no existen en el esquema generado (ver comentarios in situ).
import { reportDegradedQuery } from '../queryFetch'
import { db, supabase } from '../../lib/supabase'
import type {
  HorasPersonal,
  PlantillaTareaHerramienta,
  PlantillaTareaSuministro,
  RutinaActividad,
  RutinaLimpieza,
  UsuarioAsignablePersonal,
} from '../../types'

// ── DirectorioTab ──

/** Unidades + su cliente (join) para el directorio de residentes. Degrada a `[]`. */
export async function fetchDirectorioResidentes(
  projectId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db
    .from('unidades')
    .select('nombre, clientes(nombre, telefono, email, identificacion)')
    .eq('project_id', projectId)
    .order('nombre')
  reportDegradedQuery('condominios.fetchDirectorioResidentes', error)
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
 * Data cruda del resumen comparativo para VARIOS proyectos en 4 QUERIES totales
 * (P2 perf: antes era 4 × N — un fetch por proyecto). Las filas vienen
 * etiquetadas con project_id y se agrupan aquí; los counts (unidades /
 * visitantes-hoy) se derivan contando filas por proyecto. `hoy` (yyyy-mm-dd) lo
 * pasa la UI para el filtro de visitantes.
 */
export async function fetchProyectosResumen(
  projectIds: string[],
  companyId: string,
  hoy: string,
): Promise<Record<string, ProyectoResumenRaw>> {
  const porProyecto: Record<string, ProyectoResumenRaw> = {}
  for (const id of projectIds) {
    porProyecto[id] = { cuotas: [], tickets: [], unidadesCount: 0, visitantesCount: 0 }
  }
  if (projectIds.length === 0) return porProyecto
  const [cuotasRes, ticketsRes, unidadesRes, visitantesRes] = await Promise.all([
    db.from('cuotas_condominio').select('project_id, estado, monto, fecha_vencimiento').in('project_id', projectIds).eq('company_id', companyId).is('deleted_at', null),
    db.from('tickets_mantenimiento').select('project_id, estado').in('project_id', projectIds).eq('company_id', companyId).is('deleted_at', null),
    db.from('unidades').select('project_id').in('project_id', projectIds).eq('company_id', companyId),
    db.from('visitantes').select('project_id').in('project_id', projectIds).eq('company_id', companyId).gte('hora_entrada', hoy),
  ])
  for (const c of cuotasRes.data ?? []) porProyecto[c.project_id]?.cuotas.push(c)
  for (const t of ticketsRes.data ?? []) porProyecto[t.project_id]?.tickets.push(t)
  for (const u of unidadesRes.data ?? []) { const r = porProyecto[u.project_id]; if (r) r.unidadesCount++ }
  for (const v of visitantesRes.data ?? []) { const r = porProyecto[v.project_id]; if (r) r.visitantesCount++ }
  return porProyecto
}

// ── TicketChatModal ──

/**
 * Hilo de conversación de un ticket, en orden cronológico (el chat se lee de
 * arriba hacia abajo). RLS decide qué ve cada quien: el staff ve todo el hilo;
 * el residente, solo los mensajes no internos de los tickets de sus unidades.
 * Degrada a `[]`.
 */
export async function fetchComentariosTicket<T>(ticketId: string): Promise<T[]> {
  const { data, error } = await db
    .from('comentarios_ticket')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
  reportDegradedQuery('condominios.fetchComentariosTicket', error)
  return (data as T[] | null) ?? []
}

/**
 * Cuántos mensajes tiene cada ticket de la lista (para el badge "N mensajes" sin
 * bajar los hilos completos). Devuelve un mapa ticket_id → conteo; los tickets
 * sin mensajes quedan fuera. Degrada a `{}`.
 */
export async function fetchConteoComentariosTickets(
  ticketIds: string[],
): Promise<Record<string, number>> {
  if (ticketIds.length === 0) return {}
  const { data, error } = await db
    .from('comentarios_ticket')
    .select('ticket_id')
    .in('ticket_id', ticketIds)
  reportDegradedQuery('condominios.fetchConteoComentariosTickets', error)
  const conteo: Record<string, number> = {}
  for (const row of data ?? []) conteo[row.ticket_id] = (conteo[row.ticket_id] ?? 0) + 1
  return conteo
}

// ── MensajePortalChatModal ──

/**
 * Hilo de conversación de un mensaje a la administración, en orden cronológico.
 * RLS decide qué ve cada quien: el staff ve todo el hilo; el residente, solo los
 * mensajes no internos de los hilos de sus unidades. Degrada a `[]`.
 */
export async function fetchComentariosMensajePortal<T>(mensajeId: string): Promise<T[]> {
  const { data, error } = await db
    .from('comentarios_mensaje_portal')
    .select('*')
    .eq('mensaje_id', mensajeId)
    .order('created_at', { ascending: true })
  reportDegradedQuery('condominios.fetchComentariosMensajePortal', error)
  return (data as T[] | null) ?? []
}

/**
 * Cuántos mensajes tiene cada hilo de la lista (para el badge, sin bajar los
 * hilos completos). Mapa mensaje_id → conteo; los que no tienen quedan fuera.
 */
export async function fetchConteoComentariosMensajePortal(
  mensajeIds: string[],
): Promise<Record<string, number>> {
  if (mensajeIds.length === 0) return {}
  const { data, error } = await db
    .from('comentarios_mensaje_portal')
    .select('mensaje_id')
    .in('mensaje_id', mensajeIds)
  reportDegradedQuery('condominios.fetchConteoComentariosMensajePortal', error)
  const conteo: Record<string, number> = {}
  for (const row of data ?? []) conteo[row.mensaje_id] = (conteo[row.mensaje_id] ?? 0) + 1
  return conteo
}

// ── PortalResidenteTab ──

/** Mensajes del portal de una unidad (más recientes primero). Degrada a `[]`. */
export async function fetchMensajesPortal<T>(unidadId: string): Promise<T[]> {
  const { data, error } = await db
    .from('mensajes_portal')
    .select('*')
    .eq('unidad_id', unidadId)
    .order('created_at', { ascending: false })
  reportDegradedQuery('condominios.fetchMensajesPortal', error)
  return (data as T[] | null) ?? []
}

/** Activa el portal de una unidad guardando su token de acceso. */
export async function activarPortalUnidad(
  unidadId: string,
  token: string,
): Promise<{ error: string | null }> {
  const { error } = await db
    .from('unidades')
    .update({ token_portal: token, portal_activo: true })
    .eq('id', unidadId)
  return { error: error?.message ?? null }
}

// ── PortalTransparenciaTab ──

/** Fondo de reserva aprobado, 50 más recientes. Degrada a `[]`. */
// FIX (query rota en runtime, cazada por el arco de tipado): apuntaba a
// `fondo_reserva`, que NO tiene columna `estado` → PostgREST 400 y el tab
// degradaba a [] siempre. La tabla con estado/justificacion/aprobado_por (el
// shape de `FondoReserva`) es `fondo_reserva_condominio`; lleva soft-delete,
// así que se filtra deleted_at como hace sectionData.
export async function fetchFondoReservaAprobado<T>(projectId: string): Promise<T[]> {
  const { data, error } = await db
    .from('fondo_reserva_condominio')
    .select('*')
    .eq('project_id', projectId)
    .eq('estado', 'aprobado')
    .is('deleted_at', null)
    .order('fecha', { ascending: false })
    .limit(50)
  reportDegradedQuery('condominios.fetchFondoReservaAprobado', error)
  return (data as T[] | null) ?? []
}

/** Movimientos del fondo de reserva (ledger), 50 más recientes. */
// FIX (query rota en runtime): apuntaba a `fondo_reserva_movimientos`, tabla
// inexistente. El ledger de movimientos (tipo/concepto/monto/fecha/referencia —
// el shape de `FondoReservaMovimiento`) es la tabla `fondo_reserva`.
export async function fetchFondoReservaMovimientos<T>(projectId: string): Promise<T[]> {
  const { data, error } = await db
    .from('fondo_reserva')
    .select('*')
    .eq('project_id', projectId)
    .order('fecha', { ascending: false })
    .limit(50)
  reportDegradedQuery('condominios.fetchFondoReservaMovimientos', error)
  return (data as T[] | null) ?? []
}

/** Presupuestos del condominio para un año. */
// FIX (query rota en runtime): apuntaba a `presupuestos_condominio`, tabla
// inexistente — la real es `presupuesto_condominio` (singular; su Row calza
// 1:1 con el tipo PresupuestoCondominio del dominio).
export async function fetchPresupuestosAnio<T>(projectId: string, anio: number): Promise<T[]> {
  const { data, error } = await db
    .from('presupuesto_condominio')
    .select('*')
    .eq('project_id', projectId)
    .eq('anio', anio)
    .order('categoria')
  reportDegradedQuery('condominios.fetchPresupuestosAnio', error)
  return (data as T[] | null) ?? []
}

// ── MantenimientoPrevTab ──

/** Ejecuciones de un plan de mantenimiento (más recientes primero). Degrada a `[]`. */
export async function fetchEjecucionesMantenimiento<T>(planId: string): Promise<T[]> {
  const { data, error } = await db
    .from('ejecuciones_mantenimiento')
    .select('*')
    .eq('plan_id', planId)
    .order('fecha', { ascending: false })
  reportDegradedQuery('condominios.fetchEjecucionesMantenimiento', error)
  return (data as T[] | null) ?? []
}

// ── Asambleas / votaciones ──

/** Puntos de una asamblea con sus votos (join anidado a unidades). Degrada a `[]`. */
export async function fetchPuntosAsambleaConVotos(
  asambleaId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db
    .from('puntos_asamblea')
    .select('*, votos_asamblea(*, unidades(nombre))')
    .eq('asamblea_id', asambleaId)
    .order('orden')
  reportDegradedQuery('condominios.fetchPuntosAsambleaConVotos', error)
  return (data as Array<Record<string, unknown>> | null) ?? []
}

/** Asambleas digitales de un proyecto (20 más recientes). Degrada a `[]`. */
export async function fetchAsambleasDigital<T>(projectId: string): Promise<T[]> {
  const { data, error } = await db
    .from('asambleas_digital')
    .select('*')
    .eq('project_id', projectId)
    .order('fecha_hora', { ascending: false })
    .limit(20)
  reportDegradedQuery('condominios.fetchAsambleasDigital', error)
  return (data as T[] | null) ?? []
}

/** Puntos de varias asambleas por id (`.in`), ordenados. Degrada a `[]`. */
export async function fetchPuntosByAsambleaIds<T>(ids: string[]): Promise<T[]> {
  const { data, error } = await db
    .from('puntos_asamblea')
    .select('*')
    .in('asamblea_id', ids)
    .order('orden')
  reportDegradedQuery('condominios.fetchPuntosByAsambleaIds', error)
  return (data as T[] | null) ?? []
}

/** Votos previos de una unidad (punto_id + voto) para precargar el portal. */
export async function fetchVotosUnidad<T>(unidadId: string): Promise<T[]> {
  const { data, error } = await db
    .from('votos_asamblea')
    .select('punto_id, voto')
    .eq('unidad_id', unidadId)
  reportDegradedQuery('condominios.fetchVotosUnidad', error)
  return (data as T[] | null) ?? []
}

/** Votos de una votación con el nombre de la unidad (join). Degrada a `[]`. */
export async function fetchVotosVotacion(
  votacionId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db
    .from('votos')
    .select('*, unidades(nombre)')
    .eq('votacion_id', votacionId)
  reportDegradedQuery('condominios.fetchVotosVotacion', error)
  return (data as Array<Record<string, unknown>> | null) ?? []
}

// ── Rentas / STR ──

/** Huéspedes de un conjunto de reservas STR (`.in`). Degrada a `[]`. */
export async function fetchHuespedesByReservas<T>(reservaIds: string[]): Promise<T[]> {
  if (reservaIds.length === 0) return []
  const { data, error } = await db
    .from('huespedes_str')
    .select('*')
    .in('reserva_str_id', reservaIds)
  reportDegradedQuery('condominios.fetchHuespedesByReservas', error)
  return (data as T[] | null) ?? []
}

/** Visitantes aún dentro (sin hora_salida) por reserva STR. Degrada a `[]`. */
export async function fetchVisitantesActivosByReservas(
  reservaIds: string[],
): Promise<Array<{ reserva_str_id?: string | null }>> {
  if (reservaIds.length === 0) return []
  const { data, error } = await db
    .from('visitantes')
    .select('reserva_str_id')
    .in('reserva_str_id', reservaIds)
    .is('hora_salida', null)
  reportDegradedQuery('condominios.fetchVisitantesActivosByReservas', error)
  return (data as Array<{ reserva_str_id?: string | null }> | null) ?? []
}

/** Contratos de arrendamiento de una unidad (más recientes primero). Degrada a `[]`. */
export async function fetchContratosByUnidad<T>(unidadId: string): Promise<T[]> {
  const { data, error } = await db
    .from('contratos_arrendamiento')
    .select('*')
    .eq('unidad_id', unidadId)
    .order('created_at', { ascending: false })
  reportDegradedQuery('condominios.fetchContratosByUnidad', error)
  return (data as T[] | null) ?? []
}

/** Reservas STR de una unidad (por fecha de entrada desc). Degrada a `[]`. */
export async function fetchReservasStrByUnidad<T>(unidadId: string): Promise<T[]> {
  const { data, error } = await db
    .from('reservas_str')
    .select('*')
    .eq('unidad_id', unidadId)
    .order('fecha_entrada', { ascending: false })
  reportDegradedQuery('condominios.fetchReservasStrByUnidad', error)
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
  const { data, error } = await db
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
  const { data, error } = await db
    .from('cuotas_plan_pago')
    .select('*')
    .eq('plan_id', planId)
    .order('numero')
  reportDegradedQuery('condominios.fetchCuotasPlanPago', error)
  return (data as T[] | null) ?? []
}

/** Cantidad de recibos digitales emitidos en un proyecto (para numerar el siguiente). */
export async function countRecibosByProyecto(projectId: string): Promise<number> {
  const { count } = await db
    .from('recibos_digitales')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
  return count ?? 0
}

/** Bitácora de generación de cuotas de un proyecto (50 más recientes). Degrada a `[]`. */
export async function fetchGeneracionCuotasLogs<T>(projectId: string, companyId: string): Promise<T[]> {
  const { data, error } = await db
    .from('generacion_cuotas_log')
    .select('*')
    .eq('project_id', projectId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(50)
  reportDegradedQuery('condominios.fetchGeneracionCuotasLogs', error)
  return (data as T[] | null) ?? []
}

/** Notas actuales de una cuota de condominio (para anexar en conciliación). */
export async function fetchCuotaCondominioNotas(id: string): Promise<string | null> {
  const { data, error } = await db
    .from('cuotas_condominio')
    .select('notas')
    .eq('id', id)
    .single()
  reportDegradedQuery('condominios.fetchCuotaCondominioNotas', error)
  return (data as { notas?: string | null } | null)?.notas ?? null
}

// ── Paquetería / mudanza (portal residente) ──

/** Solicitudes de mudanza de una unidad (más recientes primero). Degrada a `[]`. */
export async function fetchSolicitudesMudanzaByUnidad<T>(unidadId: string): Promise<T[]> {
  const { data, error } = await db
    .from('solicitud_mudanza_unidad')
    .select('*')
    .eq('unidad_id', unidadId)
    .order('created_at', { ascending: false })
  reportDegradedQuery('condominios.fetchSolicitudesMudanzaByUnidad', error)
  return (data as T[] | null) ?? []
}

/** Términos de mudanza del proyecto (vista del residente, sólo por project_id). */
export async function fetchTerminosMudanzaPorProyecto(projectId: string): Promise<string | null> {
  const { data, error } = await db
    .from('config_condominio')
    .select('terminos_mudanza')
    .eq('project_id', projectId)
    .maybeSingle()
  reportDegradedQuery('condominios.fetchTerminosMudanzaPorProyecto', error)
  return (data as { terminos_mudanza: string | null } | null)?.terminos_mudanza ?? null
}

/** Fila de config del condominio (id + términos de mudanza) o `null` si no existe. */
export async function fetchConfigCondominioTerminos(
  projectId: string,
  companyId: string,
): Promise<{ id: string; terminos_mudanza: string | null } | null> {
  const { data, error } = await db
    .from('config_condominio')
    .select('id, terminos_mudanza')
    .eq('project_id', projectId)
    .eq('company_id', companyId)
    .maybeSingle()
  reportDegradedQuery('condominios.fetchConfigCondominioTerminos', error)
  return (data as { id: string; terminos_mudanza: string | null } | null) ?? null
}

/** Montos de gastos del condominio dentro de un año (para "ejecutado"). */
export async function fetchGastosAnioMontos(
  projectId: string,
  year: number,
): Promise<Array<{ monto: number }>> {
  const { data, error } = await db
    .from('gastos_condominio')
    .select('monto')
    .eq('project_id', projectId)
    .gte('fecha', `${year}-01-01`)
    .lte('fecha', `${year}-12-31`)
  reportDegradedQuery('condominios.fetchGastosAnioMontos', error)
  return (data as Array<{ monto: number }> | null) ?? []
}

// ── HorasExtraTab ──

/**
 * Consolidado de jornada por empleado en un rango (RPC `calcular_horas_personal`,
 * 20260820000300): planificado vs marcado, ordinarias, extra, nocturnas y
 * asueto con su factor. NO se persiste — se recalcula del marcaje vigente, para
 * que corregir una hora de salida mal tecleada corrija también el total.
 *
 * Va en `supabase` (sin tipar) y no en `db`: la RPC es nueva y no existe en
 * database.types.ts hasta la próxima corrida de `npm run gen:db-types`.
 * Degrada a `[]`.
 */
export async function fetchHorasPersonal(
  projectId: string,
  desde: string,
  hasta: string,
): Promise<HorasPersonal[]> {
  const { data, error } = await supabase.rpc('calcular_horas_personal', {
    p_project_id: projectId,
    p_desde: desde,
    p_hasta: hasta,
  })
  reportDegradedQuery('condominios.fetchHorasPersonal', error)
  return (data as HorasPersonal[] | null) ?? []
}

// ── PersonalTab ──

/**
 * Cuentas de ingreso vinculables a un empleado del condominio (RPC
 * `personal_usuarios_asignables`, 20260826000000): nombre, correo, rol, si la
 * cuenta está activa, si tiene acceso a ESTE proyecto y a qué empleado está ya
 * vinculada.
 *
 * Es un RPC y no un select a `app_users`: la policy `app_users_select`
 * (20260417000012) solo deja enumerar la empresa a `company_owner`/`admin`, así
 * que un administrador de condominio con tier `operator` vería la lista vacía.
 *
 * Va en `supabase` (sin tipar) y no en `db`: la RPC es nueva y no existe en
 * database.types.ts hasta la próxima corrida de `npm run gen:db-types`.
 *
 * Devuelve `{ data, error }` (con shape `{ message }`) y NO degrada a `[]`: la
 * RPC exige el permiso del tab, y "no tienes acceso" leído como "no hay usuarios
 * que asignar" mandaría al administrador a crear una cuenta que ya existe.
 */
export async function fetchUsuariosAsignablesPersonal(
  projectId: string,
): Promise<{ data: UsuarioAsignablePersonal[]; error: { message: string } | null }> {
  const { data, error } = await supabase.rpc('personal_usuarios_asignables', {
    p_project_id: projectId,
  })
  reportDegradedQuery('condominios.fetchUsuariosAsignablesPersonal', error)
  return {
    data: (data as UsuarioAsignablePersonal[] | null) ?? [],
    error: error ? { message: error.message } : null,
  }
}

// ── PlantillasCargoTab ──

/**
 * Insumos y herramientas planificados de TODAS las plantillas del proyecto
 * (tablas puente de 20260904000300), con el nombre/unidad/estado del recurso
 * aplanados del embed. Un solo fetch por proyecto: la pantalla de plantillas es
 * la única consumidora en este PR, así que va aquí y no en el loader global de
 * sectionData (que es posicional y no debe crecer por un solo tab).
 *
 * Va en `db` (tipado): las tablas puente y sus relaciones existen en
 * database.types.ts desde la sincronización del PR de catálogos, así que el
 * embed del recurso viene chequeado contra el esquema.
 *
 * Devuelve `{ …, error }` y NO degrada en silencio: "no pude leer la receta"
 * mostrado como "esta actividad no ocupa recursos" invitaría a recapturarla.
 */
export async function fetchRecursosPlantillas(
  projectId: string,
  companyId: string,
): Promise<{
  suministros: PlantillaTareaSuministro[]
  herramientas: PlantillaTareaHerramienta[]
  error: { message: string } | null
}> {
  const [sumRes, herRes] = await Promise.all([
    db
      .from('plantilla_tarea_suministros')
      .select('*, suministros_condominio(nombre, unidad_medida, activo)')
      .eq('project_id', projectId)
      .eq('company_id', companyId),
    db
      .from('plantilla_tarea_herramientas')
      .select('*, inventario_condominio(nombre, estado)')
      .eq('project_id', projectId)
      .eq('company_id', companyId),
  ])
  const error = sumRes.error ?? herRes.error
  reportDegradedQuery('condominios.fetchRecursosPlantillas', error)
  const suministros: PlantillaTareaSuministro[] = (sumRes.data ?? []).map(
    ({ suministros_condominio: s, ...resto }) => ({
      ...resto,
      suministro_nombre: s?.nombre,
      unidad_medida: s?.unidad_medida,
      suministro_activo: s?.activo,
    }),
  )
  const herramientas: PlantillaTareaHerramienta[] = (herRes.data ?? []).map(
    ({ inventario_condominio: h, ...resto }) => ({
      ...resto,
      inventario_nombre: h?.nombre,
      inventario_estado: h?.estado,
    }),
  )
  return { suministros, herramientas, error: error ? { message: error.message } : null }
}

// ── Rutinas de limpieza (20260907000200) ──

/**
 * Rutinas del proyecto con sus pasos. Loader propio del tab y no del cargador
 * monolítico: sólo la vista de Rutinas las necesita, y bajarlas en cada entrada
 * a Condominios sería tráfico que casi nadie usa.
 *
 * El nombre del área y de la jornada vienen por embed en vez de resolverse
 * contra las listas ya cargadas: una rutina puede apuntar a un área desactivada
 * que la UI filtró de su selector, y sin el embed se mostraría en blanco.
 */
export async function fetchRutinasLimpieza(
  projectId: string,
  companyId: string,
): Promise<{
  rutinas: RutinaLimpieza[]
  pasos: RutinaActividad[]
  horarios: Array<{ id: string; nombre: string; hora_inicio: string; hora_fin: string }>
  error: { message: string } | null
}> {
  const [rutRes, pasRes, horRes] = await Promise.all([
    db
      .from('rutinas_limpieza')
      .select('*, areas_condominio(nombre), plantillas_horario(nombre)')
      .eq('project_id', projectId)
      .eq('company_id', companyId)
      .order('orden')
      .order('nombre'),
    db
      .from('rutina_actividades')
      .select('*')
      .eq('project_id', projectId)
      .eq('company_id', companyId)
      .order('orden'),
    // Las jornadas son catálogo de Turnos, pero la rutina elige una: se bajan
    // aquí y no en el cargador monolítico porque sólo esta vista las necesita.
    db
      .from('plantillas_horario')
      .select('id, nombre, hora_inicio, hora_fin')
      .eq('project_id', projectId)
      .eq('company_id', companyId)
      .eq('activo', true)
      .order('hora_inicio'),
  ])
  const error = rutRes.error ?? pasRes.error ?? horRes.error
  reportDegradedQuery('condominios.fetchRutinasLimpieza', error)
  const rutinas: RutinaLimpieza[] = (rutRes.data ?? []).map(
    ({ areas_condominio: a, plantillas_horario: h, ...resto }) => ({
      ...resto,
      area_nombre: a?.nombre,
      horario_nombre: h?.nombre,
    }),
  ) as RutinaLimpieza[]
  return {
    rutinas,
    pasos: (pasRes.data ?? []) as RutinaActividad[],
    horarios: horRes.data ?? [],
    error: error ? { message: error.message } : null,
  }
}
