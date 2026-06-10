// Contabilidad — validación Zod de formularios (cuentas, pólizas manuales,
// tipos de cambio). La validación AUTORITATIVA vive en el servidor
// (conta_publicar_asiento valida debe=haber, cuentas de detalle y periodo);
// esto da feedback inmediato en la UI con las mismas reglas.
import { z } from 'zod'

/** Redondeo monetario a 2 decimales (mismo round half-up que la BD). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Conversión a moneda base: debe/haber = round(monto_origen × tipo_cambio, 2). */
export function convertirMontoBase(montoOrigen: number, tipoCambio: number): number {
  return round2(montoOrigen * tipoCambio)
}

/**
 * Normaliza monedas legacy de la app ('Q', '$', 'usd') a ISO 4217 mayúsculas.
 * Espejo de conta_normalizar_moneda (migración 20260611000100).
 */
export function normalizarMoneda(m: string | null | undefined): string | null {
  const t = (m ?? '').trim().toUpperCase()
  if (!t) return null
  if (t === 'Q') return 'GTQ'
  if (t === '$' || t === 'US$') return 'USD'
  if (t === 'MX$') return 'MXN'
  return t
}

export const cuentaFormSchema = z.object({
  codigo: z.string().trim().min(1, 'El código es obligatorio').max(20),
  nombre: z.string().trim().min(2, 'El nombre es obligatorio (mín. 2 caracteres)').max(120),
  tipo: z.enum(['activo', 'pasivo', 'capital', 'ingreso', 'gasto']),
  naturaleza: z.enum(['deudora', 'acreedora']),
  padre_id: z.string().uuid().nullable(),
  nivel: z.number().int().min(1).max(5),
  es_detalle: z.boolean(),
  moneda: z.string().trim().toUpperCase().length(3, 'Código ISO de 3 letras (ej. USD)').nullable(),
  descripcion: z.string().trim().max(500).nullable(),
})

export type CuentaFormInput = z.infer<typeof cuentaFormSchema>

export const asientoLineaFormSchema = z.object({
  cuenta_id: z.string().uuid('Selecciona la cuenta'),
  descripcion: z.string().trim().max(300).optional(),
  debe: z.number().min(0).default(0),
  haber: z.number().min(0).default(0),
  moneda_origen: z.string().trim().toUpperCase().length(3).nullable().optional(),
  monto_origen: z.number().positive().nullable().optional(),
  tipo_cambio: z.number().positive().nullable().optional(),
}).refine((l) => !(l.debe > 0 && l.haber > 0), {
  message: 'Una línea va al debe O al haber, no a ambos',
}).refine((l) => l.debe > 0 || l.haber > 0, {
  message: 'La línea debe llevar un monto',
})

export type AsientoLineaFormInput = z.infer<typeof asientoLineaFormSchema>

export const asientoFormSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha YYYY-MM-DD'),
  tipo: z.enum(['diario', 'ingreso', 'egreso', 'apertura']),
  concepto: z.string().trim().min(3, 'El concepto es obligatorio').max(300),
  project_id: z.string().uuid().nullable(),
  lineas: z.array(asientoLineaFormSchema).min(2, 'Una póliza lleva al menos 2 líneas'),
}).refine(
  (a) => {
    const debe = round2(a.lineas.reduce((s, l) => s + l.debe, 0))
    const haber = round2(a.lineas.reduce((s, l) => s + l.haber, 0))
    return debe === haber && debe > 0
  },
  { message: 'La póliza está descuadrada: el total del debe debe igualar al haber (> 0)', path: ['lineas'] },
)

export type AsientoFormInput = z.infer<typeof asientoFormSchema>

export const tipoCambioFormSchema = z.object({
  moneda: z.string().trim().toUpperCase().length(3, 'Código ISO de 3 letras (ej. USD)'),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha YYYY-MM-DD'),
  tasa: z.number().positive('La tasa debe ser mayor que 0'),
})

export type TipoCambioFormInput = z.infer<typeof tipoCambioFormSchema>

/** Totales vivos de un editor de líneas (para mostrar descuadre en la UI). */
export function totalesLineas(lineas: Array<{ debe: number; haber: number }>): {
  debe: number
  haber: number
  diferencia: number
} {
  const debe = round2(lineas.reduce((s, l) => s + (l.debe || 0), 0))
  const haber = round2(lineas.reduce((s, l) => s + (l.haber || 0), 0))
  return { debe, haber, diferencia: round2(debe - haber) }
}
