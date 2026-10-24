import { describe, it, expect } from 'vitest'
import {
  buscarVisitasFrecuentes,
  describirAutorizacionResidente,
  describirDias,
  describirHorario,
  describirVigencia,
  diaSemanaLocal,
  estadoVisita,
  evaluarVisitaFrecuente,
  horaDentroDeFranja,
  horaHHMM,
} from '../visitasFrecuentes'
import type { VisitaFrecuente } from '../../types'

function vf(partial: Partial<VisitaFrecuente>): VisitaFrecuente {
  return {
    id: 'vf1', company_id: 'c1', project_id: 'p1', unidad_id: 'u1',
    nombre: 'María López', identificacion: '1234 56789 0101', relacion: 'empleado',
    placa_vehiculo: null, dias_permitidos: null, hora_desde: null, hora_hasta: null,
    activo: true, estado: 'aprobada', created_at: '2026-10-01T00:00:00Z',
    ...partial,
  } as VisitaFrecuente
}

// Martes 2026-10-27 a las 10:30 LOCAL (new Date con componentes = hora local).
const martes1030 = new Date(2026, 9, 27, 10, 30)

describe('estadoVisita', () => {
  it('lee las filas sin estado (anteriores a la migración) como aprobadas', () => {
    expect(estadoVisita({ estado: undefined })).toBe('aprobada')
    expect(estadoVisita({ estado: 'pendiente' })).toBe('pendiente')
  })
})

describe('diaSemanaLocal / horaHHMM', () => {
  it('mapea getDay (domingo = 0) al orden lunes…domingo', () => {
    expect(diaSemanaLocal(new Date(2026, 9, 25))).toBe('domingo')
    expect(diaSemanaLocal(new Date(2026, 9, 26))).toBe('lunes')
    expect(diaSemanaLocal(martes1030)).toBe('martes')
  })
  it('acepta la hora de Postgres (HH:MM:SS) y la del input (HH:MM)', () => {
    expect(horaHHMM('08:00:00')).toBe('08:00')
    expect(horaHHMM('8:05')).toBe('08:05')
    expect(horaHHMM('')).toBeNull()
    expect(horaHHMM(null)).toBeNull()
  })
})

describe('horaDentroDeFranja', () => {
  it('franja normal, abierta por un lado y nocturna', () => {
    expect(horaDentroDeFranja('10:30', '08:00', '17:00')).toBe(true)
    expect(horaDentroDeFranja('17:01', '08:00', '17:00')).toBe(false)
    expect(horaDentroDeFranja('07:00', '08:00', null)).toBe(false)
    expect(horaDentroDeFranja('23:00', null, '17:00')).toBe(false)
    expect(horaDentroDeFranja('23:00', '22:00', '06:00')).toBe(true)
    expect(horaDentroDeFranja('03:00', '22:00', '06:00')).toBe(true)
    expect(horaDentroDeFranja('12:00', '22:00', '06:00')).toBe(false)
    expect(horaDentroDeFranja('12:00', null, null)).toBe(true)
  })
})

