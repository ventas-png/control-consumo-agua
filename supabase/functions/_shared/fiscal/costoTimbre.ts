// F8 — Costo del timbre fiscal (cálculo puro, sin Deno APIs).
//
// La config vive en `timbrado_config` (una fila por empresa, la fija el
// superadmin) y se lee AL CERTIFICAR: los primeros `timbres_incluidos` DTEs
// del mes calendario salen a costo 0, el resto al precio vigente. El
// resultado se SELLA en documentos_fiscales.costo_cents — cambios de config
// solo afectan timbrados futuros.

export interface TimbradoConfigRow {
  activo: boolean
  /** Precio por DTE en USD cents (unidad de billing_plans). */
  precio_dte_cents: number
  /** DTEs incluidos sin costo por mes calendario. */
  timbres_incluidos: number
}

/**
 * Costo (USD cents) del siguiente DTE a certificar, dado cuántos ya se
 * timbraron este mes. `null` = sin modelo de cobro (config ausente/inactiva);
 * `0` = dentro de la cuota incluida.
 */
export function calcularCostoTimbre(
  cfg: TimbradoConfigRow | null | undefined,
  timbradosEsteMes: number,
): number | null {
  if (!cfg || cfg.activo !== true) return null
  const previos = Number.isFinite(timbradosEsteMes) && timbradosEsteMes > 0 ? timbradosEsteMes : 0
  const incluidos = Number.isFinite(cfg.timbres_incluidos) && cfg.timbres_incluidos > 0 ? cfg.timbres_incluidos : 0
  if (previos < incluidos) return 0
  const precio = Number.isFinite(cfg.precio_dte_cents) && cfg.precio_dte_cents > 0 ? cfg.precio_dte_cents : 0
  return precio
}
