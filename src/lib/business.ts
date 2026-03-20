import type { CostoCalculo } from '../types'

export function calcularTotalPagar(
  consumo: number,
  tarifa: number,
  canon: number
): CostoCalculo {
  if (consumo <= 0.99 && consumo >= 0) {
    return { total: parseFloat(String(canon || 0)), tipo_cobro: 'Canon Fijo' }
  }
  if (consumo > 0.99) {
    return {
      total: parseFloat(String(consumo)) * parseFloat(String(tarifa || 0)),
      tipo_cobro: 'Consumo',
    }
  }
  return { total: 0, tipo_cobro: 'Cero/Error' }
}
