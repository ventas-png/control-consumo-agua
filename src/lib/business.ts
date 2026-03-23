import type { CostoCalculo } from '../types'

export function calcularTotalPagar(
  consumo: number,
  tarifa: number,
  canon: number,
  consumoMinimo = 0,
): CostoCalculo {
  if (consumo >= 0 && consumo <= consumoMinimo) {
    return { total: parseFloat(String(canon || 0)), tipo_cobro: 'Canon Fijo' }
  }
  if (consumo > consumoMinimo) {
    return {
      total: parseFloat(String(consumo)) * parseFloat(String(tarifa || 0)),
      tipo_cobro: 'Consumo',
    }
  }
  return { total: 0, tipo_cobro: 'Cero/Error' }
}
