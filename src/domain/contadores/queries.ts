// domain/contadores/queries.ts — Lecturas de apoyo para el módulo contadores
// (import). T7/PR3: sacar el acceso directo a Supabase de los componentes.
import { supabase } from '../../lib/supabase'

/** Unidad mínima para resolver nombre→id al importar contadores. */
export interface UnidadLite {
  id: string
  nombre: string
  project_id: string
  company_id: string
}

/** Unidades de una empresa (para el matcher de import por nombre). */
export async function fetchUnidadesByCompany(companyId: string): Promise<UnidadLite[]> {
  const { data } = await supabase
    .from('unidades')
    .select('id, nombre, project_id, company_id')
    .eq('company_id', companyId)
  return (data ?? []) as UnidadLite[]
}

/**
 * Resuelve el proyecto/empresa por defecto de un usuario (para el import):
 * `app_users` → (fallback) `user_project_assignments` → (fallback) primer
 * `projects` de la empresa. Devuelve nulls si no se puede determinar.
 */
export async function resolveDefaultProjectCompany(
  userId: string,
  fallbackCompanyId: string | null,
): Promise<{ projectId: string | null; companyId: string | null }> {
  const { data: userData } = await supabase
    .from('app_users')
    .select('project_id, company_id')
    .eq('id', userId)
    .single()
  let projectId: string | null = (userData as { project_id?: string } | null)?.project_id ?? null
  const companyId: string | null =
    (userData as { company_id?: string } | null)?.company_id ?? fallbackCompanyId ?? null

  if (!projectId) {
    const { data: assignment } = await supabase
      .from('user_project_assignments')
      .select('project_id')
      .eq('user_id', userId)
      .limit(1)
      .single()
    if (assignment) projectId = (assignment as { project_id: string }).project_id
  }
  if (!projectId && companyId) {
    const { data: proj } = await supabase
      .from('projects')
      .select('id')
      .eq('company_id', companyId)
      .limit(1)
      .single()
    if (proj) projectId = (proj as { id: string }).id
  }
  return { projectId, companyId }
}
