// Presupuesto — validación Zod + helpers puros del editor de partidas.
// La validación autoritativa (estados, inmutabilidad, versionado) vive en los
// triggers de BD.
import { z } from 'zod'

export const presupuestoFormSchema = z.object({
  anio: z.number().int().min(2000).max(2100),
  nombre: z.string().trim().min(3, 'El nombre es obligatorio').max(150),
  project_id: z.string().uuid().nullable(),
  notas: z.string().trim().max(500).nullable(),
})

export type PresupuestoFormInput = z.infer<typeof presupuestoFormSchema>

export const partidaSchema = z.object({
  cuenta_id: z.string().uuid(),
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Periodo YYYY-MM'),
  monto: z.number().min(0),
})

export type PartidaInput = z.infer<typeof partidaSchema>

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Reparte un monto anual en 12 mensualidades a 2 decimales que SUMAN exacto:
 * 11 cuotas redondeadas + la última absorbe el residuo.
 */
export function distribuirAnual(montoAnual: number): number[] {
  if (!Number.isFinite(montoAnual) || montoAnual <= 0) return Array(12).fill(0)
  const cuota = r2(montoAnual / 12)
  const meses = Array(11).fill(cuota) as number[]
  meses.push(r2(montoAnual - cuota * 11))
  return meses
}

/** Total anual de una fila del editor (12 montos mensuales). */
export function totalFila(meses: number[]): number {
  return r2(meses.reduce((s, m) => s + (Number.isFinite(m) ? m : 0), 0))
}
