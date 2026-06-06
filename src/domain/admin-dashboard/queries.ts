// domain/admin-dashboard/queries.ts — Lecturas del dashboard admin. T7/PR3.
// Stats de `conversations` (servicio agua) para el panel: el acceso a datos baja
// aquí; los umbrales de tiempo y la agregación por proyecto (lógica de negocio)
// se quedan en la UI. Lecturas imperativas (no-hook).
import { supabase } from '../../lib/supabase'

/** Conteos de conversaciones para el badge del dashboard. */
export interface ConversationStats {
  sinAsignar: number
  cerradasHoy: number
  criticas: number
  urgentes: number
  enProceso: number
}

/** Parámetros (umbrales ya calculados por la UI) para los conteos por proyecto. */
export interface ConvCountsParams {
  companyId: string
  projectId: string
  /** ISO de hace 24h. */
  hace24h: string
  /** ISO de hace 48h. */
  hace48h: string
  /** Estados considerados "abiertos". */
  abiertos: string[]
}

/**
 * 5 conteos ligeros (count exact, head) para UN proyecto: sin asignar, cerradas
 * hoy, críticas (>48h), urgentes (24–48h) y en proceso (<24h). Replica las mismas
 * condiciones que la agregación en JS de "todos los proyectos".
 */
export async function fetchConvCountsForProject(p: ConvCountsParams): Promise<ConversationStats> {
  const mkBase = () =>
    supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', p.companyId)
      .eq('service_type', 'agua')
      .eq('project_id', p.projectId)
  const [sinAsignarRes, cerradasRes, criticasRes, urgentesRes, enProcesoRes] = await Promise.all([
    mkBase().in('status', p.abiertos).is('assigned_to', null),
    mkBase().eq('status', 'cerrada').gte('closed_at', p.hace24h),
    mkBase().in('status', p.abiertos).lt('created_at', p.hace48h),
    mkBase().in('status', p.abiertos).lt('created_at', p.hace24h).gte('created_at', p.hace48h),
    mkBase().in('status', p.abiertos).gte('created_at', p.hace24h),
  ])
  return {
    sinAsignar: sinAsignarRes.count ?? 0,
    cerradasHoy: cerradasRes.count ?? 0,
    criticas: criticasRes.count ?? 0,
    urgentes: urgentesRes.count ?? 0,
    enProceso: enProcesoRes.count ?? 0,
  }
}

/** Fila ligera de conversación para la agregación por proyecto (todos). */
export interface ConvStatsRow {
  project_id: string | null
  status: string
  assigned_to: string | null
  created_at: string
  closed_at: string | null
}

/**
 * Filas ligeras de conversaciones (servicio agua) de la empresa para computar
 * stats por proyecto en JS (la agregación se queda en la UI).
 */
export async function fetchConvRowsAllProjects(companyId: string): Promise<ConvStatsRow[]> {
  const { data } = await supabase
    .from('conversations')
    .select('project_id, status, assigned_to, created_at, closed_at')
    .eq('company_id', companyId)
    .eq('service_type', 'agua')
  return (data as ConvStatsRow[]) ?? []
}
