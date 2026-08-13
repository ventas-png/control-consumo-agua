// Presupuesto — CARGA MASIVA de partidas (lógica pura, testeable).
//
// FORMATO DEL ARCHIVO: una fila por cuenta y una columna por mes.
//
//   codigo_cuenta  nombre_cuenta   total_anual  ene    feb    …  dic
//   5201-01        Energía                      4500   4500   …  4500
//   5201-02        Agua            24000                      …
//
// Dos formas de llenar cada fila, y la que se usa se decide sola:
//   · con los 12 meses → se toman tal cual (el caso de un presupuesto con
//     estacionalidad: más energía en verano, aguinaldos en diciembre);
//   · con `total_anual` y los meses vacíos → se reparte en 12 con
//     `distribuirAnual`, que redondea 11 cuotas y deja el residuo en la última
//     para que la suma cuadre al centavo.
//
// Si vienen AMBOS y no cuadran, la fila es un error: cargar en silencio algo
// distinto de lo que el usuario cree haber escrito es peor que rechazarla.
//
// `nombre_cuenta` es informativo (para leer el archivo) — la cuenta se resuelve
// por CÓDIGO contra el catálogo del ledger del presupuesto.
//
// Este módulo no toca la red ni la BD: `resolverPartidas` devuelve las partidas
// listas y la pantalla las vuelca en el editor, donde el usuario las revisa y
// guarda con el flujo de siempre (que ya respeta la inmutabilidad de un
// presupuesto aprobado).
import { redondear2 } from '../../lib/business'
import { distribuirAnual } from './schemas'
import type { TipoCuenta } from '../../types/contabilidad'

/** Cabeceras de los 12 meses, en orden. */
export const COLUMNAS_MES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
] as const

/** Fila del archivo ya normalizada: la cuenta aún sin resolver. */
export interface PartidaImportFila {
  codigo_cuenta: string
  /** 12 montos (índice 0 = enero), ya redondeados a 2 decimales. */
  meses: number[]
}

export type FilaPartidaResultado =
  | { ok: true; data: PartidaImportFila }
  | { ok: false; errors: string[] }

/** Cuenta candidata a presupuestarse (subconjunto del catálogo del ledger). */
export interface CuentaPresupuestable {
  id: string
  codigo: string
  nombre: string
  tipo: TipoCuenta
  es_detalle: boolean
  activa: boolean
}

export interface PartidaResuelta {
  cuenta_id: string
  codigo: string
  meses: number[]
}

export interface PartidaOmitida {
  codigo: string
  motivo: string
}

export interface PlanPartidas {
  aplicar: PartidaResuelta[]
  omitidas: PartidaOmitida[]
  /** Códigos que venían en varias filas y se sumaron (desglose por concepto). */
  sumadas: string[]
}

function texto(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  return String(raw).trim()
}

/**
 * Monto de una celda del presupuesto → número ≥ 0. Acepta "1,234.56",
 * "Q 1,234.56", "1.234,56" (formato europeo) y números; la celda vacía es 0.
 * Devuelve null si no es interpretable o es negativo (`monto >= 0` en BD).
 *
 * Hermano de `parseMontoExtracto` (bancos), que sí admite negativos y trata el
 * cero como "sin dato" porque un extracto bancario no tiene renglones en cero.
 */
export function parseMontoPresupuesto(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? redondear2(raw) : null
  }
  const s0 = texto(raw)
  if (s0 === '') return 0
  // "(150.00)" es un NEGATIVO en notación contable, y llega solo con copiar de
  // un reporte. Sin esto los paréntesis se limpiaban como cualquier símbolo y
  // la celda entraba al presupuesto como +150.
  if (/^\(.*\)$/.test(s0)) return null
  // quita símbolo de moneda/letras y separadores de miles
  let s = s0.replace(/[^\d.,-]/g, '')
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    s = s.replace(/,/g, '')
  }
  const n = parseFloat(s)
  if (!Number.isFinite(n) || n < 0) return null
  return redondear2(n)
}

/** Suma de los 12 meses, redondeada como `numeric(14,2)`. */
export function totalMeses(meses: number[]): number {
  return redondear2(meses.reduce((s, m) => s + (Number.isFinite(m) ? m : 0), 0))
}

