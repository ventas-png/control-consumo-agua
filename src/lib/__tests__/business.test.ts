import { describe, it, expect } from 'vitest'
import {
  calcularTotalPagar,
  calcularTotalPagarEscalonado,
  calcularCostoTarifa,
  validarTramos,
  generarCalendarioConvenio,
  validarLectura,
  redondear2,
  calcularIVA,
  IVA_TASA_GT,
  calcularMora,
  calcularTotalFactura,
  normalizarEstadoFactura,
  esEstadoTerminalFactura,
  puedeTransicionarFactura,
  aplicarTransicionFactura,
  type ReglaMora,
} from '../business'

describe('calcularTotalPagar', () => {
  describe('Tramo 1 — canon fijo (consumo ≤ mínimo)', () => {
    it('consumo = 0, retorna solo canon fijo', () => {
      const result = calcularTotalPagar(0, 5, 50, 10)
      expect(result.total).toBe(50)
      expect(result.tipo_cobro).toBe('Canon Fijo')
      expect(result.desglose.tramo).toBe(1)
    })

    it('consumo = consumoMinimo exacto, retorna canon fijo', () => {
      const result = calcularTotalPagar(10, 5, 50, 10)
      expect(result.total).toBe(50)
      expect(result.tipo_cobro).toBe('Canon Fijo')
    })

    it('consumoMinimo = 0 por defecto, consumo 0 retorna canon', () => {
      const result = calcularTotalPagar(0, 10, 100)
      expect(result.total).toBe(100)
      expect(result.tipo_cobro).toBe('Canon Fijo')
    })
  })

  describe('Tramo 2 — consumo normal', () => {
    it('consumo > mínimo sin derecho de servicio', () => {
      const result = calcularTotalPagar(20, 5, 50, 10)
      expect(result.total).toBe(100) // 20 * 5
      expect(result.tipo_cobro).toBe('Consumo Normal')
      expect(result.desglose.tramo).toBe(2)
    })

    it('consumo > mínimo con derecho de servicio pero consumo no supera el derecho', () => {
      const result = calcularTotalPagar(15, 5, 50, 10, 3, 30)
      expect(result.total).toBe(75) // 15 * 5
      expect(result.tipo_cobro).toBe('Consumo Normal')
    })

    it('sin consumoMinimo (default 0), consumo 1 aplica tramo 2', () => {
      const result = calcularTotalPagar(1, 8, 0)
      expect(result.total).toBe(8)
      expect(result.tipo_cobro).toBe('Consumo Normal')
    })
  })

  describe('Tramo 3 — consumo con exceso', () => {
    it('consumo supera el derecho de servicio', () => {
      const result = calcularTotalPagar(50, 5, 0, 0, 8, 30)
      // base: 30 * 5 = 150, exceso: 20 * 8 = 160, total: 310
      expect(result.total).toBe(310)
      expect(result.tipo_cobro).toBe('Consumo con Exceso')
      expect(result.desglose.tramo).toBe(3)
      expect(result.desglose.exceso_m3).toBe(20)
      expect(result.desglose.monto_base).toBe(150)
      expect(result.desglose.monto_exceso).toBe(160)
    })

    it('exactamente en el límite del derecho no aplica tramo 3', () => {
      const result = calcularTotalPagar(30, 5, 0, 0, 8, 30)
      expect(result.tipo_cobro).toBe('Consumo Normal')
    })

    it('sin tarifa exceso (0), no aplica tramo 3 aunque supere el derecho', () => {
      const result = calcularTotalPagar(50, 5, 0, 0, 0, 30)
      expect(result.tipo_cobro).toBe('Consumo Normal')
    })
  })

  describe('manejo de tipos de entrada', () => {
    it('acepta strings numéricos como tarifa y canon', () => {
      const result = calcularTotalPagar(20, '5' as unknown as number, '50' as unknown as number, 10)
      expect(result.total).toBe(100)
    })

    it('valores undefined/null se tratan como 0', () => {
      const result = calcularTotalPagar(20, 0, 0, 0)
      expect(result.total).toBe(0)
    })
  })
})

