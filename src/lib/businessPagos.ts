// Cobros pluggable — Lógica PURA del payfac efectivo (override empresa↔locación).
//
// Sin I/O, sin React, sin Supabase: solo funciones puras testeables. Fuente de
// verdad del lado Vite; su ESPEJO Deno es
// supabase/functions/_shared/payments/resolverConfigPago.ts. Mismo criterio que
// resolverConfigFiscalEfectiva (businessFiscal.ts) pero para el procesador de pagos.

import type { AmbientePago, ConfigPagoEfectiva } from '../types/pagos'
// PR-22 (auditoría 2026-07-28): el redondeo monetario vive en un solo sitio.
// Había 8 copias del truco `(n + Number.EPSILON) * 100`, que fallaba el 4,58%
// de los puntos medios y divergía de `numeric(12,2)` en todo negativo.
import { redondear2 } from './business'

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

/** Campos de pago a nivel EMPRESA (companies). */
export interface ConfigPagoEmpresa {
  /** companies.proveedor_pago (default 'sandbox'). */
  proveedorPago?: string | null
  /** companies.default_currency. */
  monedaDefault?: string | null
  /** companies.ambiente_pago (default 'sandbox'; 'prod' = cobros REALES). */
  ambientePago?: string | null
}

/** Override de pago a nivel LOCACIÓN (projects). NULL = hereda de la empresa. */
export interface ConfigPagoLocacion {
  proveedorPago?: string | null
  /** projects.ambiente_pago (NULL = hereda de la empresa). */
  ambientePago?: string | null
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
 *   - ambiente:      locación ?? empresa ?? 'sandbox' (default seguro: solo un
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
  const proveedorPago = (
    proveedorLoc ??
    nz(emp.proveedorPago) ??
    PROVEEDOR_PAGO_DEFAULT
  ).toLowerCase()

  const moneda = (nz(emp.monedaDefault) ?? MONEDA_PAGO_DEFAULT).toUpperCase()

  const ambiente = normalizarAmbientePago(nz(loc.ambientePago) ?? nz(emp.ambientePago))

  return {
    proveedorPago,
    moneda,
    ambiente,
    desdeLocacion: proveedorLoc != null,
  }
}

// ── Recargo por pago con tarjeta al cliente final ───────────────────────────
// ESPEJO Vite de supabase/functions/_shared/payments/recargo.ts (el edge
// create-charge sella y cobra el recargo server-side; este espejo solo pinta
// el desglose ANTES de pagar en el portal). Config en recargo_tarjeta_config:
// fila activa del canal > fila activa 'default' > sin recargo.

/** Fila de recargo_tarjeta_config visible al portal (RLS de cliente). */
export interface RecargoTarjetaRow {
  canal: string
  activo: boolean
  /** Fracción (0.05 = 5%). */
  pct: number
  /** Monto fijo por pago, en la moneda del cobro. */
  fijo: number
}

/**
 * Recargo de tarjeta para un cobro de `monto` por el canal `proveedor`, o null
 * si no aplica. Misma aritmética que el edge (acotado a [0, monto]).
 */
export function calcularRecargoTarjeta(
  monto: number,
  proveedor: string,
  rows: RecargoTarjetaRow[] | null | undefined,
): number | null {
  if (!Number.isFinite(monto) || monto <= 0) return null
  const activas = (rows ?? []).filter(r => r.activo === true)
  const cfg = activas.find(r => r.canal === proveedor) ?? activas.find(r => r.canal === 'default')
  if (!cfg) return null
  const pct = Number.isFinite(cfg.pct) && cfg.pct > 0 ? cfg.pct : 0
  const fijo = Number.isFinite(cfg.fijo) && cfg.fijo > 0 ? cfg.fijo : 0
  if (pct === 0 && fijo === 0) return null
  const bruta = redondear2(monto * pct + fijo)
  return Math.min(Math.max(bruta, 0), redondear2(monto))
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
