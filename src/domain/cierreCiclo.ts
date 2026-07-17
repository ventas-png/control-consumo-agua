// domain/cierreCiclo.ts — Configuración del cierre de ciclo automático (F3).
//
// Lecturas/escrituras planas sobre `cierre_ciclo_config`: cada proyecto+módulo
// puede programar "cerrar el ciclo del mes anterior a partir del día D" (el
// dispatcher pg_cron run_cierres_ciclo_automaticos hace el trabajo server-side;
// migración 20260717140000). Funciones imperativas que degradan a null (los
// diálogos de CobrosSection/CuotasTab manejan su propio flujo) — mismo patrón
// que domain/facturacion/billing.ts. La RLS limita lectura al tenant y
// escritura a quien puede cerrar el ciclo manualmente (permiso del módulo).
import { db } from '../lib/supabase'

export type ModuloCierre = 'agua' | 'condominios'

/** Config del cierre automático de un proyecto+módulo (fila de cierre_ciclo_config). */
export interface CierreCicloConfig {
  activo: boolean
  dia_cierre: number
  notificar: boolean
  ultimo_periodo_cerrado: string | null
  /** Resultado jsonb del último run del cron (emitidas/avisos… o {error}). */
  ultimo_resultado: Record<string, unknown> | null
  ultimo_run_at: string | null
}

/** Config vigente del proyecto+módulo, o null si aún no se programó. */
export async function fetchCierreCicloConfig(
  projectId: string,
  modulo: ModuloCierre,
): Promise<CierreCicloConfig | null> {
  const { data } = await db
    .from('cierre_ciclo_config')
    .select('activo, dia_cierre, notificar, ultimo_periodo_cerrado, ultimo_resultado, ultimo_run_at')
    .eq('project_id', projectId)
    .eq('modulo', modulo)
    .maybeSingle()
  // ultimo_resultado es Json en el esquema; el shape concreto lo fija el cron.
  return (data as CierreCicloConfig | null) ?? null
}

/**
 * Crea o actualiza la programación del cierre automático (upsert por la llave
 * natural project_id+modulo). La autorización vive en la RLS.
 */
export async function guardarCierreCicloConfig(
  companyId: string,
  projectId: string,
  modulo: ModuloCierre,
  cfg: { activo: boolean; dia_cierre: number; notificar: boolean },
): Promise<{ error: { message: string } | null }> {
  const { error } = await db
    .from('cierre_ciclo_config')
    .upsert(
      {
        company_id: companyId,
        project_id: projectId,
        modulo,
        activo: cfg.activo,
        dia_cierre: cfg.dia_cierre,
        notificar: cfg.notificar,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'project_id,modulo' },
    )
  return { error }
}