/** Valida y normaliza una fila cruda del archivo. */
export function validarFilaPartida(row: Record<string, unknown>): FilaPartidaResultado {
  const errors: string[] = []

  const codigo = texto(row['codigo_cuenta']) || texto(row['codigo'])
  if (!codigo) errors.push('codigo_cuenta es obligatorio')
  else if (codigo.length > 20) errors.push('codigo_cuenta no puede exceder 20 caracteres')

  const meses: number[] = []
  for (const columna of COLUMNAS_MES) {
    const monto = parseMontoPresupuesto(row[columna])
    if (monto === null) {
      errors.push(`${columna}: "${texto(row[columna])}" no es un monto válido (≥ 0)`)
      meses.push(0)
    } else {
      meses.push(monto)
    }
  }

  const totalAnual = parseMontoPresupuesto(row['total_anual'])
  if (totalAnual === null) {
    errors.push(`total_anual: "${texto(row['total_anual'])}" no es un monto válido (≥ 0)`)
  }

  if (errors.length > 0) return { ok: false, errors }

  const sumaMeses = totalMeses(meses)
  const anual = totalAnual ?? 0

  if (sumaMeses === 0 && anual === 0) {
    return { ok: false, errors: ['la fila no lleva monto: indica total_anual o al menos un mes'] }
  }

  // Los meses mandan; total_anual solo reparte cuando no hay desglose. Si el
  // archivo trae los dos y no cuadran, no se adivina cuál gana.
  if (sumaMeses > 0 && anual > 0 && sumaMeses !== anual) {
    return {
      ok: false,
      errors: [`los meses suman ${sumaMeses} pero total_anual dice ${anual} — deja una sola de las dos formas`],
    }
  }

  return {
    ok: true,
    data: {
      codigo_cuenta: codigo,
      meses: sumaMeses > 0 ? meses : distribuirAnual(anual),
    },
  }
}

/**
 * Resuelve los códigos contra el catálogo del ledger y descarta lo que no puede
 * presupuestarse. Un código repetido NO se descarta: sus filas se SUMAN, que es
 * como se arma un presupuesto por conceptos ("energía área común" + "energía
 * bombeo" contra la misma cuenta 5201).
 */
export function resolverPartidas(
  filas: PartidaImportFila[],
  cuentas: CuentaPresupuestable[],
): PlanPartidas {
  const porCodigo = new Map(cuentas.map((c) => [c.codigo, c]))
  const aplicar: PartidaResuelta[] = []
  const omitidas: PartidaOmitida[] = []
  const sumadas: string[] = []
  const porCuenta = new Map<string, PartidaResuelta>()

  for (const fila of filas) {
    const cuenta = porCodigo.get(fila.codigo_cuenta)
    if (!cuenta) {
      omitidas.push({ codigo: fila.codigo_cuenta, motivo: 'no existe en el catálogo de esta contabilidad' })
      continue
    }
    if (!cuenta.activa) {
      omitidas.push({ codigo: fila.codigo_cuenta, motivo: 'la cuenta está inactiva' })
      continue
    }
    if (!cuenta.es_detalle) {
      omitidas.push({ codigo: fila.codigo_cuenta, motivo: 'es una cuenta agrupadora: presupuesta sus cuentas de detalle' })
      continue
    }
    if (cuenta.tipo !== 'ingreso' && cuenta.tipo !== 'gasto') {
      omitidas.push({
        codigo: fila.codigo_cuenta,
        motivo: `solo se presupuestan cuentas de ingreso y gasto (esta es de ${cuenta.tipo})`,
      })
      continue
    }

    const previa = porCuenta.get(cuenta.id)
    if (previa) {
      previa.meses = previa.meses.map((m, i) => redondear2(m + fila.meses[i]))
      if (!sumadas.includes(cuenta.codigo)) sumadas.push(cuenta.codigo)
      continue
    }
    const partida: PartidaResuelta = { cuenta_id: cuenta.id, codigo: cuenta.codigo, meses: [...fila.meses] }
    porCuenta.set(cuenta.id, partida)
    aplicar.push(partida)
  }

  aplicar.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es'))
  return { aplicar, omitidas, sumadas }
}
