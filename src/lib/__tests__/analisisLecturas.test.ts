import { describe, it, expect } from 'vitest'
import type { Registro, Contador } from '../../types'
import type { HistorialLectura } from '../../domain/agua/historialLecturas'
import {
  contadoresEnAlcance, diaDeLectura, etiquetaMes, filtrarPuntos, kpisAnalisis,
  lecturasDelMedidor, mesesAnteriores, mesesDelPeriodo, puntosDeAnalisis,
  rankingConsumo, resumenPorMes, seriesPorGrupo, type FiltroAnalisis,
} from '../analisisLecturas'

const contador = (id: string, extra: Partial<Contador> = {}): Contador => ({
  id, project_id: 'p1', company_id: 'c1', numero_serie: `S-${id}`, tipo_agua: 'potable',
  lectura_inicial: 0, activo: true, unidad_id: `u-${id}`, ...extra,
} as Contador)

const reg = (id: string, contadorId: string | null, fecha: string, consumo: number, lectura = 100, extra: Partial<Registro> = {}): Registro => ({
  id, cliente_id: 'cli', cliente_nombre: 'Cliente', contador_id: contadorId, project_id: 'p1',
  fecha, lectura_anterior: lectura - consumo, lectura_actual: lectura, consumo,
  tarifa_aplicada: 0, canon_aplicado: 0, monto_calculado: 0, tipo_cobro: '', estado: 'pendiente', ...extra,
} as Registro)

const hist = (id: string, contadorId: string, fecha: string, lectura: number | null, consumo: number | null = null): HistorialLectura => ({
  id, contador_id: contadorId, project_id: 'p1', fecha, lectura, consumo, notas: null,
})

const sinFiltro: FiltroAnalisis = { proyectoId: '', unidadIds: [], contadorIds: [], tipoAgua: '' }

describe('mesesDelPeriodo', () => {
  it('cuenta el mes actual y va del más viejo al más reciente', () => {
    expect(mesesDelPeriodo(3, new Date(2026, 10, 26))).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(mesesDelPeriodo(1, new Date(2026, 10, 26))).toEqual(['2026-11'])
  })

  it('cruza el año y no se desborda a fin de mes', () => {
    expect(mesesDelPeriodo(3, new Date(2026, 0, 31))).toEqual(['2025-11', '2025-12', '2026-01'])
    expect(mesesDelPeriodo(24, new Date(2026, 10, 26))).toHaveLength(24)
    expect(mesesDelPeriodo(24, new Date(2026, 10, 26))[0]).toBe('2024-12')
  })

  it('la ventana anterior tiene el mismo largo y termina justo antes', () => {
    expect(mesesAnteriores(['2026-09', '2026-10', '2026-11'])).toEqual(['2026-06', '2026-07', '2026-08'])
    expect(mesesAnteriores(['2026-01'])).toEqual(['2025-12'])
  })
})

describe('etiquetaMes y diaDeLectura', () => {
  it('etiqueta en español corto', () => {
    expect(etiquetaMes('2026-11')).toBe('nov 2026')
  })

  it('una fecha de calendario se toma tal cual; un instante, por su día local', () => {
    expect(diaDeLectura('2026-11-25')).toBe('2026-11-25')
    const instante = new Date(2026, 10, 25, 23, 30).toISOString()
    expect(diaDeLectura(instante)).toBe('2026-11-25')
    expect(diaDeLectura('')).toBeNull()
  })
})

describe('puntosDeAnalisis', () => {
  const contadores = new Map([['a', contador('a')], ['b', contador('b')]])

  it('el historial importado sólo cuenta antes del primer mes con lectura del sistema', () => {
    const puntos = puntosDeAnalisis(
      [reg('r1', 'a', '2026-10-20', 5, 120)],
      [
        hist('h1', 'a', '2026-08-20', 100),
        hist('h2', 'a', '2026-09-20', 115),
        hist('h3', 'a', '2026-10-01', 118), // mismo mes que la lectura del sistema: fuera
      ],
      contadores,
    )
    expect(puntos.map(p => [p.origen, p.mes, p.consumo])).toEqual([
      ['sistema', '2026-10', 5],
      ['historial', '2026-08', null], // primera del historial: sin anterior, sin consumo
      ['historial', '2026-09', 15], // deducido: 115 − 100
    ])
  })

  it('deja fuera las lecturas eliminadas y completa el proyecto desde el contador', () => {
    const puntos = puntosDeAnalisis(
      [
        reg('r1', 'a', '2026-10-20', 5, 120, { project_id: null }),
        reg('r2', 'a', '2026-11-20', 9, 129, { deleted_at: '2026-11-21' }),
      ],
      [],
      contadores,
    )
    expect(puntos).toHaveLength(1)
    expect(puntos[0].projectId).toBe('p1')
  })
})

