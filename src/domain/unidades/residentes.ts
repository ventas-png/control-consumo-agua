// domain/unidades/residentes.ts — Residentes de una unidad (portal propietario/
// inquilino · fase 3). CRUD de `unidad_residentes`: una unidad puede tener varios
// residentes con rol (propietario/arrendatario/…). Los helpers RLS
// (mis_unidades_ids / mis_unidad_roles) ya unen esta tabla, así que asignar un
// residente le habilita el acceso al portal de esa unidad. Solo staff del tenant
// escribe (RLS). El acceso directo a supabase vive en la capa domain (boundary T7).
//
// PRIMER MÓDULO MIGRADO al cliente TIPADO `db` (P2 tipos · adopción incremental):
// tabla, columnas, embed `clientes(...)` y el payload del insert se chequean en
// compile-time contra el esquema generado — sin casts a Record<string, unknown>.
import { db } from '../../lib/supabase'
import type { UnidadResidente, TipoResidente } from '../../types'
import type { TablesInsert } from '../../types/database.types'

export interface ResidenteConCliente extends UnidadResidente {
  cliente_nombre?: string | null
  cliente_codigo?: string | null
}

/** Residentes de una unidad, con nombre/código del cliente (join). */
export async function fetchResidentesDeUnidad(
  unidadId: string,
): Promise<{ data: ResidenteConCliente[]; error: string | null }> {
  const { data, error } = await db
    .from('unidad_residentes')
    .select('id, unidad_id, cliente_id, company_id, project_id, tipo, activo, created_at, updated_at, clientes(nombre, codigo)')
    .eq('unidad_id', unidadId)
    .order('created_at', { ascending: true })
  const rows: ResidenteConCliente[] = (data ?? []).map(({ clientes, ...r }) => ({
    ...r,
    // La columna generada es `string`; el dominio la acota al CHECK de la tabla.
    tipo: r.tipo as TipoResidente,
    cliente_nombre: clientes?.nombre ?? null,
    cliente_codigo: clientes?.codigo ?? null,
  }))
  return { data: rows, error: error?.message ?? null }
}

/** Asigna un residente a una unidad (payload chequeado contra el esquema). */
export async function addResidente(
  payload: TablesInsert<'unidad_residentes'>,
): Promise<{ error: string | null }> {
  const { error } = await db.from('unidad_residentes').insert(payload)
  return { error: error?.message ?? null }
}

/** Quita un residente por id. */
export async function removeResidente(id: string): Promise<{ error: string | null }> {
  const { error } = await db.from('unidad_residentes').delete().eq('id', id)
  return { error: error?.message ?? null }
}
