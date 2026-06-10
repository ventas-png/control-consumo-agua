// Presupuesto avanzado — Fase 3 ERP. Ver ROADMAP_ERP_FINANZAS.md.
// Espeja presupuestos / presupuesto_partidas (migración 20260611020000).
// No confundir con presupuesto_condominio (modelo legacy anual por categoría,
// que sigue vivo en el módulo de condominios).

export type EstadoPresupuesto = 'borrador' | 'propuesto' | 'aprobado' | 'archivado'

export interface Presupuesto {
  id: string
  company_id: string
  /** NULL = presupuesto a nivel empresa. */
  project_id: string | null
  anio: number
  nombre: string
  estado: EstadoPresupuesto
  notas: string | null
  aprobado_por: string | null
  aprobado_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface PresupuestoConPartidas extends Presupuesto {
  presupuesto_partidas: Pick<PresupuestoPartida, 'monto'>[]
}

export interface PresupuestoPartida {
  id: string
  presupuesto_id: string
  company_id: string
  cuenta_id: string
  /** 'YYYY-MM' */
  periodo: string
  monto: number
}

/** Fila de presupuesto_vs_real (RPC): real desde asientos publicados. */
export interface PresupuestoVsRealFila {
  cuenta_id: string
  codigo: string
  nombre: string
  naturaleza: 'deudora' | 'acreedora'
  periodo: string
  presupuestado: number
  ejecutado: number
  variacion: number
}

export const ESTADO_PRESUPUESTO_LABELS: Record<EstadoPresupuesto, string> = {
  borrador: 'Borrador',
  propuesto: 'Propuesto',
  aprobado: 'Aprobado',
  archivado: 'Archivado',
}

export const MESES_CORTOS = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
] as const

/** 'YYYY-MM' de los 12 meses de un año. */
export function periodosDelAnio(anio: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, '0')}`)
}
