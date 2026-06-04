// Cobros pluggable — Resolver de CONFIG DE PAGO EFECTIVA (override empresa↔locación).
//
// ESPEJO Deno de src/lib/businessPagos.ts (fuente de verdad Vite). Mismo criterio
// que resolverConfigFiscalEfectiva (fiscal):
//     efectiva.proveedor = locacion.proveedorPago ?? empresa.proveedorPago
// NULL/'' en la locación = "hereda de la empresa". PURO + determinista.

import type {
  ConfigPagoEfectiva,
  ConfigPagoEmpresa,
  ConfigPagoLocacion,
} from './types.ts'

/** Moneda por defecto si la empresa no fijó companies.default_currency. */
export const MONEDA_PAGO_DEFAULT = 'GTQ'

/** Payfac por defecto (cobro simulado) si nadie eligió uno. */
export const PROVEEDOR_PAGO_DEFAULT = 'sandbox'

/** Trim que colapsa '' y whitespace a null (un override vacío = "hereda"). */
function nz(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = v.trim()
  return t === '' ? null : t
}

/**
 * Resuelve la config de pago EFECTIVA de una locación contra los defaults de su
 * empresa. Override por campo: la locación gana sobre la empresa cuando aporta
 * valor; si no, hereda.
 *
 *   - proveedorPago: locacion ?? empresa ?? 'sandbox' (default seguro).
 *   - moneda:        empresa.monedaDefault ?? 'GTQ' (la moneda es del tenant; no
 *                    se sobreescribe por locación hoy).
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
  const proveedorPago =
    (proveedorLoc ?? nz(emp.proveedorPago) ?? PROVEEDOR_PAGO_DEFAULT).toLowerCase()

  const moneda = (nz(emp.monedaDefault) ?? MONEDA_PAGO_DEFAULT).toUpperCase()

  return {
    proveedorPago,
    moneda,
    desdeLocacion: proveedorLoc != null,
  }
}
