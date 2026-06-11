import { describe, it, expect } from 'vitest'
import {
  agruparVisitantes,
  filtrarVisitantes,
  kpisVisitantes,
  rangosDeFecha,
  sugerenciasVisitantes,
} from '../visitantesFiltros'
import type { ReservaSTR, SolicitudMudanzaUnidad, Visitante } from '../../types'

function visitante(partial: Partial<Visitante>): Visitante {
  return {
    id: 'v1', nombre: 'Juan Pérez', identificacion: '1234567890101',
    hora_entrada: '2026-06-11T10:00:00', hora_salida: null,
    visitante_principal_id: null, reserva_str_id: null, solicitud_mudanza_id: null,
    ...partial,
  } as Visitante
}

describe('rangosDeFecha', () => {
  it('calcula hoy, lunes de la semana y día 1 del mes', () => {
    const r = rangosDeFecha(new Date('2026-06-11T12:00:00Z')) // jueves
    expect(r.hoy).toBe('2026-06-11')
    expect(r.inicioSemana).toBe('2026-06-08')
    expect(r.inicioMes).toBe('2026-06-01')
  })

  it('en domingo retrocede al lunes anterior', () => {
    expect(rangosDeFecha(new Date('2026-06-14T12:00:00Z')).inicioSemana).toBe('2026-06-08')
  })
})

describe('kpisVisitantes', () => {
  const rangos = rangosDeFecha(new Date('2026-06-11T12:00:00Z'))
  const lista = [
    visitante({ id: 'a', hora_entrada: '2026-06-11T08:00:00' }),
    visitante({ id: 'b', hora_entrada: '2026-06-09T08:00:00', hora_salida: '2026-06-09T10:00:00' }),
    visitante({ id: 'c', hora_entrada: '2026-05-01T08:00:00', hora_salida: '2026-05-01T10:00:00' }),
    // acompañante: no cuenta en visitas/semana/histórico, pero SÍ en premisas
    visitante({ id: 'd', visitante_principal_id: 'a', hora_entrada: '2026-06-11T08:00:00' }),
  ]

  it('los acompañantes no duplican KPIs pero cuentan en premisas', () => {
    const k = kpisVisitantes(lista, rangos)
    expect(k.visitasHoy).toBe(1)
    expect(k.estaSemana).toBe(2)
    expect(k.totalHistorico).toBe(3)
    expect(k.enPremisas).toBe(2) // a + d sin hora_salida
  })
})

describe('sugerenciasVisitantes', () => {
  const lista = [
    visitante({ id: 'a', nombre: 'María López', hora_entrada: '2026-06-01T08:00:00' }),
    visitante({ id: 'b', nombre: 'María López', hora_entrada: '2026-06-10T08:00:00' }), // duplicada, más reciente
    visitante({ id: 'c', nombre: 'Mario Ruiz', identificacion: '9999', hora_entrada: '2026-06-05T08:00:00' }),
    visitante({ id: 'd', nombre: 'Pedro (acomp)', visitante_principal_id: 'a' }),
  ]

  it('requiere mínimo 3 caracteres', () => {
    expect(sugerenciasVisitantes(lista, 'Ma', '')).toEqual([])
  })

  it('deduplica por nombre+identificación y prioriza recientes', () => {
    const s = sugerenciasVisitantes(lista, 'mar', '')
    expect(s.map(v => v.id)).toEqual(['b', 'c'])
  })

  it('busca también por identificación y excluye acompañantes ya agregados', () => {
    expect(sugerenciasVisitantes(lista, '', '9999').map(v => v.id)).toEqual(['c'])
    expect(sugerenciasVisitantes(lista, 'mar', '', ['Mario Ruiz']).map(v => v.id)).toEqual(['b'])
  })
})

describe('filtrarVisitantes', () => {
  const rangos = rangosDeFecha(new Date('2026-06-11T12:00:00Z'))
  const lista = [
    visitante({ id: 'hoy', hora_entrada: '2026-06-11T08:00:00' }),
    visitante({ id: 'semana', hora_entrada: '2026-06-09T08:00:00', hora_salida: '2026-06-09T09:00:00' }),
    visitante({ id: 'mes', hora_entrada: '2026-06-02T08:00:00', hora_salida: '2026-06-02T09:00:00' }),
    visitante({ id: 'viejo', hora_entrada: '2026-04-01T08:00:00', hora_salida: '2026-04-01T09:00:00' }),
  ]

  it('filtra por periodo', () => {
    const f = (filtroFecha: 'hoy' | 'semana' | 'mes' | 'todos') =>
      filtrarVisitantes(lista, { busqueda: '', soloActivos: false, filtroFecha, rangos }).map(v => v.id)
    expect(f('hoy')).toEqual(['hoy'])
    expect(f('semana')).toEqual(['hoy', 'semana'])
    expect(f('mes')).toEqual(['hoy', 'semana', 'mes'])
    expect(f('todos')).toHaveLength(4)
  })

  it('soloActivos deja únicamente a quienes no han salido', () => {
    const ids = filtrarVisitantes(lista, { busqueda: '', soloActivos: true, filtroFecha: 'todos', rangos }).map(v => v.id)
    expect(ids).toEqual(['hoy'])
  })

  it('búsqueda por nombre o identificación', () => {
    const ids = filtrarVisitantes(lista, { busqueda: '123456', soloActivos: false, filtroFecha: 'todos', rangos })
    expect(ids).toHaveLength(4) // todas comparten la identificación del fixture
    expect(filtrarVisitantes(lista, { busqueda: 'nadie', soloActivos: false, filtroFecha: 'todos', rangos })).toEqual([])
  })
})

describe('agruparVisitantes', () => {
  const reserva = { id: 'str1' } as ReservaSTR
  const solicitud = { id: 'mud1' } as SolicitudMudanzaUnidad
  const lista = [
    visitante({ id: 'r1' }),
    visitante({ id: 's1', reserva_str_id: 'str1' }),
    visitante({ id: 's2', reserva_str_id: 'str1' }),
    visitante({ id: 'm1', solicitud_mudanza_id: 'mud1' }),
    visitante({ id: 'huerfano', reserva_str_id: 'str-borrada' }),
  ]

  it('agrupa por reserva y mudanza; las referencias rotas caen a regulares', () => {
    const g = agruparVisitantes(lista, [reserva], [solicitud])
    expect(g.strGruposMap.get('str1')!.miembros.map(v => v.id)).toEqual(['s1', 's2'])
    expect(g.mudanzaGruposMap.get('mud1')!.miembros.map(v => v.id)).toEqual(['m1'])
    expect(g.regulares.map(v => v.id)).toEqual(['r1', 'huerfano'])
  })
})
