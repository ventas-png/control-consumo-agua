import type { TarifaEnergia, FacturaEnergia } from '../types'

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

// serv:S6 — Validación de facturas de energía antes de guardar.
//
// El modelo guarda consumo por período (kwh_consumidos), no una lectura de
// medidor acumulada, así que "kwh ≥ anterior" se interpreta como:
//   1. los kWh/kW no pueden ser negativos,
//   2. el período debe ser válido (inicio ≤ fin), y
//   3. el período no puede iniciar antes del fin del último período ya
//      registrado para la misma fuente (sin solape ni retroactividad).

export interface FacturaValidable {
  id?: string
  fuente_energia_id?: string
  numero_factura?: string
  periodo_inicio?: string
  periodo_fin?: string
  kwh_consumidos?: number
  kwh_generados?: number
  kwh_exportados?: number
  kw_demanda_max?: number
}

export interface ValidacionFactura {
  valido: boolean
  motivo?: string
}

export function validarFacturaEnergia(
  factura: FacturaValidable,
  facturasExistentes: FacturaEnergia[],
): ValidacionFactura {
  const noNegativos: Array<[number | undefined, string]> = [
    [factura.kwh_consumidos, 'Los kWh consumidos'],
    [factura.kwh_generados, 'Los kWh generados'],
    [factura.kwh_exportados, 'Los kWh exportados'],
    [factura.kw_demanda_max, 'La demanda máxima (kW)'],
  ]
  for (const [valor, etiqueta] of noNegativos) {
    if (valor != null && valor < 0) {
      return { valido: false, motivo: `${etiqueta} no puede ser negativo.` }
    }
  }

  if (factura.periodo_inicio && factura.periodo_fin && factura.periodo_inicio > factura.periodo_fin) {
    return { valido: false, motivo: 'El inicio del período no puede ser posterior al fin.' }
  }

  // Secuencialidad respecto a la última factura de la misma fuente (excluye la
  // que se está editando). Las fechas ISO (YYYY-MM-DD) se comparan lexicográficamente.
  if (factura.periodo_inicio && factura.fuente_energia_id) {
    const previas = facturasExistentes.filter(
      f => f.fuente_energia_id === factura.fuente_energia_id && f.id !== factura.id,
    )
    const ultimoFin = previas.reduce((max, f) => (f.periodo_fin > max ? f.periodo_fin : max), '')
    if (ultimoFin && factura.periodo_inicio < ultimoFin) {
      return {
        valido: false,
        motivo: `El período inicia (${factura.periodo_inicio}) antes del fin del último registrado para la fuente (${ultimoFin}).`,
      }
    }
  }

  // serv:S12 — numero_factura no debe duplicarse dentro de la empresa (la lista
  // facturasExistentes ya viene scopeada por empresa). Excluye la factura en
  // edición y sólo aplica cuando el número viene con valor (es opcional).
  if (factura.numero_factura && factura.numero_factura.trim()) {
    const num = factura.numero_factura.trim()
    const duplicada = facturasExistentes.some(
      f => f.id !== factura.id && (f.numero_factura ?? '').trim() === num,
    )
    if (duplicada) {
      return { valido: false, motivo: `Ya existe una factura con el número “${num}”.` }
    }
  }

  return { valido: true }
}
