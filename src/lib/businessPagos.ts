// Cobros pluggable — Lógica PURA del payfac efectivo (override empresa↔locación).
//
// Sin I/O, sin React, sin Supabase: solo funciones puras testeables. Fuente de
// verdad del lado Vite; su ESPEJO Deno es
// supabase/functions/_shared/payments/resolverConfigPago.ts. Mismo criterio que
// resolverConfigFiscalEfectiva (businessFiscal.ts) pero para el procesador de pagos.

import type { ConfigPagoEfectiva } from '../types/pagos'

/** Moneda por defecto si la empresa no fijó companies.default_currency. */
export const MONEDA_PAGO_DEFAULT = 'GTQ'

/** Payfac por defecto (cobro simulado) si nadie eligió uno. */
export const PROVEEDOR_PAGO_DEFAULT = 'sandbox'

/** Campos de pago a nivel EMPRESA (companies). */
export interface ConfigPagoEmpresa {
  /** companies.proveedor_pago (default 'sandbox'). */
  proveedorPago?: string | null
  /** companies.default_currency. */
  monedaDefault?: string | null
}

/** Override de pago a nivel LOCACIÓN (projects). NULL = hereda de la empresa. */
export interface ConfigPagoLocacion {
  proveedorPago?: string | null
}

/** Trim que colapsa '' y whitespace a null (un override vacío = "hereda"). */
function nz(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = v.trim()
  return t === '' ? null : t
}

/**
 * Resuelve la config de pago EFECTIVA de una locación contra los defaults de su
 * empresa. Override por campo: locación gana sobre empresa cuando aporta valor.
 *
 *   - proveedorPago: locación ?? empresa ?? 'sandbox' (default seguro).
 *   - moneda:        empresa.monedaDefault ?? 'GTQ'.
 *
 * `desdeLocacion` = true si el proveedor provino del override de la locación.
 */
export function resolverConfigPagoEfectiva(
  empresa: ConfigPagoEmpresa | null | undefined,
  locacion?: ConfigPagoLocacion | null,
): ConfigPagoEfectiva {
  const emp = empresa ?? {}
  const loc = locacion ?? {}

  const proveedorLoc = nz(loc.proveedorPago)
  const proveedorPago = (
    proveedorLoc ??
    nz(emp.proveedorPago) ??
    PROVEEDOR_PAGO_DEFAULT
  ).toLowerCase()

  const moneda = (nz(emp.monedaDefault) ?? MONEDA_PAGO_DEFAULT).toUpperCase()

  return {
    proveedorPago,
    moneda,
    desdeLocacion: proveedorLoc != null,
  }
}

/**
 * Normaliza una moneda guardada al código ISO 4217 que esperan los payfacs
 * (ej. QPayPro `x_currency_code`). Acepta tanto SÍMBOLOS de display (como 'Q',
 * que es lo que guarda projects.moneda) como códigos ISO ya formados:
 *   'Q' | 'Q.' | 'GTQ' → 'GTQ'
 *   '$' | 'US$' | 'USD' → 'USD'
 *   'MX$' | 'MXN'       → 'MXN'
 * Un código de 3 letras se respeta en mayúsculas; vacío/desconocido → 'GTQ'.
 */
export function normalizarMonedaISO(v: string | null | undefined): string {
  const up = (v ?? '').trim().toUpperCase()
  if (up === '') return MONEDA_PAGO_DEFAULT
  if (up === 'Q' || up === 'Q.' || up === 'GTQ' || up === 'QTZ') return 'GTQ'
  if (up === '$' || up === 'US$' || up === 'USD' || up === 'US') return 'USD'
  if (up === 'MX$' || up === 'MXN') return 'MXN'
  if (/^[A-Z]{3}$/.test(up)) return up
  return MONEDA_PAGO_DEFAULT
}