describe('calcularTotalPagarEscalonado', () => {
  it('consumo ≤ mínimo → solo canon fijo (piso)', () => {
    const r = calcularTotalPagarEscalonado(3, [{ desde_m3: 0, hasta_m3: null, precio_m3: 5 }], 40, 5)
    expect(r.total).toBe(40)
    expect(r.tipo_cobro).toBe('Canon Fijo')
    expect(r.desglose.tramo).toBe(1)
  })

  it('bloque único (sin tope) cobra todo el consumo a un precio', () => {
    const r = calcularTotalPagarEscalonado(15, [{ desde_m3: 0, hasta_m3: null, precio_m3: 5 }], 0, 0)
    expect(r.total).toBe(75) // 15 * 5
    expect(r.tipo_cobro).toBe('Consumo Escalonado')
    expect(r.desglose.tramo).toBe('escalonado')
    expect(r.desglose.tramos).toHaveLength(1)
  })

  it('dos bloques: parte en el primero y parte en el segundo', () => {
    const tramos = [
      { desde_m3: 0, hasta_m3: 10, precio_m3: 5 },
      { desde_m3: 10, hasta_m3: null, precio_m3: 8 },
    ]
    const r = calcularTotalPagarEscalonado(15, tramos, 0, 0)
    expect(r.total).toBe(90) // 10*5 + 5*8
    expect(r.desglose.tramos).toEqual([
      { desde_m3: 0, hasta_m3: 10, precio_m3: 5, m3: 10, monto: 50 },
      { desde_m3: 10, hasta_m3: null, precio_m3: 8, m3: 5, monto: 40 },
    ])
  })

  it('tres bloques: consumo cae en el bloque intermedio (último bloque no aplica)', () => {
    const tramos = [
      { desde_m3: 0, hasta_m3: 10, precio_m3: 4 },
      { desde_m3: 10, hasta_m3: 20, precio_m3: 6 },
      { desde_m3: 20, hasta_m3: null, precio_m3: 10 },
    ]
    const r = calcularTotalPagarEscalonado(15, tramos, 0, 0)
    expect(r.total).toBe(70) // 10*4 + 5*6
    expect(r.desglose.tramos).toHaveLength(2) // el tercer bloque cubre 0 m³ → omitido
  })

  it('consumo exactamente en un límite de bloque', () => {
    const tramos = [
      { desde_m3: 0, hasta_m3: 10, precio_m3: 4 },
      { desde_m3: 10, hasta_m3: null, precio_m3: 6 },
    ]
    const r = calcularTotalPagarEscalonado(10, tramos, 0, 0)
    expect(r.total).toBe(40) // 10*4; el segundo bloque cubre 0 m³
    expect(r.desglose.tramos).toHaveLength(1)
  })

  it('bloques desordenados se ordenan por desde_m3', () => {
    const tramos = [
      { desde_m3: 10, hasta_m3: null, precio_m3: 8 },
      { desde_m3: 0, hasta_m3: 10, precio_m3: 5 },
    ]
    const r = calcularTotalPagarEscalonado(15, tramos, 0, 0)
    expect(r.total).toBe(90)
  })

  it('precisión de coma flotante', () => {
    const tramos = [
      { desde_m3: 0, hasta_m3: 10, precio_m3: 1.1 },
      { desde_m3: 10, hasta_m3: null, precio_m3: 2.2 },
    ]
    const r = calcularTotalPagarEscalonado(10.1, tramos, 0, 0)
    // 10*1.1 + 0.1*2.2 = 11 + 0.22 = 11.22
    expect(r.total).toBeCloseTo(11.22, 6)
  })
})

