import { describe, it, expect } from 'vitest'
import { intervaloTipico, planPorTipo, resumenProyeccion, masRecientePrimero } from '../plagas'
import type { ControlPlagas } from '../../../types'

let n = 0
function visita(over: Partial<ControlPlagas>): ControlPlagas {
  n += 1
  return {
    id: `v${n}`, company_id: 'co1', project_id: 'p1', tipo: 'fumigacion', empresa: null, tecnico: null,
    areas: ['Lobby'], productos: null, fecha: '2026-10-01', hora_inicio: null, hora_fin: null,
    resultado: 'satisfactorio', proxima_visita: null, costo: null, observaciones: null,
    created_at: '2026-10-01T10:00:00Z',
    ...over,
  } as ControlPlagas
}

const HOY = '2026-10-23'

describe('intervaloTipico', () => {
  it('es la mediana de los intervalos entre visitas realizadas: una extra no la mueve', () => {
    expect(intervaloTipico([
      visita({ fecha: '2026-06-01' }), visita({ fecha: '2026-06-29' }), visita({ fecha: '2026-07-01' }), // extra
      visita({ fecha: '2026-08-04' }), visita({ fecha: '2026-09-08' }),
    ])).toBe(31) // intervalos 28, 2, 34, 35 → mediana (28 + 34) / 2
  })

  it('no cuenta las no realizadas ni dos registros del mismo día', () => {
    expect(intervaloTipico([
      visita({ fecha: '2026-08-01' }), visita({ fecha: '2026-08-01' }),
      visita({ fecha: '2026-08-20', resultado: 'no_realizado' }),
      visita({ fecha: '2026-09-15' }),
    ])).toBe(45)
  })

  it('usa sólo los intervalos recientes: si la frecuencia cambió, sigue a la nueva', () => {
    const trimestral = ['2024-04-01', '2024-07-01', '2024-10-01', '2025-01-01', '2025-04-01', '2025-07-01', '2025-10-01']
    const mensual = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01']
    // Los seis últimos: 31, 28, 31, 30, 31, 30 → 30.5 → 31. Con todo el
    // historial (siete intervalos de ~91 días) la mediana sería trimestral.
    expect(intervaloTipico([...trimestral, ...mensual].map(fecha => visita({ fecha })))).toBe(31)
  })

  it('con una sola visita usa el plazo que se dejó programado; sin nada, null', () => {
    expect(intervaloTipico([visita({ fecha: '2026-10-01', proxima_visita: '2026-12-30' })])).toBe(90)
    expect(intervaloTipico([visita({ fecha: '2026-10-01' })])).toBeNull()
    expect(intervaloTipico([])).toBeNull()
  })
})

