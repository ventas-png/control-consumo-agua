import type { CostoCalculo } from '../types'

export function calcularTotalPagar(
  consumo: number,
  tarifa: number,
  canon: number,
  consumoMinimo = 0,
  tarifaExceso = 0,
): CostoCalculo {
  if (consumo >= 0 && consumo <= consumoMinimo) {
    return { total: parseFloat(String(canon || 0)), tipo_cobro: 'Canon Fijo' }
  }
  if (consumo > consumoMinimo) {
    const t = parseFloat(String(tarifa || 0))
    const tExceso = parseFloat(String(tarifaExceso || 0))
    if (tExceso > 0 && consumoMinimo > 0) {
      const base = consumoMinimo * t
      const exceso = (consumo - consumoMinimo) * tExceso
      return { total: base + exceso, tipo_cobro: 'Consumo' }
    }
    return {
      total: parseFloat(String(consumo)) * t,
      tipo_cobro: 'Consumo',
    }
  }
  return { total: 0, tipo_cobro: 'Cero/Error' }
}
