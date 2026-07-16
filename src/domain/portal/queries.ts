// domain/portal/queries.ts — Lecturas del portal del cliente (agua + condominios).
// T7/PR3: el acceso directo a Supabase de CustomerPortal / CustomerPaymentsTab /
// CondominiosClientPortal baja aquí. La UI mantiene el parseo/merge y la lógica de
// presentación; estas funciones solo bajan el acceso a datos (proyecciones
// específicas del portal, acotadas por RLS al propio cliente). Lecturas
// imperativas (no-hook). Devuelven `data` cruda (nullable) para que la UI castee
// como ya lo hace.
//
// P2 tipos: migrado al cliente TIPADO `db` — tablas, columnas, filtros y embeds
// se chequean en compile-time contra el esquema generado. Los shapes públicos
// (`unknown`/interfaces propias) se mantienen: son la frontera que la UI ya castea.
import { db } from '../../lib/supabase'

// ── CustomerPortal (agua) ──────────────────────────────────────────────────

/** Datasets del bootstrap del portal de agua (empresas, unidades, lecturas, contacto). */
export interface PortalBootstrap {
  ccData: unknown[] | null
  uData: unknown[] | null
  rData: unknown[] | null
  clData: unknown | null
}

/**
 * Carga inicial del portal de agua para un cliente: empresas vinculadas (con flag
 * activo), unidades activas, historial de lecturas y datos de contacto propios.
 */
export async function fetchPortalBootstrap(clienteId: string): Promise<PortalBootstrap> {
  const [ccRes, uRes, rRes, clRes] = await Promise.all([
    db
      .from('company_clientes')
      .select('company_id, activo, companies(id, nombre)')
      .eq('cliente_id', clienteId),
    db
      .from('unidades')
      .select('id, nombre, tipo, piso, area_m2, project_id, company_id, activo')
      .eq('cliente_id', clienteId)
      .eq('activo', true),
    db
      .from('registros')
      .select('id, cliente_id, cliente_nombre, contador_id, project_id, fecha, lectura_anterior, lectura_actual, consumo, tarifa_aplicada, tarifa_exceso_aplicada, canon_aplicado, monto_calculado, tipo_cobro, estado, monto_pagado, fecha_pago, mes, fecha_lectura_anterior, dias_servicio, notas')
      .eq('cliente_id', clienteId)
      .order('fecha', { ascending: false }),
    db
      .from('clientes')
      .select('email, telefono, whatsapp, telefono_alterno')
      .eq('id', clienteId)
      .single(),
  ])
  return { ccData: ccRes.data, uData: uRes.data, rData: rRes.data, clData: clRes.data }
}

/** Contadores activos de un conjunto de unidades (para el portal de agua). */
export async function fetchPortalContadores(unidadIds: string[]): Promise<unknown[] | null> {
  const { data } = await db
    .from('contadores')
    .select('id, numero_serie, tipo_agua, descripcion, activo, unidad_id, project_id, company_id')
    .in('unidad_id', unidadIds)
    .eq('activo', true)
  return data
}

/** Proyectos activos de un conjunto de empresas (para el portal de agua). */
export async function fetchPortalProjectsByCompanies(companyIds: string[]): Promise<unknown[] | null> {
  const { data } = await db
    .from('projects')
    .select('id, nombre, company_id, moneda')
    .in('company_id', companyIds)
    .eq('estado', 'activo')
  return data
}

// NUNCA incluir `foto` en estos listados: es un data-URI base64 de hasta ~15 MB
// por fila (TOAST). Traerlo para TODAS las lecturas del cliente infla el payload a
// cientos de MB y vuelve lento el portal (mismo motivo que REGISTROS_LIST_COLS en
// domain/agua). Las fotos se bajan una a una bajo demanda con fetchRegistroFoto.
const REGISTROS_SELECT =
  'id, cliente_id, cliente_nombre, contador_id, fecha, lectura_anterior, lectura_actual, consumo, tarifa_aplicada, tarifa_exceso_aplicada, canon_aplicado, monto_calculado, tipo_cobro, estado, monto_pagado, fecha_pago, mes, fecha_lectura_anterior, dias_servicio, notas'

