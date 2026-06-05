// domain/unidades/queries.ts — Lecturas de apoyo del módulo unidades. T7/PR3.
import { supabase } from '../../lib/supabase'

/**
 * Resuelve proyecto/empresa para crear/importar unidades: usa `formProjectId` si
 * viene; si no, `app_users` → (fallback) `user_project_assignments` → (fallback)
 * primer `projects` de la empresa. companyId: `app_users` → fallback dado.
 * (El import pasa `formProjectId = null`.)
 */
export async function resolveUnidadProjectCompany(
  userId: string,
  formProjectId: string | null,
  fallbackCompanyId: string | null,
): Promise<{ projectId: string | null; companyId: string | null }> {
  const { data: userData } = await supabase
    .from('app_users')
    .select('project_id, company_id')
    .eq('id', userId)
    .single()
  let projectId: string | null =
    formProjectId || (userData as { project_id?: string } | null)?.project_id || null
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

/** Límite de unidades de la empresa + total actual (para el gate de plan). */
export async function checkUnidadesLimit(
  companyId: string,
): Promise<{ maxUnits: number; total: number }> {
  const [{ data: empresaData }, { count }] = await Promise.all([
    supabase.from('companies').select('max_units').eq('id', companyId).single(),
    supabase.from('unidades').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
  ])
  const maxUnits = (empresaData as { max_units?: number } | null)?.max_units ?? 50
  return { maxUnits, total: count ?? 0 }
}