describe('calcularCostoTarifa (dispatcher plano vs escalonado)', () => {
  it('sin tramos → modelo plano (idéntico a calcularTotalPagar)', () => {
    const tarifa = { precio_m3: 5, precio_m3_exceso: 8, canon_fijo: 50, consumo_minimo: 10, tramos: null }
    const dispatcher = calcularCostoTarifa(50, tarifa, 30)
    const plano = calcularTotalPagar(50, 5, 50, 10, 8, 30)
    expect(dispatcher).toEqual(plano)
    expect(dispatcher.tipo_cobro).toBe('Consumo con Exceso')
  })

  it('tramos vacíos → modelo plano', () => {
    const tarifa = { precio_m3: 5, precio_m3_exceso: 0, canon_fijo: 0, consumo_minimo: 0, tramos: [] }
    expect(calcularCostoTarifa(20, tarifa).tipo_cobro).toBe('Consumo Normal')
  })

  it('con tramos → modelo escalonado', () => {
    const tarifa = {
      precio_m3: 5, precio_m3_exceso: 8, canon_fijo: 0, consumo_minimo: 0,
      tramos: [
        { desde_m3: 0, hasta_m3: 10, precio_m3: 5 },
        { desde_m3: 10, hasta_m3: null, precio_m3: 8 },
      ],
    }
    const r = calcularCostoTarifa(15, tarifa, 30)
    expect(r.tipo_cobro).toBe('Consumo Escalonado')
    expect(r.total).toBe(90)
  })
})

describe('validarTramos', () => {
  it('bloques contiguos desde 0 con último sin tope → válido', () => {
    expect(validarTramos([
      { desde_m3: 0, hasta_m3: 10, precio_m3: 5 },
      { desde_m3: 10, hasta_m3: 20, precio_m3: 8 },
      { desde_m3: 20, hasta_m3: null, precio_m3: 12 },
    ])).toBeNull()
  })

  it('un solo bloque sin tope → válido', () => {
    expect(validarTramos([{ desde_m3: 0, hasta_m3: null, precio_m3: 5 }])).toBeNull()
  })

  it('vacío → error', () => {
    expect(validarTramos([])).toMatch(/al menos un bloque/i)
  })

  it('no empieza en 0 → error de contigüidad', () => {
    expect(validarTramos([{ desde_m3: 5, hasta_m3: null, precio_m3: 5 }])).toMatch(/contiguos/i)
  })

  it('hueco entre bloques → error', () => {
    expect(validarTramos([
      { desde_m3: 0, hasta_m3: 10, precio_m3: 5 },
      { desde_m3: 12, hasta_m3: null, precio_m3: 8 },
    ])).toMatch(/contiguos/i)
  })

  it('solape entre bloques → error', () => {
    expect(validarTramos([
      { desde_m3: 0, hasta_m3: 10, precio_m3: 5 },
      { desde_m3: 8, hasta_m3: null, precio_m3: 8 },
    ])).toMatch(/contiguos/i)
  })

  it('bloque intermedio sin tope → error', () => {
    expect(validarTramos([
      { desde_m3: 0, hasta_m3: null, precio_m3: 5 },
      { desde_m3: 10, hasta_m3: null, precio_m3: 8 },
    ])).toMatch(/último bloque/i)
  })

  it('precio negativo → error', () => {
    expect(validarTramos([{ desde_m3: 0, hasta_m3: null, precio_m3: -1 }])).toMatch(/≥ 0/)
  })
})