/** Fallback de lecturas por contador (cuando cliente_id es incorrecto/null). */
export async function fetchRegistrosByContadores(contadorIds: string[]): Promise<unknown[] | null> {
  const { data } = await db
    .from('registros')
    .select(REGISTROS_SELECT)
    .in('contador_id', contadorIds)
    .order('fecha', { ascending: false })
  return data
}

/** Fallback de lecturas por proyecto (cuando contador_id también es null; RLS acota). */
export async function fetchRegistrosByProjects(projectIds: string[]): Promise<unknown[] | null> {
  const { data } = await db
    .from('registros')
    .select(REGISTROS_SELECT)
    .in('project_id', projectIds)
    .order('fecha', { ascending: false })
  return data
}

/**
 * IDs de los registros del cliente que SÍ tienen foto. Se consulta aparte y se
 * proyecta solo `id` (jamás `foto`) para no bajar el base64: el portal usa este
 * set para saber qué lecturas tienen foto y bajar los bytes uno a uno bajo
 * demanda (fetchRegistroFoto). Espeja el scoping de las lecturas (cliente/
 * contador/proyecto) para cubrir los mismos fallbacks; RLS acota a lo propio.
 */
export async function fetchPortalFotoIds(
  clienteId: string,
  contadorIds: string[],
  projectIds: string[],
): Promise<string[]> {
  // Tipo explícito y ancho: cada builder encadena filtros distintos y dejar
  // que TS lo infiera del primer elemento dispara "type instantiation is
  // excessively deep" con los genéricos de supabase-js ≥2.110 (más aún con el
  // cliente tipado). Cada builder `db.from(...)` se chequea igual contra el
  // esquema ANTES del widening — solo se ensancha el tipo del array.
  const queries: PromiseLike<{ data: unknown }>[] = [
    db.from('registros').select('id').eq('cliente_id', clienteId).not('foto', 'is', null),
  ]
  if (contadorIds.length > 0) {
    queries.push(db.from('registros').select('id').in('contador_id', contadorIds).not('foto', 'is', null))
  }
  if (projectIds.length > 0) {
    queries.push(db.from('registros').select('id').in('project_id', projectIds).not('foto', 'is', null))
  }
  const results = await Promise.all(queries)
  const ids = new Set<string>()
  for (const res of results) {
    for (const row of ((res.data as { id: string }[] | null) ?? [])) ids.add(row.id)
  }
  return [...ids]
}

/**
 * Baja el `foto` de UN registro bajo demanda (data-URI base64 o, en lecturas
 * nuevas, un path de Storage). Solo se llama para las fotos que se van a mostrar
 * (miniaturas visibles y el lightbox), nunca para el listado completo.
 */
export async function fetchRegistroFoto(registroId: string): Promise<string | null> {
  const { data } = await db
    .from('registros')
    .select('foto')
    .eq('id', registroId)
    .maybeSingle()
  // El select tipado ya devuelve { foto: string | null } — sin cast.
  return data?.foto ?? null
}

// ── CustomerPaymentsTab ────────────────────────────────────────────────────

/** Flags de configuración de pago del tenant (Stripe/PayPal + payfac) para el portal. */
export interface PortalPaymentConfigRow {
  stripe_configured: boolean | null
  stripe_activo: boolean | null
  paypal_configured: boolean | null
  paypal_activo: boolean | null
  /** Payfac efectivo de la empresa (cobros pluggable): 'sandbox'|'qpaypro'|… */
  proveedor_pago: string | null
  /** Flag EXPLÍCITO de demo (auditoría C1): sin él, 'sandbox' (el default de
   *  toda empresa) no ofrece pago en línea — aprobaría cobros simulados. */
  pago_sandbox_demo: boolean | null
}

/** Lee los flags de pago de la empresa (Stripe/PayPal + payfac) para el portal del cliente. */
export async function fetchPortalPaymentConfig(companyId: string): Promise<PortalPaymentConfigRow | null> {
  const { data } = await db
    .from('companies')
    .select('stripe_configured,stripe_activo,paypal_configured,paypal_activo,proveedor_pago,pago_sandbox_demo')
    .eq('id', companyId)
    .single()
  // La fila tipada es asignable a la interfaz (proveedor_pago NOT NULL ⊂ string|null) — sin cast.
  return data ?? null
}