describe('alcance y filtro', () => {
  const contadores = [
    contador('a', { unidad_id: 'u1' }),
    contador('b', { unidad_id: 'u2', tipo_agua: 'riego' }),
    contador('c', { unidad_id: 'u3', project_id: 'p2' }),
  ]

  it('filtra por proyecto, unidad, contador y tipo de agua', () => {
    expect(contadoresEnAlcance(contadores, { ...sinFiltro, proyectoId: 'p1' }).map(c => c.id)).toEqual(['a', 'b'])
    expect(contadoresEnAlcance(contadores, { ...sinFiltro, unidadIds: ['u2', 'u3'] }).map(c => c.id)).toEqual(['b', 'c'])
    expect(contadoresEnAlcance(contadores, { ...sinFiltro, contadorIds: ['c'] }).map(c => c.id)).toEqual(['c'])
    expect(contadoresEnAlcance(contadores, { ...sinFiltro, tipoAgua: 'riego' }).map(c => c.id)).toEqual(['b'])
  })

  it('una lectura sin contador sólo entra si el filtro no pide unidad, contador ni tipo', () => {
    const byId = new Map(contadores.map(c => [c.id, c]))
    const puntos = puntosDeAnalisis([reg('r1', null, '2026-11-01', 4), reg('r2', 'a', '2026-11-01', 3)], [], byId)
    const filtro = { ...sinFiltro, proyectoId: 'p1' }
    expect(filtrarPuntos(puntos, filtro, contadoresEnAlcance(contadores, filtro))).toHaveLength(2)
    const porUnidad = { ...filtro, unidadIds: ['u1'] }
    expect(filtrarPuntos(puntos, porUnidad, contadoresEnAlcance(contadores, porUnidad)).map(p => p.contadorId)).toEqual(['a'])
  })
})

describe('agregados', () => {
  const contadores = new Map([['a', contador('a')], ['b', contador('b')]])
  const puntos = puntosDeAnalisis(
    [
      reg('r1', 'a', '2026-09-20', 10),
      reg('r2', 'b', '2026-09-21', 4),
      reg('r3', 'a', '2026-11-20', 6),
      reg('r4', 'a', '2026-06-20', 8), // ventana anterior
    ],
    [hist('h1', 'b', '2026-07-01', 50), hist('h2', 'b', '2026-08-01', 62)],
    contadores,
  )
  const meses = ['2026-09', '2026-10', '2026-11']

  it('resume por mes, con ceros en los meses sin lecturas', () => {
    expect(resumenPorMes(puntos, meses)).toEqual([
      { mes: '2026-09', consumo: 14, consumoHistorial: 0, lecturas: 2, lecturasHistorial: 0, contadores: 2 },
      { mes: '2026-10', consumo: 0, consumoHistorial: 0, lecturas: 0, lecturasHistorial: 0, contadores: 0 },
      { mes: '2026-11', consumo: 6, consumoHistorial: 0, lecturas: 1, lecturasHistorial: 0, contadores: 1 },
    ])
  })

  it('separa lo que viene del historial importado', () => {
    const r = resumenPorMes(puntos, ['2026-07', '2026-08'])
    expect(r[1]).toMatchObject({ consumo: 12, consumoHistorial: 12, lecturas: 1, lecturasHistorial: 1 })
  })

  it('arma series y ranking por grupo', () => {
    const series = seriesPorGrupo(puntos, meses, p => p.contadorId)
    // Octubre no tiene lectura: hueco (null), no consumo cero.
    expect(series.get('a')).toEqual([10, null, 6])
    expect(series.get('b')).toEqual([4, null, null])
    expect(rankingConsumo(puntos, meses, p => p.contadorId)).toEqual([
      { clave: 'a', consumo: 16, lecturas: 2 },
      { clave: 'b', consumo: 4, lecturas: 1 },
    ])
  })

  it('calcula los KPIs y la variación contra la ventana anterior', () => {
    const k = kpisAnalisis(puntos, meses)
    expect(k.consumoTotal).toBe(20)
    expect(k.promedioMensual).toBe(6.67)
    expect(k.lecturas).toBe(3)
    expect(k.contadoresLeidos).toBe(2)
    expect(k.mesPico).toEqual({ mes: '2026-09', consumo: 14 })
    // Jun–ago: 8 del sistema + 12 deducidos del historial = 20 → sin cambio.
    expect(k.consumoPeriodoAnterior).toBe(20)
    expect(k.variacion).toBe(0)
  })

  it('sin consumo en la ventana anterior no hay variación', () => {
    expect(kpisAnalisis(puntos, ['2026-06']).variacion).toBeNull()
  })

  it('lecturas del medidor de un contador, ordenadas por fecha', () => {
    expect(lecturasDelMedidor(puntos, 'a', meses).map(l => l.dia)).toEqual(['2026-09-20', '2026-11-20'])
  })
})
