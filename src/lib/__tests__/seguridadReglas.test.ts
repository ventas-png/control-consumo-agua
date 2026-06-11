import { describe, it, expect } from 'vitest'
import {
  calcularFotosExpiradas,
  duracionRondaMin,
  filtrarReservasSTRAcceso,
  nochesReserva,
  progresoRonda,
  separarDescripcionNovedad,
} from '../seguridadReglas'
import type { PuntoControlRuta, ReservaSTR, VisitaControl, Visitante } from '../../types'

const AHORA = new Date('2026-06-11T12:00:00Z').getTime()

function visita(partial: Partial<VisitaControl>): VisitaControl {
  return { id: 'v1', ronda_id: 'r1', punto_id: 'p1', estado: 'pendiente', ...partial } as VisitaControl
}

function punto(id: string): PuntoControlRuta {
  return { id, ruta_id: 'rt1', orden: 1 } as PuntoControlRuta
}

function reserva(partial: Partial<ReservaSTR>): ReservaSTR {
  return {
    id: 'r1', huesped_nombre: 'Ana', fecha_entrada: '2026-06-11', fecha_salida: '2026-06-13',
    estado: 'confirmada', plataforma: 'airbnb', num_adultos: 2, num_ninos: 0,
    ...partial,
  } as ReservaSTR
}

function visitante(partial: Partial<Visitante>): Visitante {
  return { id: 'v1', nombre: 'Ana', hora_entrada: '2026-06-01T10:00:00Z', ...partial } as Visitante
}

describe('progresoRonda / duracionRondaMin / nochesReserva', () => {
  it('progreso cuenta visitas no pendientes sobre el total de puntos', () => {
    const puntos = [punto('p1'), punto('p2'), punto('p3'), punto('p4')]
    const visitas = [visita({ estado: 'ok' }), visita({ id: 'v2', estado: 'novedad' }), visita({ id: 'v3' })]
    expect(progresoRonda(puntos, visitas)).toEqual({ completados: 2, progreso: 50 })
    expect(progresoRonda([], [])).toEqual({ completados: 0, progreso: 0 })
  })

  it('duración usa fin si existe, si no usa ahora', () => {
    expect(duracionRondaMin('2026-06-11T10:00:00Z', '2026-06-11T10:45:00Z', AHORA)).toBe(45)
    expect(duracionRondaMin('2026-06-11T11:30:00Z', null, AHORA)).toBe(30)
  })

  it('noches entre entrada y salida, nunca negativas', () => {
    expect(nochesReserva('2026-06-11', '2026-06-13')).toBe(2)
    expect(nochesReserva('2026-06-13', '2026-06-11')).toBe(0)
  })
})

describe('calcularFotosExpiradas', () => {
  it('marca expiradas las fotos cuyo registro más reciente supera 90 días', () => {
    const viejo = visitante({ id: 'a', hora_entrada: '2025-12-01T10:00:00Z', foto_url: 'x', foto_vehiculo_url: 'z' })
    const reciente = visitante({ id: 'b', hora_entrada: '2026-06-01T10:00:00Z', foto_documento_url: 'y' })
    // El historial llega ordenado del más reciente al más viejo
    const r = calcularFotosExpiradas([reciente, viejo], AHORA)
    expect(r).toEqual({ foto: true, documento: false, vehiculo: true })
  })

  it('sin fotos en el historial nada se marca', () => {
    expect(calcularFotosExpiradas([visitante({})], AHORA)).toEqual({ foto: false, documento: false, vehiculo: false })
  })
})

describe('filtrarReservasSTRAcceso', () => {
  const hoy = '2026-06-11'

  it('excluye canceladas/completadas, vencidas y ya ingresadas', () => {
    const rs = [
      reserva({ id: 'ok' }),
      reserva({ id: 'cancelada', estado: 'cancelada' }),
      reserva({ id: 'vencida', fecha_salida: '2026-06-10' }),
      reserva({ id: 'ingresada' }),
    ]
    const out = filtrarReservasSTRAcceso(rs, hoy, '', new Set(['ingresada']))
    expect(out.map(r => r.id)).toEqual(['ok'])
  })

  it('busca por huésped o unidad y ordena llegadas de hoy/pasadas primero', () => {
    const rs = [
      reserva({ id: 'futura', fecha_entrada: '2026-06-14', fecha_salida: '2026-06-16', huesped_nombre: 'Beto' }),
      reserva({ id: 'hoy', huesped_nombre: 'Carla', unidad_nombre: 'Apto 5' }),
      reserva({ id: 'encurso', estado: 'en_curso', fecha_entrada: '2026-06-09', huesped_nombre: 'Dani' }),
    ]
    expect(filtrarReservasSTRAcceso(rs, hoy, '', new Set()).map(r => r.id)).toEqual(['encurso', 'hoy', 'futura'])
    expect(filtrarReservasSTRAcceso(rs, hoy, 'apto 5', new Set()).map(r => r.id)).toEqual(['hoy'])
    expect(filtrarReservasSTRAcceso(rs, hoy, 'beto', new Set()).map(r => r.id)).toEqual(['futura'])
  })
})

describe('separarDescripcionNovedad', () => {
  it('separa datos del registro y comentario cuando hay doble salto de línea', () => {
    expect(separarDescripcionNovedad('DPI: 123 | Unidad: 5\n\nTodo en orden\n\nSegundo párrafo')).toEqual({
      datosRegistro: 'DPI: 123 | Unidad: 5',
      comentario: 'Todo en orden\n\nSegundo párrafo',
    })
  })

  it('sin doble salto todo es comentario', () => {
    expect(separarDescripcionNovedad('Solo un comentario')).toEqual({
      datosRegistro: null,
      comentario: 'Solo un comentario',
    })
  })
})
