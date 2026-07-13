// domain/unidades/residentes.ts — Residentes de una unidad (portal propietario/
// inquilino · fase 3). CRUD de `unidad_residentes`: una unidad puede tener varios
// residentes con rol (propietario/arrendatario/…). Los helpers RLS
// (mis_unidades_ids / mis_proyectos_ids) ya unen esta tabla, así que asignar un
// residente le habilita el acceso al portal de esa unidad. Solo staff del tenant
// escribe (RLS). El acceso directo a supabase vive en la capa domain (boundary T7).
import { supabase } from '../../lib/supabase'
import type { UnidadResidente } from '../../types'

export interface ResidenteConCliente extends UnidadResidente {
  cliente_nombre?: string | null
  cliente_codigo?: string | null
}

/** Residentes de una unidad, con nombre/código del cliente (join). */
export async function fetchResidentesDeUnidad(
  unidadId: string,
): Promise<{ data: ResidenteConCliente[]; error: string | null }> {
  const { data, error } = await supabase
    .from('unidad_residentes')
    .select('id, unidad_id, cliente_id, company_id, project_id, tipo, activo, created_at, updated_at, clientes(nombre, codigo)')
    .eq('unidad_id', unidadId)
    .order('created_at', { ascending: true })
  const rows = ((data as Record<string, unknown>[] | null) ?? []).map((r) => {
    const cli = r.clientes as { nombre?: string; codigo?: string } | null
    return { ...(r as unknown as UnidadResidente), cliente_nombre: cli?.nombre ?? null, cliente_codigo: cli?.codigo ?? null }
  })
  return { data: rows, error: error?.message ?? null }
}

/** Asigna un residente a una unidad (payload ya armado por la UI). */
export async function addResidente(payload: Record<string, unknown>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('unidad_residentes').insert(payload)
  return { error: error?.message ?? null }
}

/** Quita un residente por id. */
export async function removeResidente(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('unidad_residentes').delete().eq('id', id)
  return { error: error?.message ?? null }
}
