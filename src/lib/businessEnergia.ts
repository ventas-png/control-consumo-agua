import type { TarifaEnergia } from '../types'

export interface CalculoFacturaInput {
  tarifa: TarifaEnergia
  kwhConsumidos: number
  kwhExportados?: number
  kwDemandaMax?: number
}

export interface CalculoFacturaOutput {
  monto_energia: number
  monto_potencia: number
  monto_cargo_fijo: number
  monto_alumbrado: number
  monto_iva: number
  monto_credito_exportacion: number
  monto_total: number
  subtotal: number
}

/**
 * Calcula el desglose de una factura de energía a partir de lecturas + tarifa.
 * Maneja alumbrado_tipo fijo vs porcentual y aplica IVA sobre el subtotal.
 * El resultado se usa para pre-llenar el formulario; el usuario puede sobrescribir
 * los montos porque la factura real tiene prioridad.
 */
export function calcularFacturaEnergia(input: CalculoFacturaInput): CalculoFacturaOutput {
  const { tarifa, kwhConsumidos, kwhExportados = 0, kwDemandaMax = 0 } = input

  // Cálculos base
  const monto_energia = kwhConsumidos * tarifa.precio_kwh_energia
  const monto_potencia = kwDemandaMax * tarifa.precio_kw_potencia
  const monto_cargo_fijo = tarifa.cargo_fijo

  // Alumbrado público: fijo o porcentual
  let monto_alumbrado = 0
  if (tarifa.alumbrado_tipo === 'porcentual') {
    const subtotal_sin_alumbrado = monto_energia + monto_potencia + monto_cargo_fijo
    monto_alumbrado = subtotal_sin_alumbrado * (tarifa.alumbrado_publico / 100)
  } else {
    // fijo
    monto_alumbrado = tarifa.alumbrado_publico
  }

  // Crédito por exportación (negativo si hay exportación)
  const monto_credito_exportacion = -(kwhExportados * tarifa.precio_kwh_exportado)

  // Subtotal sin IVA
  const subtotal =
    monto_energia +
    monto_potencia +
    monto_cargo_fijo +
    monto_alumbrado +
    monto_credito_exportacion

  // IVA sobre subtotal
  const monto_iva = subtotal * (tarifa.iva_porcentaje / 100)

  // Total
  const monto_total = subtotal + monto_iva

  return {
    monto_energia,
    monto_potencia,
    monto_cargo_fijo,
    monto_alumbrado,
    monto_iva,
    monto_credito_exportacion,
    monto_total,
    subtotal,
  }
}
