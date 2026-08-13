// Bancos — validación Zod + parsers puros del extracto importado.
// La validación autoritativa (dedup, doble conciliación, asientos de ajuste)
// vive en la BD; estos helpers normalizan lo que viene del CSV/XLSX bancario.
import { z } from 'zod'
import type { CuentaBancaria } from '../../types/bancos'

export const cuentaBancariaFormSchema = z.object({
  nombre: z.string().trim().min(2, 'El alias es obligatorio').max(80),
  banco: z.string().trim().min(2, 'El banco es obligatorio').max(120),
  numero_mascara: z.string().trim().max(8).nullable(),
  moneda: z.string().trim().toUpperCase().length(3, 'Código ISO de 3 letras').nullable(),
  cuenta_contable_id: z.string().uuid('Selecciona la cuenta contable del banco'),
  notas: z.string().trim().max(500).nullable(),
})

export type CuentaBancariaFormInput = z.infer<typeof cuentaBancariaFormSchema>

export interface MovimientoImportado {
  fecha: string
  descripcion: string | null
  referencia: string | null
  monto: number
}

/**
 * Monto de extracto bancario → número con signo. Acepta "1,234.56", "Q1,234.56",
 * "$ -150", "(150.00)" (paréntesis = negativo, convención bancaria) y números.
 * Devuelve null si no es interpretable o es cero.
 */
export function parseMontoExtracto(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw !== 0 ? Math.round(raw * 100) / 100 : null
  }
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  if (s === '') return null
  let negativo = false
  if (/^\(.*\)$/.test(s)) {
    negativo = true
    s = s.slice(1, -1)
  }
  // quita símbolo de moneda/letras y separadores de miles
  s = s.replace(/[^\d.,-]/g, '')
  // "1.234,56" (formato europeo) → "1234.56"
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    s = s.replace(/,/g, '')
  }
  const n = parseFloat(s)
  if (!Number.isFinite(n) || n === 0) return null
  return Math.round((negativo ? -Math.abs(n) : n) * 100) / 100
}

/**
 * Fecha de extracto → 'YYYY-MM-DD'. Acepta 'YYYY-MM-DD', 'DD/MM/YYYY',
 * 'DD-MM-YYYY' y objetos Date (de XLSX). Devuelve null si no es interpretable.
 */
export function parseFechaExtracto(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10)
  }
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmy) {
    const [, d, m, y] = dmy
    const dia = parseInt(d, 10)
    const mes = parseInt(m, 10)
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
    return `${y}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
  }
  return null
}

/** Fila lista para insertar en `banco_movimientos`. */
export interface MovimientoInsert {
  company_id: string
  project_id: string | null
  cuenta_bancaria_id: string
  fecha: string
  descripcion: string | null
  referencia: string | null
  monto: number
  lote_id: string
}

/**
 * Filas del lote a insertar. La contabilidad (empresa + proyecto) sale de la
 * CUENTA BANCARIA, nunca del selector de la pantalla: si el ledger activo no es
 * el de la cuenta —selección vieja tras cambiar de contabilidad o de empresa—
 * el lote no se manda, en vez de sellarlo con una empresa que no es la suya y
 * mezclar extractos entre contabilidades. (La BD lo vuelve a sellar por su
 * cuenta con banco_tg_movimiento_ledger; esto es el aviso temprano y legible.)
 */
export function construirLoteExtracto(args: {
  cuenta: Pick<CuentaBancaria, 'id' | 'company_id' | 'project_id'>
  companyId: string
  projectId: string | null
  movimientos: MovimientoImportado[]
  loteId: string
}): MovimientoInsert[] {
  const { cuenta, companyId, projectId, movimientos, loteId } = args
  if (cuenta.company_id !== companyId || (cuenta.project_id ?? null) !== (projectId ?? null)) {
    throw new Error(
      'La cuenta bancaria no pertenece a la contabilidad activa. Vuelve a seleccionarla antes de importar.',
    )
  }
  return movimientos.map((m) => ({
    company_id: cuenta.company_id,
    project_id: cuenta.project_id,
    cuenta_bancaria_id: cuenta.id,
    fecha: m.fecha,
    descripcion: m.descripcion,
    referencia: m.referencia,
    monto: m.monto,
    lote_id: loteId,
  }))
}

/** Valida una fila parseada del extracto (para ImportModal.validateRow). */
export function validarFilaExtracto(row: Record<string, unknown>):
  | { ok: true; data: MovimientoImportado }
  | { ok: false; errors: string[] } {
  const errors: string[] = []
  const fecha = parseFechaExtracto(row.fecha)
  if (!fecha) errors.push('fecha inválida (usa YYYY-MM-DD o DD/MM/YYYY)')
  const monto = parseMontoExtracto(row.monto)
  if (monto === null) errors.push('monto inválido o cero (usa signo: + depósito, − retiro)')
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    data: {
      fecha: fecha!,
      monto: monto!,
      descripcion: String(row.descripcion ?? '').trim() || null,
      referencia: String(row.referencia ?? '').trim() || null,
    },
  }
}