// El inicio de cobro en línea del portal vive en domain/portal/mutations.ts
// (iniciarPagoRegistro / iniciarPagoCuota) con conciliación server-side vía
// confirm-charge. `iniciarCobroPayfac` quedó obsoleto y se removió (F2).

/** Unidades activas de un cliente (batch 1 del portal de condominios). */
export async function fetchPortalUnidadesByCliente(clienteId: string): Promise<unknown[] | null> {
  const { data } = await db
    .from('unidades')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('activo', true)
  return data
}

// ── CondominiosClientPortal ────────────────────────────────────────────────

/** Datasets del portal de condominios (cruda; la UI parsea cada uno). */
export interface CondominiosPortalData {
  projData: unknown[] | null
  amenidadesData: unknown[] | null
  cuotasData: unknown[] | null
  reservasData: unknown[] | null
  bloqueosData: unknown[] | null
  ticketsData: unknown[] | null
  anunciosData: unknown[] | null
  visitantesData: unknown[] | null
  mensajesData: unknown[] | null
  solicitudesRentaData: unknown[] | null
  paquetesData: unknown[] | null
}

/**
 * Carga TODO el portal de condominios de un residente en paralelo (proyecto +
 * amenidades, cuotas, reservas, bloqueos, tickets, anuncios, visitantes, mensajes,
 * solicitudes de renta y paquetes). Las ventanas de tiempo (caps de 60/90/730 días)
 * son del portal (actividad reciente); el admin tiene su propio loader completo.
 */
export async function fetchCondominiosPortalData(
  projectIds: string[],
  unidadIds: string[],
): Promise<CondominiosPortalData> {
  const today = new Date().toISOString().slice(0, 10)
  const sesentaDias = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
  const noventaDias = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const haceDosAnos = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [
    projRes, amenidadesRes, cuotasRes, reservasRes, bloqueosRes, ticketsRes,
    anunciosRes, visitantesRes, mensajesRes, solicitudesRentaRes, paquetesRes,
  ] = await Promise.all([
    db.from('projects').select('id, company_id, moneda_condominios, moneda').in('id', projectIds),
    db.from('amenidades').select('*').in('project_id', projectIds).eq('activo', true),
    db.from('cuotas_condominio').select('*').in('unidad_id', unidadIds)
      .is('deleted_at', null)
      .gte('fecha_vencimiento', haceDosAnos)
      .order('fecha_vencimiento', { ascending: false })
      .limit(500),
    db.from('reservas_amenidades').select('*').in('unidad_id', unidadIds).gte('fecha', today).order('fecha'),
    db.from('amenidades_bloqueos').select('*').in('project_id', projectIds),
    db.from('tickets_mantenimiento').select('*').in('unidad_id', unidadIds)
      .is('deleted_at', null)
      .gte('created_at', noventaDias)
      .order('created_at', { ascending: false })
      .limit(200),
    db.from('anuncios_comunidad').select('*').in('project_id', projectIds).eq('activo', true).order('created_at', { ascending: false }),
    db.from('visitantes').select('*').in('unidad_id', unidadIds).order('hora_entrada', { ascending: false }).limit(200),
    db.from('mensajes_portal').select('*').in('unidad_id', unidadIds)
      .gte('created_at', sesentaDias)
      .order('created_at', { ascending: false })
      .limit(100),
    db.from('solicitud_renta_unidad').select('*').in('unidad_id', unidadIds).order('created_at', { ascending: false }).limit(50),
    db.from('paquetes_recibidos').select('*, unidades(nombre)').in('unidad_id', unidadIds).order('hora_recepcion', { ascending: false }).limit(100),
  ])

  return {
    projData: projRes.data,
    amenidadesData: amenidadesRes.data,
    cuotasData: cuotasRes.data,
    reservasData: reservasRes.data,
    bloqueosData: bloqueosRes.data,
    ticketsData: ticketsRes.data,
    anunciosData: anunciosRes.data,
    visitantesData: visitantesRes.data,
    mensajesData: mensajesRes.data,
    solicitudesRentaData: solicitudesRentaRes.data,
    paquetesData: paquetesRes.data,
  }
}
