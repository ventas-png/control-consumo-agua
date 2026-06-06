// domain/clientes/mutations.ts — Escrituras del módulo clientes. T7/PR3.
// El armado del payload y la validación de UX se quedan en la UI; aquí baja solo
// el acceso a datos. Contrato uniforme `{ error: string | null }` (salvo donde se
// necesita la fila o un flag extra). La pre-validación Zod del INSERT de `clientes`
// sigue en la UI vía `validatedInsert(Many)` (no es acceso supabase directo).
import { supabase } from '../../lib/supabase'
import type { Cliente } from '../../types'

/** Fila de vínculo empresa↔cliente. */
export interface CompanyClienteLink {
  company_id: string
  cliente_id: string
  added_by: string
}

/** Actualiza un cliente por id (payload ya armado por la UI). Devuelve la fila. */
export async function updateCliente(
  id: string,
  payload: Record<string, unknown>,
): Promise<{ data: Cliente | null; error: string | null }> {
  const { data, error } = await supabase
    .from('clientes')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  return { data: (data as Cliente) ?? null, error: error?.message ?? null }
}

/**
 * Vincula UN cliente a una empresa. Si ya estaba vinculado (unique violation
 * 23505) devuelve `alreadyLinked: true` (estado conocido, no error). El resto de
 * errores vienen en `error`.
 */
export async function linkClienteToCompany(
  companyId: string,
  clienteId: string,
  addedBy: string,
): Promise<{ error: string | null; alreadyLinked: boolean }> {
  const { error } = await supabase
    .from('company_clientes')
    .insert({ company_id: companyId, cliente_id: clienteId, added_by: addedBy })
  if (error) {
    if (error.code === '23505') return { error: null, alreadyLinked: true }
    return { error: error.message ?? null, alreadyLinked: false }
  }
  return { error: null, alreadyLinked: false }
}

/** Inserta vínculos empresa↔cliente en lote (import de clientes nuevos). */
export async function addCompanyClientesLinks(
  rows: CompanyClienteLink[],
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('company_clientes').insert(rows)
  return { error: error?.message ?? null }
}

/**
 * Upsert de vínculos empresa↔cliente ignorando duplicados (vincular clientes que
 * ya existían globalmente, sin reventar por el unique de company_id+cliente_id).
 */
export async function upsertCompanyClientesLinks(
  rows: CompanyClienteLink[],
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('company_clientes')
    .upsert(rows, { onConflict: 'company_id,cliente_id', ignoreDuplicates: true })
  return { error: error?.message ?? null }
}

/** Activa/desactiva la visibilidad de un cliente para la empresa (company_clientes.activo). */
export async function setCompanyClienteActivo(
  ccId: string,
  activo: boolean,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('company_clientes').update({ activo }).eq('id', ccId)
  return { error: error?.message ?? null }
}

/** Quita el vínculo de un cliente con la empresa (no borra el cliente global). */
export async function unlinkClienteFromCompany(
  clienteId: string,
  companyId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('company_clientes')
    .delete()
    .eq('cliente_id', clienteId)
    .eq('company_id', companyId)
  return { error: error?.message ?? null }
}

// ── Rentas del cliente: contratos de arrendamiento y reservas STR ──────────

/** Crea un contrato de arrendamiento (payload ya armado por la UI). */
export async function createContrato(payload: Record<string, unknown>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('contratos_arrendamiento').insert(payload)
  return { error: error?.message ?? null }
}

/** Actualiza un contrato de arrendamiento por id. */
export async function updateContrato(
  id: string,
  payload: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('contratos_arrendamiento').update(payload).eq('id', id)
  return { error: error?.message ?? null }
}

/** Elimina un contrato de arrendamiento por id. */
export async function deleteContrato(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('contratos_arrendamiento').delete().eq('id', id)
  return { error: error?.message ?? null }
}

/** Crea una reserva STR (payload ya armado por la UI). */
export async function createReserva(payload: Record<string, unknown>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('reservas_str').insert(payload)
  return { error: error?.message ?? null }
}

/** Actualiza una reserva STR por id. */
export async function updateReserva(
  id: string,
  payload: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('reservas_str').update(payload).eq('id', id)
  return { error: error?.message ?? null }
}

/** Elimina una reserva STR por id. */
export async function deleteReserva(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('reservas_str').delete().eq('id', id)
  return { error: error?.message ?? null }
}