describe('describir*', () => {
  it('resume días, horario y vigencia', () => {
    expect(describirDias({ dias_permitidos: null })).toBe('Todos los días')
    expect(describirDias({ dias_permitidos: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'] })).toBe('L–V')
    expect(describirDias({ dias_permitidos: ['viernes', 'lunes', 'miercoles'] })).toBe('L, X, V')
    expect(describirHorario({ hora_desde: '08:00:00', hora_hasta: '17:00:00' })).toBe('08:00–17:00')
    expect(describirHorario({ hora_desde: null, hora_hasta: null })).toBe('Cualquier hora')
    expect(describirVigencia({ vigente_desde: null, vigente_hasta: '2026-12-31' })).toBe('Hasta 2026-12-31')
    expect(describirVigencia({ vigente_desde: null, vigente_hasta: null })).toBe('')
  })
})

describe('evaluarVisitaFrecuente', () => {
  it('cumple cuando está aprobada, activa, vigente y dentro de día y horario', () => {
    const ev = evaluarVisitaFrecuente(vf({
      dias_permitidos: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'],
      hora_desde: '08:00:00', hora_hasta: '17:00:00', vigente_hasta: '2026-12-31',
    }), martes1030)
    expect(ev.cumple).toBe(true)
    expect(ev.motivos).toEqual([])
    expect(ev.autorizado).toBe('L–V · 08:00–17:00 · Hasta 2026-12-31')
  })

  it('sin restricciones cumple cualquier día y hora', () => {
    expect(evaluarVisitaFrecuente(vf({}), new Date(2026, 9, 25, 23, 59)).cumple).toBe(true)
  })

  it('acumula TODOS los motivos: día, horario y vigencia a la vez', () => {
    const ev = evaluarVisitaFrecuente(vf({
      dias_permitidos: ['sabado', 'domingo'], hora_desde: '14:00', hora_hasta: '18:00', vigente_hasta: '2026-10-20',
    }), martes1030)
    expect(ev.cumple).toBe(false)
    expect(ev.motivos).toEqual([
      'La autorización venció el 2026-10-20',
      'Hoy es martes y solo tiene autorizado S, D',
      'Son las 10:30 y su horario autorizado es 14:00–18:00',
    ])
  })

  it('pendiente, rechazada o suspendida nunca cumplen', () => {
    expect(evaluarVisitaFrecuente(vf({ estado: 'pendiente' }), martes1030).motivos).toEqual(['La administración aún no aprueba esta autorización'])
    expect(evaluarVisitaFrecuente(vf({ estado: 'rechazada', motivo_rechazo: 'sin DPI' }), martes1030).motivos)
      .toEqual(['La administración rechazó esta autorización (sin DPI)'])
    expect(evaluarVisitaFrecuente(vf({ activo: false }), martes1030).motivos).toEqual(['La autorización está suspendida'])
  })

  it('todavía no vigente', () => {
    expect(evaluarVisitaFrecuente(vf({ vigente_desde: '2026-11-01' }), martes1030).motivos).toEqual(['La autorización inicia el 2026-11-01'])
  })
})

describe('buscarVisitasFrecuentes', () => {
  const lista = [
    vf({ id: 'a', nombre: 'María López', identificacion: '1234 56789 0101', unidad_id: 'u1' }),
    vf({ id: 'b', nombre: 'Mario Pérez', identificacion: null, estado: 'pendiente', unidad_id: 'u2' }),
    vf({ id: 'c', nombre: 'Marisol Díaz', identificacion: null, activo: false, placa_vehiculo: 'P-123ABC', unidad_id: 'u1' }),
  ]
  it('exige 3 caracteres', () => {
    expect(buscarVisitasFrecuentes(lista, { nombre: 'Ma' })).toEqual([])
  })
  it('busca por nombre sin acentos ni mayúsculas, aprobadas y activas primero', () => {
    expect(buscarVisitasFrecuentes(lista, { nombre: 'mari' }).map(v => v.id)).toEqual(['a', 'b', 'c'])
  })
  it('busca por identificación y placa ignorando espacios y guiones', () => {
    expect(buscarVisitasFrecuentes(lista, { identificacion: '123456789' }).map(v => v.id)).toEqual(['a'])
    expect(buscarVisitasFrecuentes(lista, { placa: 'p123' }).map(v => v.id)).toEqual(['c'])
  })
  it('acota por unidad', () => {
    expect(buscarVisitasFrecuentes(lista, { nombre: 'mari', unidadId: 'u2' }).map(v => v.id)).toEqual(['b'])
  })
})

describe('describirAutorizacionResidente', () => {
  it('deja escrito qué incumplía y quién autorizó', () => {
    const ev = evaluarVisitaFrecuente(vf({ hora_desde: '14:00', hora_hasta: '18:00' }), martes1030)
    expect(describirAutorizacionResidente(ev, { decision: 'autoriza', medio: 'llamada', quien: 'Ana', comentario: 'viene por llaves' }))
      .toBe('Fuera de lo autorizado: Son las 10:30 y su horario autorizado es 14:00–18:00 · Autorizó el residente (Ana) por llamada telefónica · viene por llaves')
  })
  it('registra la negativa', () => {
    expect(describirAutorizacionResidente(null, { decision: 'deniega', medio: 'intercom', quien: '', comentario: '' }))
      .toBe('El residente NO autorizó el ingreso por intercomunicador')
  })
})