describe('planPorTipo', () => {
  it('cada tipo tiene su propia próxima visita: una inspección no borra la fumigación', () => {
    const planes = planPorTipo([
      visita({ tipo: 'inspeccion', fecha: '2026-10-20' }), // más reciente, sin programar
      visita({ tipo: 'fumigacion', fecha: '2026-10-01', proxima_visita: '2026-10-31' }),
    ], HOY)
    const fumigacion = planes.find(p => p.tipo === 'fumigacion')!
    expect(fumigacion).toMatchObject({ proxima: '2026-10-31', origen: 'programada', intervaloDias: 30 })
    expect(planes.find(p => p.tipo === 'inspeccion')).toMatchObject({ proxima: null, origen: null, intervaloDias: null })
    expect(planes.map(p => p.tipo)).toEqual(['fumigacion', 'inspeccion']) // sin fecha, al final
  })

  it('sin programar, la probable es la última realizada más su frecuencia', () => {
    const [plan] = planPorTipo([
      visita({ fecha: '2026-08-10' }), visita({ fecha: '2026-09-10' }), visita({ fecha: '2026-10-10' }),
    ], HOY)
    expect(plan).toMatchObject({ proxima: '2026-11-10', origen: 'probable', intervaloDias: 31 })
    expect(plan.siguientes).toEqual(['2026-12-11', '2027-01-11'])
  })

  it('manda lo programado en la última visita del tipo, no en las anteriores', () => {
    const [plan] = planPorTipo([
      visita({ fecha: '2026-09-01', proxima_visita: '2026-10-01' }),
      visita({ fecha: '2026-10-01', proxima_visita: '2026-11-15' }),
    ], HOY)
    expect(plan.ultima.fecha).toBe('2026-10-01')
    expect(plan).toMatchObject({ proxima: '2026-11-15', origen: 'programada' })
  })

  it('si la última no se realizó y no dejó fecha, la probable sale de la última realizada (y ya está atrasada)', () => {
    const [plan] = planPorTipo([
      visita({ fecha: '2026-08-01' }), visita({ fecha: '2026-09-01' }),
      visita({ fecha: '2026-10-01', resultado: 'no_realizado' }),
    ], HOY)
    expect(plan.ultima.resultado).toBe('no_realizado')
    expect(plan).toMatchObject({ proxima: '2026-10-02', origen: 'probable' })
  })

  it('con la próxima atrasada, las siguientes se cuentan desde hoy', () => {
    const [plan] = planPorTipo([visita({ fecha: '2026-09-01', proxima_visita: '2026-10-01' })], HOY)
    expect(plan.intervaloDias).toBe(30)
    expect(plan.siguientes).toEqual(['2026-11-22', '2026-12-22', '2027-01-21'])
  })

  it('el mismo día, la última es la que se capturó después', () => {
    const planes = planPorTipo([
      visita({ fecha: '2026-10-20', created_at: '2026-10-20T15:00:00Z', proxima_visita: '2026-11-20' }),
      visita({ fecha: '2026-10-20', created_at: '2026-10-20T09:00:00Z', proxima_visita: '2026-12-20' }),
    ], HOY)
    expect(planes[0].proxima).toBe('2026-11-20')
  })

  it('el costo promedio es el de las visitas recientes con costo', () => {
    const [plan] = planPorTipo([
      visita({ fecha: '2026-01-01', costo: 9999 }), // más de seis atrás: no cuenta
      ...['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'].map(fecha => visita({ fecha, costo: 400 })),
      visita({ fecha: '2026-08-01', costo: null }),
    ], HOY)
    expect(plan.costoPromedio).toBe(400)
  })
})

describe('resumenProyeccion', () => {
  it('cuenta las visitas hasta el horizonte (la atrasada también) y su costo estimado', () => {
    const planes = planPorTipo([
      // Fumigación cada 30 días, atrasada: 2026-10-01 (pendiente) + 3 desde hoy.
      visita({ tipo: 'fumigacion', fecha: '2026-09-01', proxima_visita: '2026-10-01', costo: 500 }),
      // Inspección trimestral sin costo: una dentro de 90 días.
      visita({ tipo: 'inspeccion', fecha: '2026-08-01', proxima_visita: '2026-11-01' }),
      // Preventivo programado fuera del horizonte: no cuenta.
      visita({ tipo: 'preventivo', fecha: '2026-10-01', proxima_visita: '2027-06-01', costo: 100 }),
    ], HOY)
    expect(resumenProyeccion(planes, HOY)).toEqual({ visitas: 5, costo: 2000, sinCosto: 1 })
  })

  it('sin próxima visita no se proyecta nada', () => {
    expect(resumenProyeccion(planPorTipo([visita({})], HOY), HOY)).toEqual({ visitas: 0, costo: 0, sinCosto: 0 })
  })
})

describe('masRecientePrimero', () => {
  it('ordena por fecha y desempata por la hora de captura', () => {
    const a = visita({ fecha: '2026-10-01', created_at: '2026-10-01T08:00:00Z' })
    const b = visita({ fecha: '2026-10-01', created_at: '2026-10-01T09:00:00Z' })
    const c = visita({ fecha: '2026-09-30' })
    expect([a, c, b].sort(masRecientePrimero)).toEqual([b, a, c])
  })
})
