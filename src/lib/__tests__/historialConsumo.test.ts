// Historial de consumo: leer fechas y números de una hoja llevada a mano, unir
// el historial importado con las lecturas del sistema y calcular contra qué
// comparar una lectura nueva.
import { describe, it, expect } from 'vitest'
import {
  claveSerie,
  estadisticasConsumo,
  leerNumeroHistorial,
  normalizarFechaHistorial,
  serieConsumo,
} from '../historialConsumo'

describe('normalizarFechaHistorial', () => {
  it('acepta AAAA-MM-DD, DD/MM/AAAA y la fecha de Excel (número de serie u objeto Date)', () => {
    expect(normalizarFechaHistorial('2025-10-31')).toBe('2025-10-31')
    expect(normalizarFechaHistorial('2025-1-5')).toBe('2025-01-05')
    expect(normalizarFechaHistorial('31/10/2025')).toBe('2025-10-31')
    expect(normalizarFechaHistorial('5-1-2025')).toBe('2025-01-05')
    expect(normalizarFechaHistorial(45961)).toBe('2025-10-31')
    expect(normalizarFechaHistorial(new Date(2025, 9, 31))).toBe('2025-10-31')
  })

  it('sólo el mes (AAAA-MM o MM/AAAA) se guarda como el día 1', () => {
    expect(normalizarFechaHistorial('2025-11')).toBe('2025-11-01')
    expect(normalizarFechaHistorial('11/2025')).toBe('2025-11-01')
  })

  it('rechaza lo que no es una fecha real', () => {
    expect(normalizarFechaHistorial('31/02/2025')).toBeNull()
    expect(normalizarFechaHistorial('2025-13-01')).toBeNull()
    expect(normalizarFechaHistorial('noviembre')).toBeNull()
    expect(normalizarFechaHistorial('')).toBeNull()
    expect(normalizarFechaHistorial(null)).toBeNull()
  })
})

describe('leerNumeroHistorial', () => {
  it('acepta números, coma decimal y espacios; vacío es null y el texto es NaN', () => {
    expect(leerNumeroHistorial(1520.5)).toBe(1520.5)
    expect(leerNumeroHistorial(' 1520,5 ')).toBe(1520.5)
    expect(leerNumeroHistorial('1 520')).toBe(1520)
    expect(leerNumeroHistorial('')).toBeNull()
    expect(leerNumeroHistorial(undefined)).toBeNull()
    expect(leerNumeroHistorial('doce')).toBeNaN()
  })
})

it('claveSerie compara sin mayúsculas ni espacios en los bordes', () => {
  expect(claveSerie(' 21b-001 ')).toBe(claveSerie('21B-001'))
})

describe('serieConsumo', () => {
  it('une historial y sistema por fecha y completa el consumo con la lectura anterior', () => {
    const serie = serieConsumo(
      [
        { fecha: '2025-10-31', lectura: 100, consumo: null },
        { fecha: '2025-11-30', lectura: 112, consumo: null },
        { fecha: '2025-12-31', lectura: null, consumo: 9 },
      ],
      [{ fecha: '2026-01-15T12:00:00-06:00', lectura_actual: 130, consumo: 18 }],
    )
    expect(serie.map(p => [p.fecha, p.consumo, p.origen])).toEqual([
      ['2025-10-31', null, 'historial'],
      ['2025-11-30', 12, 'historial'],
      ['2025-12-31', 9, 'historial'],
      ['2026-01-15', 18, 'sistema'],
    ])
  })

  it('si las dos fuentes traen la misma fecha gana la del sistema', () => {
    const serie = serieConsumo(
      [{ fecha: '2026-01-15', lectura: 999, consumo: 99 }],
      [{ fecha: '2026-01-15T12:00:00', lectura_actual: 130, consumo: 18 }],
    )
    expect(serie).toEqual([{ fecha: '2026-01-15', lectura: 130, consumo: 18, origen: 'sistema' }])
  })

  it('una lectura más baja (medidor reiniciado) deja el consumo sin inventar', () => {
    const serie = serieConsumo(
      [
        { fecha: '2025-10-31', lectura: 900, consumo: null },
        { fecha: '2025-11-30', lectura: 5, consumo: null },
        { fecha: '2025-12-31', lectura: 17, consumo: null },
      ],
      [],
    )
    expect(serie.map(p => p.consumo)).toEqual([null, null, 12])
  })
})

describe('estadisticasConsumo', () => {
  const serie = serieConsumo(
    [
      { fecha: '2025-11-30', lectura: null, consumo: 9 },
      { fecha: '2026-04-30', lectura: null, consumo: 40 },
      { fecha: '2026-05-31', lectura: null, consumo: 10 },
      { fecha: '2026-06-30', lectura: null, consumo: 12 },
      { fecha: '2026-07-31', lectura: null, consumo: 0 },
      { fecha: '2026-08-31', lectura: null, consumo: 8 },
      { fecha: '2026-09-30', lectura: null, consumo: 10 },
      { fecha: '2026-10-31', lectura: null, consumo: 10 },
    ],
    [{ fecha: '2026-11-20T12:00:00', lectura_actual: 500, consumo: 100 }],
  )

  it('promedia los últimos 6 consumos ANTES de la fecha, sin contar los ceros', () => {
    const e = estadisticasConsumo(serie, '2026-11-17')
    // 40, 10, 12, 8, 10, 10 → 15; el 0 de julio no cuenta y el 100 es posterior.
    expect(e.promedioReciente).toBe(15)
    expect(e.nReciente).toBe(6)
    expect(e.nHistorial).toBe(8)
  })

  it('compara con el mismo mes del año anterior', () => {
    const e = estadisticasConsumo(serie, '2026-11-17')
    expect(e.mismoMesAnterior).toBe(9)
    expect(e.etiquetaMismoMes).toBe('nov 2025')
    expect(estadisticasConsumo(serie, '2026-12-10').mismoMesAnterior).toBeNull()
  })

  it('sin datos previos no hay promedio', () => {
    expect(estadisticasConsumo([], '2026-11-17')).toEqual({
      promedioReciente: null, nReciente: 0, mismoMesAnterior: null, etiquetaMismoMes: null, nHistorial: 0,
    })
  })
})