describe('validarLectura', () => {
  it('lectura actual mayor que anterior: válida, consumo positivo', () => {
    const r = validarLectura(100, 150)
    expect(r.valid).toBe(true)
    expect(r.consumo).toBe(50)
    expect(r.error).toBeUndefined()
    expect(r.warning).toBeUndefined()
  })

  it('lectura actual igual a la anterior: válida, consumo cero (medidor sin uso)', () => {
    const r = validarLectura(100, 100)
    expect(r.valid).toBe(true)
    expect(r.consumo).toBe(0)
  })

  it('lectura actual menor sin resetContador: inválida', () => {
    const r = validarLectura(100, 80)
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/menor que la anterior/)
  })

  it('lectura actual menor con resetContador: válida con warning', () => {
    const r = validarLectura(100, 5, { resetContador: true })
    expect(r.valid).toBe(true)
    expect(r.consumo).toBe(0)
    expect(r.warning).toMatch(/reset/i)
  })

  it('lectura negativa: inválida', () => {
    const r = validarLectura(100, -10)
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/no puede ser negativa/)
  })

  it('lectura anterior negativa: inválida', () => {
    const r = validarLectura(-5, 10)
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/anterior no puede ser negativa/)
  })

  it('lectura no numérica: inválida', () => {
    const r = validarLectura(NaN, 100)
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/números válidos/)
  })

  it('null/undefined se trata como 0', () => {
    expect(validarLectura(null, 50).consumo).toBe(50)
    expect(validarLectura(undefined, 50).consumo).toBe(50)
  })

  it('consumo dentro del rango histórico: sin warning', () => {
    const r = validarLectura(100, 130, { promedioHistorico: 20 })
    expect(r.valid).toBe(true)
    expect(r.consumo).toBe(30)
    expect(r.warning).toBeUndefined()
  })

  it('consumo >3× promedio histórico: válida con warning de salto anómalo', () => {
    const r = validarLectura(100, 250, { promedioHistorico: 20 })
    expect(r.valid).toBe(true)
    expect(r.consumo).toBe(150)
    expect(r.warning).toMatch(/promedio histórico/)
  })

  it('factor anormal custom respetado', () => {
    // Con factor=10, 100m³ vs promedio 20 NO debe alertar
    const r = validarLectura(100, 200, { promedioHistorico: 20, factorAnormal: 10 })
    expect(r.valid).toBe(true)
    expect(r.warning).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// T4 · Facturación (agua:C4) — IVA, mora, total de factura y máquina de estados.
// ════════════════════════════════════════════════════════════════════════════

describe('redondear2', () => {
  it('redondea a 2 decimales half-away-from-zero', () => {
    expect(redondear2(1.005)).toBe(1.01)
    expect(redondear2(1.004)).toBe(1.0)
    expect(redondear2(2.675)).toBe(2.68)
  })
  it('no finitos → 0', () => {
    expect(redondear2(NaN)).toBe(0)
    expect(redondear2(Infinity)).toBe(0)
  })

  // ── Regresión del defecto de la auditoría 2026-07-28 (Bloque D · PR-22) ────
  // La implementación anterior sumaba `Number.EPSILON` antes de redondear. El
  // test de arriba pasaba —1.005, 1.004 y 2.675 caen del lado bueno— pero el
  // 4,58% de los puntos medios NO. Estos vectores son de los que fallaban.
  it('acierta los puntos medios que el truco del epsilon perdía', () => {
    expect(redondear2(2.135)).toBe(2.14)
    expect(redondear2(4.015)).toBe(4.02)
    expect(redondear2(8.165)).toBe(8.17)
    expect(redondear2(10.075)).toBe(10.08)
  })

  // `Number.EPSILON` es el ulp EN 1.0: por encima de ~1000 sumarlo no cambia
  // nada (`(1000.005 + Number.EPSILON) === 1000.005`), así que el redondeo
  // quedaba a merced del error binario. Importa: son importes de factura reales.
  it('sigue siendo correcto en magnitudes donde el epsilon era inoperante', () => {
    expect(redondear2(1000.005)).toBe(1000.01)
    expect(redondear2(12345.675)).toBe(12345.68)
    expect(redondear2(999999.005)).toBe(999999.01)
  })

  // `Math.round` es half-UP, no half-away-from-zero: TODO punto medio negativo
  // divergía de la columna `numeric(12,2)`. Afecta a notas de crédito, ajustes
  // y reversos.
  it('redondea los negativos alejándose del cero, como numeric', () => {
    expect(redondear2(-1.005)).toBe(-1.01)
    expect(redondear2(-2.135)).toBe(-2.14)
    expect(redondear2(-10.045)).toBe(-10.05)
    expect(redondear2(-0.005)).toBe(-0.01)
  })

  it('nunca devuelve -0 (distinto de 0 al serializar y al mostrarlo)', () => {
    expect(Object.is(redondear2(-0.001), 0)).toBe(true)
    expect(Object.is(redondear2(-0), 0)).toBe(true)
  })

  it('absorbe el error de coma flotante clásico', () => {
    expect(redondear2(0.1 + 0.2)).toBe(0.3)
    expect(redondear2(1.1 * 3)).toBe(3.3)
  })

  // Prueba de propiedad contra una referencia DECIMAL exacta (BigInt sobre
  // centavos), que es lo que hace `numeric` en Postgres. Es la red que hubiera
  // cazado el defecto original: barre magnitudes en vez de fiarse de 3 casos.
  it('coincide con numeric(12,2) en 20.000 puntos medios de ambos signos', () => {
    const referenciaDecimal = (x: number): number => {
      const s = x.toFixed(10)
      const negativo = s.startsWith('-')
      const [entera, decimal] = s.replace('-', '').split('.')
      const centavos = BigInt(entera) * 100n + BigInt(decimal.slice(0, 2))
      const conRedondeo = centavos + (Number(decimal[2]) >= 5 ? 1n : 0n)
      const valor = Number(conRedondeo) / 100
      return negativo ? (valor === 0 ? 0 : -valor) : valor
    }

    const fallos: string[] = []
    for (let i = 5; i <= 100005; i += 10) {
      for (const n of [i / 1000, -i / 1000]) {
        const esperado = referenciaDecimal(n)
        if (redondear2(n) !== esperado) fallos.push(`${n}: ${redondear2(n)} ≠ ${esperado}`)
      }
    }
    expect(fallos.slice(0, 5)).toEqual([])
  })
})

describe('calcularIVA', () => {
  it('aplica 12% por defecto (GT) cuando no se pasa tasa', () => {
    const r = calcularIVA(100)
    expect(r.tasa).toBe(IVA_TASA_GT)
    expect(r.tasa).toBe(0.12)
    expect(r.iva).toBe(12)
    expect(r.total).toBe(112)
    expect(r.base).toBe(100)
  })

  it('respeta una tasa explícita (MX 16%)', () => {
    const r = calcularIVA(250, 0.16)
    expect(r.iva).toBe(40)
    expect(r.total).toBe(290)
  })

  it('tasa 0 = exento (NO cae al default)', () => {
    const r = calcularIVA(100, 0)
    expect(r.tasa).toBe(0)
    expect(r.iva).toBe(0)
    expect(r.total).toBe(100)
  })

  it('null/undefined → default GT (distinto de 0)', () => {
    expect(calcularIVA(100, null).iva).toBe(12)
    expect(calcularIVA(100, undefined).iva).toBe(12)
  })

  it('redondea el IVA a centavos', () => {
    // 33.33 * 0.12 = 3.9996 → 4.00
    const r = calcularIVA(33.33, 0.12)
    expect(r.iva).toBe(4.0)
    expect(r.total).toBe(37.33)
  })

  it('base negativa o no finita → 0', () => {
    expect(calcularIVA(-50).iva).toBe(0)
    expect(calcularIVA(-50).total).toBe(0)
    expect(calcularIVA(NaN).total).toBe(0)
  })

  it('tasa > 1 se recorta a 1 (error de captura)', () => {
    const r = calcularIVA(100, 1.2)
    expect(r.tasa).toBe(1)
    expect(r.iva).toBe(100)
  })

  it('tasa negativa → 0', () => {
    expect(calcularIVA(100, -0.5).iva).toBe(0)
  })
})

describe('calcularMora', () => {
  const reglaPct: ReglaMora = {
    tipo: 'porcentaje',
    valor: 5, // 5%
    aplicar_sobre: 'saldo_vencido',
    dias_vencimiento: 30,
    periodo_gracia: 0,
  }

  it('no aplica si no ha llegado al vencimiento', () => {
    const r = calcularMora(reglaPct, 20, 1000)
    expect(r.aplica).toBe(false)
    expect(r.diasAtraso).toBe(0)
    expect(r.monto).toBe(0)
    expect(r.motivo).toMatch(/no ha vencido/i)
  })

  it('no aplica exactamente en el día de vencimiento (diasAtraso = 0)', () => {
    const r = calcularMora(reglaPct, 30, 1000)
    expect(r.aplica).toBe(false)
    expect(r.diasAtraso).toBe(0)
  })

  it('aplica 5% sobre el saldo vencido tras pasar el vencimiento', () => {
    const r = calcularMora(reglaPct, 31, 1000)
    expect(r.aplica).toBe(true)
    expect(r.diasAtraso).toBe(1)
    expect(r.base).toBe(1000)
    expect(r.monto).toBe(50) // 1000 * 5%
  })

  it('respeta el periodo de gracia antes de cobrar', () => {
    const conGracia: ReglaMora = { ...reglaPct, periodo_gracia: 5 }
    // 33 días = 3 días de atraso, dentro de los 5 de gracia → no aplica
    expect(calcularMora(conGracia, 33, 1000).aplica).toBe(false)
    expect(calcularMora(conGracia, 33, 1000).motivo).toMatch(/gracia/i)
    // 36 días = 6 de atraso, supera la gracia → aplica
    expect(calcularMora(conGracia, 36, 1000).aplica).toBe(true)
  })

  it('monto_fijo ignora la base y cobra plano', () => {
    const fija: ReglaMora = { tipo: 'monto_fijo', valor: 75, dias_vencimiento: 30 }
    const r = calcularMora(fija, 45, 1000)
    expect(r.aplica).toBe(true)
    expect(r.monto).toBe(75)
  })

  it('monto_fijo aplica aunque el saldo sea 0', () => {
    const fija: ReglaMora = { tipo: 'monto_fijo', valor: 50, dias_vencimiento: 30 }
    const r = calcularMora(fija, 45, 0)
    expect(r.aplica).toBe(true)
    expect(r.monto).toBe(50)
  })

  it('porcentaje sobre saldo 0 no aplica (nada que recargar)', () => {
    const r = calcularMora(reglaPct, 45, 0)
    expect(r.aplica).toBe(false)
    expect(r.motivo).toMatch(/sin saldo/i)
  })

  it('aplicar_sobre = monto_cuota usa el monto de la cuota como base', () => {
    const sobreCuota: ReglaMora = { ...reglaPct, aplicar_sobre: 'monto_cuota' }
    // saldo parcial 200, pero la base es la cuota completa 1000
    const r = calcularMora(sobreCuota, 31, 200, 1000)
    expect(r.base).toBe(1000)
    expect(r.monto).toBe(50) // 1000 * 5%
  })

  it('valor 0 en la regla no cobra mora', () => {
    const cero: ReglaMora = { ...reglaPct, valor: 0 }
    const r = calcularMora(cero, 60, 1000)
    expect(r.aplica).toBe(false)
    expect(r.monto).toBe(0)
  })

  it('redondea el recargo porcentual a centavos', () => {
    // 333.33 * 5% = 16.6665 → 16.67
    const r = calcularMora(reglaPct, 31, 333.33)
    expect(r.monto).toBe(16.67)
  })
})

describe('calcularTotalFactura', () => {
  it('subtotal + IVA (12%) + mora', () => {
    const r = calcularTotalFactura(100, 0.12, 50)
    expect(r.subtotal).toBe(100)
    expect(r.iva_monto).toBe(12)
    expect(r.monto_con_iva).toBe(112)
    expect(r.mora_monto).toBe(50)
    expect(r.total_a_pagar).toBe(162)
  })

  it('sin mora (default 0)', () => {
    const r = calcularTotalFactura(200, 0.12)
    expect(r.mora_monto).toBe(0)
    expect(r.total_a_pagar).toBe(224)
  })

  it('IVA por defecto GT cuando la tasa es null', () => {
    const r = calcularTotalFactura(100, null)
    expect(r.iva_tasa).toBe(0.12)
    expect(r.total_a_pagar).toBe(112)
  })

  it('exento (tasa 0): total = subtotal + mora', () => {
    const r = calcularTotalFactura(100, 0, 10)
    expect(r.iva_monto).toBe(0)
    expect(r.total_a_pagar).toBe(110)
  })

  it('la mora NO genera IVA (se suma después del IVA)', () => {
    // IVA solo sobre 100 (12), mora 100 entra sin IVA → 112 + 100 = 212
    const r = calcularTotalFactura(100, 0.12, 100)
    expect(r.iva_monto).toBe(12)
    expect(r.total_a_pagar).toBe(212)
  })

  it('mora negativa se ignora', () => {
    const r = calcularTotalFactura(100, 0.12, -50)
    expect(r.mora_monto).toBe(0)
    expect(r.total_a_pagar).toBe(112)
  })
})

describe('normalizarEstadoFactura', () => {
  it('mantiene los estados canónicos', () => {
    for (const e of ['pendiente', 'emitida', 'pagada', 'vencida', 'anulada'] as const) {
      expect(normalizarEstadoFactura(e)).toBe(e)
    }
  })
  it('mapea legacy: pagado → pagada, mora → vencida', () => {
    expect(normalizarEstadoFactura('pagado')).toBe('pagada')
    expect(normalizarEstadoFactura('mora')).toBe('vencida')
  })
  it('null / desconocido → pendiente', () => {
    expect(normalizarEstadoFactura(null)).toBe('pendiente')
    expect(normalizarEstadoFactura(undefined)).toBe('pendiente')
    expect(normalizarEstadoFactura('lo_que_sea')).toBe('pendiente')
  })
})

describe('esEstadoTerminalFactura', () => {
  it('pagada y anulada son terminales (incl. legacy pagado)', () => {
    expect(esEstadoTerminalFactura('pagada')).toBe(true)
    expect(esEstadoTerminalFactura('pagado')).toBe(true)
    expect(esEstadoTerminalFactura('anulada')).toBe(true)
  })
  it('pendiente/emitida/vencida NO son terminales', () => {
    expect(esEstadoTerminalFactura('pendiente')).toBe(false)
    expect(esEstadoTerminalFactura('emitida')).toBe(false)
    expect(esEstadoTerminalFactura('vencida')).toBe(false)
    expect(esEstadoTerminalFactura('mora')).toBe(false) // legacy → vencida
  })
})

describe('puedeTransicionarFactura', () => {
  it('pendiente → emitir → emitida', () => {
    const r = puedeTransicionarFactura('pendiente', 'emitir')
    expect(r.ok).toBe(true)
    expect(r.estado).toBe('emitida')
  })
  it('emitida → pagar → pagada', () => {
    expect(puedeTransicionarFactura('emitida', 'pagar')).toEqual({ ok: true, estado: 'pagada' })
  })
  it('emitida → vencer → vencida', () => {
    expect(puedeTransicionarFactura('emitida', 'vencer')).toEqual({ ok: true, estado: 'vencida' })
  })
  it('vencida → pagar → pagada (se puede pagar una vencida)', () => {
    expect(puedeTransicionarFactura('vencida', 'pagar')).toEqual({ ok: true, estado: 'pagada' })
  })
  it('pendiente/emitida/vencida → anular → anulada', () => {
    expect(puedeTransicionarFactura('pendiente', 'anular').estado).toBe('anulada')
    expect(puedeTransicionarFactura('emitida', 'anular').estado).toBe('anulada')
    expect(puedeTransicionarFactura('vencida', 'anular').estado).toBe('anulada')
  })

  // Transiciones inválidas
  it('no se puede pagar una factura pendiente (hay que emitir primero)', () => {
    const r = puedeTransicionarFactura('pendiente', 'pagar')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/inválida/i)
  })
  it('no se puede vencer una factura pendiente', () => {
    expect(puedeTransicionarFactura('pendiente', 'vencer').ok).toBe(false)
  })
  it('pagada es terminal: ninguna acción aplica', () => {
    expect(puedeTransicionarFactura('pagada', 'anular').ok).toBe(false)
    expect(puedeTransicionarFactura('pagada', 'vencer').ok).toBe(false)
    expect(puedeTransicionarFactura('pagada', 'pagar').ok).toBe(false)
  })
  it('anulada es terminal: ninguna acción aplica', () => {
    expect(puedeTransicionarFactura('anulada', 'emitir').ok).toBe(false)
    expect(puedeTransicionarFactura('anulada', 'pagar').ok).toBe(false)
  })
  it('no se puede emitir una factura ya emitida', () => {
    expect(puedeTransicionarFactura('emitida', 'emitir').ok).toBe(false)
  })
  it('acepta estados legacy: mora (→vencida) puede pagar', () => {
    expect(puedeTransicionarFactura('mora', 'pagar')).toEqual({ ok: true, estado: 'pagada' })
  })
})

describe('aplicarTransicionFactura', () => {
  const T = '2026-06-04T12:00:00.000Z'

  it('emitir setea factura_estado + emitida_at', () => {
    const p = aplicarTransicionFactura('pendiente', 'emitir', T)
    expect(p).toEqual({ factura_estado: 'emitida', emitida_at: T })
  })
  it('pagar setea pagada_at', () => {
    const p = aplicarTransicionFactura('emitida', 'pagar', T)
    expect(p).toEqual({ factura_estado: 'pagada', pagada_at: T })
  })
  it('vencer setea vencida_at', () => {
    const p = aplicarTransicionFactura('emitida', 'vencer', T)
    expect(p).toEqual({ factura_estado: 'vencida', vencida_at: T })
  })
  it('anular setea anulada_at', () => {
    const p = aplicarTransicionFactura('vencida', 'anular', T)
    expect(p).toEqual({ factura_estado: 'anulada', anulada_at: T })
  })
  it('lanza en transición inválida', () => {
    expect(() => aplicarTransicionFactura('pagada', 'anular', T)).toThrow(/inválida/i)
    expect(() => aplicarTransicionFactura('pendiente', 'pagar', T)).toThrow()
  })
  it('usa new Date() por defecto cuando no se pasa `ahora`', () => {
    const before = Date.now()
    const p = aplicarTransicionFactura('pendiente', 'emitir')
    const stamped = new Date(p.emitida_at as string).getTime()
    expect(stamped).toBeGreaterThanOrEqual(before)
    expect(stamped).toBeLessThanOrEqual(Date.now())
  })
})

describe('generarCalendarioConvenio', () => {
  it('divide en N cuotas iguales; la última absorbe el residual (suma exacta)', () => {
    const cal = generarCalendarioConvenio(100, 3, '2026-01-15', 'mensual')
    expect(cal.map(c => c.monto)).toEqual([33.33, 33.33, 33.34])
    expect(cal.reduce((s, c) => s + c.monto, 0)).toBeCloseTo(100, 6)
    expect(cal.map(c => c.numero)).toEqual([1, 2, 3])
  })

  it('agenda mensual con clamp de fin de mes (31 ene → 28 feb → 31 mar)', () => {
    const cal = generarCalendarioConvenio(300, 3, '2026-01-31', 'mensual')
    expect(cal.map(c => c.fecha_vencimiento)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })

  it('frecuencia quincenal y semanal suman días', () => {
    expect(generarCalendarioConvenio(90, 3, '2026-01-01', 'quincenal').map(c => c.fecha_vencimiento))
      .toEqual(['2026-01-01', '2026-01-16', '2026-01-31'])
    expect(generarCalendarioConvenio(90, 3, '2026-01-01', 'semanal').map(c => c.fecha_vencimiento))
      .toEqual(['2026-01-01', '2026-01-08', '2026-01-15'])
  })

  it('cruza el año en frecuencia mensual', () => {
    const cal = generarCalendarioConvenio(200, 2, '2026-12-10', 'mensual')
    expect(cal.map(c => c.fecha_vencimiento)).toEqual(['2026-12-10', '2027-01-10'])
  })

  it('una sola cuota = el total completo', () => {
    expect(generarCalendarioConvenio(150.5, 1, '2026-03-01', 'mensual'))
      .toEqual([{ numero: 1, fecha_vencimiento: '2026-03-01', monto: 150.5 }])
  })

  it('entradas inválidas → []', () => {
    expect(generarCalendarioConvenio(100, 0, '2026-01-01')).toEqual([])
    expect(generarCalendarioConvenio(0, 3, '2026-01-01')).toEqual([])
    expect(generarCalendarioConvenio(100, 3, 'no-es-fecha')).toEqual([])
    expect(generarCalendarioConvenio(-50, 3, '2026-01-01')).toEqual([])
  })
})
