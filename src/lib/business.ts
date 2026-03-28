import type { CostoCalculo } from '../types'

export function calcularTotalPagar(
  consumo: number,
  tarifa: number,
  canon: number,
  consumoMinimo = 0,
  tarifaExceso = 0,
  derechoServicioM3: number | null = null,
): CostoCalculo {
  const t = parseFloat(String(tarifa || 0))
  const tExceso = parseFloat(String(tarifaExceso || 0))
  const canonVal = parseFloat(String(canon || 0))

  // Tramo 1: consumo ≤ mínimo → solo canon fijo
  if (consumo >= 0 && consumo <= consumoMinimo) {
    return {
      total: canonVal,
      tipo_cobro: 'Canon Fijo',
      desglose: { tramo: 1, canon_fijo: canonVal },
    }
  }

  // Tramo 3: consumo > derecho de servicio → base a precio normal + exceso a precio exceso
  if (derechoServicioM3 && derechoServicioM3 > 0 && tExceso > 0 && consumo > derechoServicioM3) {
    const monto_base = derechoServicioM3 * t
    const exceso_m3 = consumo - derechoServicioM3
    const monto_exceso = exceso_m3 * tExceso
    return {
      total: monto_base + monto_exceso,
      tipo_cobro: 'Consumo con Exceso',
      desglose: { tramo: 3, derecho_m3: derechoServicioM3, precio_m3: t, exceso_m3, precio_exceso: tExceso, monto_base, monto_exceso },
    }
  }

  // Tramo 2: consumo > mínimo y dentro del derecho de servicio (o sin derecho configurado)
  return {
    total: consumo * t,
    tipo_cobro: 'Consumo Normal',
    desglose: { tramo: 2, consumo_m3: consumo, precio_m3: t },
  }
}
