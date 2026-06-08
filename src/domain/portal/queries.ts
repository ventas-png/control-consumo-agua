// domain/portal/queries.ts — Lecturas del portal del cliente (agua + condominios).
// T7/PR3: el acceso directo a Supabase de CustomerPortal / CustomerPaymentsTab /
// CondominiosClientPortal baja aquí. La UI mantiene el parseo/merge y la lógica de
// presentación; estas funciones solo bajan el acceso a datos (proyecciones
// específicas del portal, acotadas por RLS al propio cliente). Lecturas
// imperativas (no-hook). Devuelven `data` cruda (nullable) para que la UI castee
// como ya lo hace.
import { supabase } from '../../lib/supabase'

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
    supabase
      .from('company_clientes')
      .select('company_id, activo, companies(id, nombre)')
      .eq('cliente_id', clienteId),
    supabase
      .from('unidades')
      .select('id, nombre, tipo, piso, area_m2, project_id, company_id, activo')
      .eq('cliente_id', clienteId)
      .eq('activo', true),
    supabase
      .from('registros')
      .select('id, cliente_id, cliente_nombre, contador_id, project_id, fecha, lectura_anterior, lectura_actual, consumo, tarifa_aplicada, tarifa_exceso_aplicada, canon_aplicado, monto_calculado, tipo_cobro, estado, monto_pagado, fecha_pago, mes, fecha_lectura_anterior, dias_servicio, notas, foto')
      .eq('cliente_id', clienteId)
      .order('fecha', { ascending: false }),
    supabase
      .from('clientes')
      .select('email, telefono, whatsapp, telefono_alterno')
      .eq('id', clienteId)
      .single(),
  ])
  return { ccData: ccRes.data, uData: uRes.data, rData: rRes.data, clData: clRes.data }
}

/** Contadores activos de un conjunto de unidades (para el portal de agua). */
export async function fetchPortalContadores(unidadIds: string[]): Promise<unknown[] | null> {
  const { data } = await supabase
    .from('contadores')
    .select('id, numero_serie, tipo_agua, descripcion, activo, unidad_id, project_id, company_id')
    .in('unidad_id', unidadIds)
    .eq('activo', true)
  return data
}

/** Proyectos activos de un conjunto de empresas (para el portal de agua). */
export async function fetchPortalProjectsByCompanies(companyIds: string[]): Promise<unknown[] | null> {
  const { data } = await supabase
    .from('projects')
    .select('id, nombre, company_id, moneda')
    .in('company_id', companyIds)
    .eq('estado', 'activo')
  return data
}

const REGISTROS_SELECT =
  'id, cliente_id, cliente_nombre, contador_id, fecha, lectura_anterior, lectura_actual, consumo, tarifa_aplicada, tarifa_exceso_aplicada, canon_aplicado, monto_calculado, tipo_cobro, estado, monto_pagado, fecha_pago, mes, fecha_lectura_anterior, dias_servicio, notas, foto'

/** Fallback de lecturas por contador (cuando cliente_id es incorrecto/null). */
export async function fetchRegistrosByContadores(contadorIds: string[]): Promise<unknown[] | null> {
  const { data } = await supabase
    .from('registros')
    .select(REGISTROS_SELECT)
    .in('contador_id', contadorIds)
    .order('fecha', { ascending: false })
  return data
}

/** Fallback de lecturas por proyecto (cuando contador_id también es null; RLS acota). */
export async function fetchRegistrosByProjects(projectIds: string[]): Promise<unknown[] | null> {
  const { data } = await supabase
    .from('registros')
    .select(REGISTROS_SELECT)
    .in('project_id', projectIds)
    .order('fecha', { ascending: false })
  return data
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
}

/** Lee los flags de pago de la empresa (Stripe/PayPal + payfac) para el portal del cliente. */
export async function fetchPortalPaymentConfig(companyId: string): Promise<PortalPaymentConfigRow | null> {
  const { data } = await supabase
    .from('companies')
    .select('stripe_configured,stripe_activo,paypal_configured,paypal_activo,proveedor_pago')
    .eq('id', companyId)
    .single()
  return (data as PortalPaymentConfigRow) ?? null
}

/** Respuesta del edge `create-charge` (cobro con el payfac efectivo del tenant). */
export interface CrearCobroResult {
  ok?: boolean
  estado?: string
  proveedor?: string | null
  referencia?: string | null
  /** Checkout hospedado (QPayPro): URL a la que redirigir al cliente para pagar. */
  redirectUrl?: string | null
  clientSecret?: string | null
  payment_request_id?: string | null
  error?: string | null
}

export interface IniciarCobroVars {
  clienteId: string
  registroId: string
  companyId: string
  projectId?: string | null
  /** Monto a cobrar (saldo pendiente del registro). > 0. */
  monto: number
  /** Ambiente del payfac. Default 'prod' (cobro real desde el portal). */
  ambiente?: 'prod' | 'sandbox'
}

/**
 * Inicia un cobro con el payfac EFECTIVO del tenant vía el edge `create-charge`.
 * Devuelve el resultado normalizado; para checkout hospedado (QPayPro) trae
 * `redirectUrl` a donde mandar al cliente. NO maneja datos de tarjeta.
 */
export async function iniciarCobroPayfac(vars: IniciarCobroVars): Promise<CrearCobroResult> {
  const { data, error } = await supabase.functions.invoke<CrearCobroResult>('create-charge', {
    body: {
      cliente_id: vars.clienteId,
      registro_id: vars.registroId,
      company_id: vars.companyId,
      project_id: vars.projectId ?? null,
      monto: vars.monto,
      ambiente: vars.ambiente ?? 'prod',
    },
  })
  if (error) throw new Error(error.message)
  if (data && data.ok === false && !data.redirectUrl) {
    throw new Error(data.error ?? 'No se pudo iniciar el cobro.')
  }
  return data ?? {}
}

/** Unidades activas de un cliente (batch 1 del portal de condominios). */
export async function fetchPortalUnidadesByCliente(clienteId: string): Promise<unknown[] | null> {
  const { data } = await supabase
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
    supabase.from('projects').select('id, company_id, moneda_condominios, moneda').in('id', projectIds),
    supabase.from('amenidades').select('*').in('project_id', projectIds).eq('activo', true),
    supabase.from('cuotas_condominio').select('*').in('unidad_id', unidadIds)
      .is('deleted_at', null)
      .gte('fecha_vencimiento', haceDosAnos)
      .order('fecha_vencimiento', { ascending: false })
      .limit(500),
    supabase.from('reservas_amenidades').select('*').in('unidad_id', unidadIds).gte('fecha', today).order('fecha'),
    supabase.from('amenidades_bloqueos').select('*').in('project_id', projectIds),
    supabase.from('tickets_mantenimiento').select('*').in('unidad_id', unidadIds)
      .is('deleted_at', null)
      .gte('created_at', noventaDias)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('anuncios_comunidad').select('*').in('project_id', projectIds).eq('activo', true).order('created_at', { ascending: false }),
    supabase.from('visitantes').select('*').in('unidad_id', unidadIds).order('hora_entrada', { ascending: false }).limit(200),
    supabase.from('mensajes_portal').select('*').in('unidad_id', unidadIds)
      .gte('created_at', sesentaDias)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('solicitud_renta_unidad').select('*').in('unidad_id', unidadIds).order('created_at', { ascending: false }).limit(50),
    supabase.from('paquetes_recibidos').select('*, unidades(nombre)').in('unidad_id', unidadIds).order('hora_recepcion', { ascending: false }).limit(100),
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
