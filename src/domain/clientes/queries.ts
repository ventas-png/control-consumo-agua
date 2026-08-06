// domain/clientes/queries.ts — Lecturas del módulo clientes. T7/PR3: el acceso
// directo a Supabase sale de los componentes (ClientesSection, ClienteRentasModal,
// ImportClientesModal) hacia la capa domain. Lecturas imperativas (no-hook).
import { reportDegradedQuery } from '../queryFetch'
import { supabase } from '../../lib/supabase'
import type { Cliente, ClienteLookupResult, ContratoArrendamiento, ReservaSTR } from '../../types'

/** Entrada activo de company_clientes para un cliente (id del link + flag). */
export interface CompanyClienteActivo {
  ccId: string
  activo: boolean
}

/**
 * Mapa clienteId → tiene cuenta de portal (app_users.cliente_id presente).
 * RLS acota el tenant; devolvemos solo los que matchean los ids dados.
 */
export async function fetchClienteAccountMap(clienteIds: string[]): Promise<Record<string, boolean>> {
  const { data, error } = await supabase
    .from('app_users')
    .select('cliente_id')
    .in('cliente_id', clienteIds)
  reportDegradedQuery('clientes.fetchClienteAccountMap', error)
  const map: Record<string, boolean> = {}
  data?.forEach((u: { cliente_id: string | null }) => {
    if (u.cliente_id) map[u.cliente_id] = true
  })
  return map
}

/**
 * Mapa clienteId → { ccId, activo } desde company_clientes para la empresa dada.
 * `activo` ausente se interpreta como `true`.
 */
export async function fetchCompanyClientesActivoMap(
  companyId: string,
  clienteIds: string[],
): Promise<Record<string, CompanyClienteActivo>> {
  const { data, error } = await supabase
    .from('company_clientes')
    .select('id, cliente_id, activo')
    .eq('company_id', companyId)
    .in('cliente_id', clienteIds)
  reportDegradedQuery('clientes.fetchCompanyClientesActivoMap', error)
  const map: Record<string, CompanyClienteActivo> = {}
  data?.forEach((row: { id: string; cliente_id: string; activo: boolean | null }) => {
    map[row.cliente_id] = { ccId: row.id, activo: row.activo ?? true }
  })
  return map
}

/** Parámetros del onboarding por triple-match (CUI/DUI + fecha nac + email). */
export interface BuscarClienteParams {
  cuiDui: string
  fechaNac: string
  email: string
}

/**
 * Busca un cliente para onboarding vía la RPC `buscar_cliente_para_onboarding`
 * (match_count 0..3 + campos discordantes). Devuelve el contrato `{ data, error }`.
 */
export async function buscarClienteParaOnboarding(
  params: BuscarClienteParams,
): Promise<{ data: ClienteLookupResult | null; error: string | null }> {
  const { data, error } = await supabase.rpc('buscar_cliente_para_onboarding', {
    p_cui_dui: params.cuiDui,
    p_fecha_nac: params.fechaNac,
    p_email: params.email,
  })
  return { data: (data as ClienteLookupResult) ?? null, error: error?.message ?? null }
}

/** Trae el registro completo de un cliente por id (o `null`). */
export async function fetchClienteById(id: string): Promise<Cliente | null> {
  const { data, error } = await supabase.from('clientes').select('*').eq('id', id).single()
  reportDegradedQuery('clientes.fetchClienteById', error)
  return (data as Cliente) ?? null
}

/**
 * Trae TODOS los clientes (campos mínimos id/codigo/cui_dui) para detección de
 * duplicados global en el import. Devuelve `{ data, error }`.
 */
export async function fetchClientesForDedup(): Promise<{ data: Cliente[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('clientes')
    .select('id, codigo, cui_dui')
    .order('codigo')
  return { data: (data as Cliente[]) ?? null, error: error?.message ?? null }
}

/** Contratos de arrendamiento de un conjunto de unidades (recientes primero). */
export async function fetchContratosByUnidades(unidadIds: string[]): Promise<ContratoArrendamiento[]> {
  const { data, error } = await supabase
    .from('contratos_arrendamiento')
    .select('*')
    .in('unidad_id', unidadIds)
    .order('created_at', { ascending: false })
  reportDegradedQuery('clientes.fetchContratosByUnidades', error)
  return (data as ContratoArrendamiento[]) ?? []
}

/** Reservas STR de un conjunto de unidades (por fecha de entrada, recientes primero). */
export async function fetchReservasByUnidades(unidadIds: string[]): Promise<ReservaSTR[]> {
  const { data, error } = await supabase
    .from('reservas_str')
    .select('*')
    .in('unidad_id', unidadIds)
    .order('fecha_entrada', { ascending: false })
  reportDegradedQuery('clientes.fetchReservasByUnidades', error)
  return (data as ReservaSTR[]) ?? []
}
