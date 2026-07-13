// Cobros pluggable — Resolver de CONFIG DE PAGO EFECTIVA (override empresa↔locación).
//
// ESPEJO Deno de src/lib/businessPagos.ts (fuente de verdad Vite). Mismo criterio
// que resolverConfigFiscalEfectiva (fiscal):
//     efectiva.proveedor = locacion.proveedorPago ?? empresa.proveedorPago
// NULL/'' en la locación = "hereda de la empresa". PURO + determinista.

import type {
  AmbientePago,
  ConfigPagoEfectiva,
  ConfigPagoEmpresa,
  ConfigPagoLocacion,
} from './types.ts'

/** Moneda por defecto si la empresa no fijó companies.default_currency. */
export const MONEDA_PAGO_DEFAULT = 'GTQ'

/** Payfac por defecto (cobro simulado) si nadie eligió uno. */
export const PROVEEDOR_PAGO_DEFAULT = 'sandbox'

/** Ambiente por defecto (pruebas): 'prod' solo cuando el tenant lo eligió explícito. */
export const AMBIENTE_PAGO_DEFAULT: AmbientePago = 'sandbox'

/** Normaliza un ambiente guardado/recibido: SOLO 'prod' exacto cobra real. */
export function normalizarAmbientePago(v: string | null | undefined): AmbientePago {
  return (v ?? '').trim().toLowerCase() === 'prod' ? 'prod' : AMBIENTE_PAGO_DEFAULT
}

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
 *   - ambiente:      locacion ?? empresa ?? 'sandbox' (default seguro: solo un
 *                    'prod' explícito del tenant cobra dinero real).
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

  const ambiente = normalizarAmbientePago(nz(loc.ambientePago) ?? nz(emp.ambientePago))

  return {
    proveedorPago,
    moneda,
    ambiente,
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
