// Historial de consumo: leer fechas y números de una hoja llevada a mano, unir
// el historial importado con las lecturas del sistema y calcular contra qué
// comparar una lectura nueva.
import { describe, it, expect } from 'vitest'
import {
  claveSerie,
  fechaBaseDelHistorial,
  lotesPorContador,
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

describe('lotesPorContador', () => {
  const fila = (c: string, n: number) => ({ c, n })
  const clave = (f: { c: string }) => f.c

  it('no parte un contador entre lotes, aunque sus filas vengan intercaladas', () => {
    const filas = [fila('a', 1), fila('b', 1), fila('a', 2), fila('c', 1), fila('b', 2), fila('a', 3)]
    const lotes = lotesPorContador(filas, clave, 4)
    expect(lotes.map(l => l.map(f => `${f.c}${f.n}`))).toEqual([['a1', 'a2', 'a3'], ['b1', 'b2', 'c1']])
    for (const c of ['a', 'b', 'c']) expect(lotes.filter(l => l.some(f => f.c === c))).toHaveLength(1)
  })

  it('ningún lote pasa del máximo y no se pierde ni repite ninguna fila', () => {
    const filas = Array.from({ length: 1234 }, (_, i) => fila(`k${i % 37}`, i))
    const lotes = lotesPorContador(filas, clave, 100)
    expect(Math.max(...lotes.map(l => l.length))).toBeLessThanOrEqual(100)
    expect(lotes.flat().map(f => f.n).sort((x, y) => x - y)).toEqual(filas.map(f => f.n))
  })

  it('sólo parte al contador que no cabe en un lote', () => {
    const filas = [...Array.from({ length: 5 }, (_, i) => fila('grande', i)), fila('chico', 0)]
    expect(lotesPorContador(filas, clave, 2).map(l => l.map(f => f.c))).toEqual([
      ['grande', 'grande'], ['grande', 'grande'], ['grande'], ['chico'],
    ])
  })

  it('sin filas no hay lotes', () => {
    expect(lotesPorContador([], clave, 10)).toEqual([])
  })
})

describe('fechaBaseDelHistorial', () => {
  const h = [
    { fecha: '2026-08-25', lectura: 3354 },
    { fecha: '2026-10-25', lectura: 3407 },
    { fecha: '2026-09-25', lectura: 3381 },
  ]

  it('si la lectura inicial es la última del historial, la fecha es la de esa lectura', () => {
    expect(fechaBaseDelHistorial(h, 3407, '2024-01-14')).toBe('2026-10-25')
  })

  it('una fila más reciente sin lectura (sólo consumo) no cuenta', () => {
    expect(fechaBaseDelHistorial([...h, { fecha: '2026-11-10', lectura: null }], 3407, '2024-01-14')).toBe('2026-10-25')
  })

  it('si la lectura inicial no es la del historial, no hay fecha del historial', () => {
    expect(fechaBaseDelHistorial(h, 0, '2024-01-14')).toBeNull()
    expect(fechaBaseDelHistorial(h, 3381, '2024-01-14')).toBeNull()
  })

  it('si esa lectura es anterior a la instalación, tampoco', () => {
    expect(fechaBaseDelHistorial(h, 3407, '2026-11-01')).toBeNull()
    expect(fechaBaseDelHistorial(h, 3407, '2026-10-25')).toBe('2026-10-25')
    expect(fechaBaseDelHistorial(h, 3407, null)).toBe('2026-10-25')
  })

  it('sin historial no hay fecha', () => {
    expect(fechaBaseDelHistorial([], 0, '2024-01-14')).toBeNull()
  })
})
