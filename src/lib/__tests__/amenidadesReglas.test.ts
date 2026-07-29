import { hoyLocalISO } from '../format'
import { describe, it, expect } from 'vitest'
import {
  addMinutosToTime,
  bloqueoSolapaReserva,
  diasDeSemana,
  diferenciaHoras,
  esFinDeSemana,
  lunesDeSemana,
  tarifaAplicable,
  validarReglasAmenidad,
} from '../amenidadesReglas'
import type { Amenidad, BloqueoAmenidad, ReservaAmenidad } from '../../types'

function bloqueo(partial: Partial<BloqueoAmenidad>): BloqueoAmenidad {
  return {
    id: 'b1', company_id: 'c1', project_id: 'p1', amenidad_id: 'a1',
    fecha_inicio: '2026-06-10', fecha_fin: '2026-06-12',
    hora_inicio: null, hora_fin: null, motivo: 'mantenimiento',
    notas: null, created_at: '',
    ...partial,
  } as BloqueoAmenidad
}

function amenidad(partial: Partial<Amenidad>): Amenidad {
  return {
    id: 'a1', requiere_tarifa: false, tarifa_uso: null, tarifa_uso_finde: null,
    duracion_max_horas: null, horas_minimas_antelacion: null,
    max_reservas_mes_unidad: null,
    ...partial,
  } as Amenidad
}

function reserva(partial: Partial<ReservaAmenidad>): ReservaAmenidad {
  return {
    id: 'r1', amenidad_id: 'a1', unidad_id: 'u1', fecha: '2026-06-15',
    estado: 'confirmada',
    ...partial,
  } as ReservaAmenidad
}

describe('bloqueoSolapaReserva', () => {
  it('día completo bloquea cualquier horario dentro del rango de fechas', () => {
    expect(bloqueoSolapaReserva(bloqueo({}), '2026-06-11', '10:00', '12:00')).toBe(true)
    expect(bloqueoSolapaReserva(bloqueo({}), '2026-06-13', '10:00', '12:00')).toBe(false)
  })

  it('con horario, solapa solo si los intervalos se cruzan', () => {
    const b = bloqueo({ hora_inicio: '12:00', hora_fin: '14:00' })
    expect(bloqueoSolapaReserva(b, '2026-06-11', '13:00', '15:00')).toBe(true)
    expect(bloqueoSolapaReserva(b, '2026-06-11', '14:00', '16:00')).toBe(false)
    expect(bloqueoSolapaReserva(b, '2026-06-11', '10:00', '12:00')).toBe(false)
  })
})

describe('esFinDeSemana / tarifaAplicable', () => {
  it('detecta sábado y domingo', () => {
    expect(esFinDeSemana('2026-06-13')).toBe(true)  // sábado
    expect(esFinDeSemana('2026-06-14')).toBe(true)  // domingo
    expect(esFinDeSemana('2026-06-15')).toBe(false) // lunes
    expect(esFinDeSemana('')).toBe(false)
  })

  it('usa la tarifa de finde cuando existe; base entre semana; 0 sin tarifa', () => {
    const a = amenidad({ requiere_tarifa: true, tarifa_uso: 100, tarifa_uso_finde: 150 })
    expect(tarifaAplicable(a, '2026-06-15')).toBe(100)
    expect(tarifaAplicable(a, '2026-06-13')).toBe(150)
    expect(tarifaAplicable(amenidad({ requiere_tarifa: true, tarifa_uso: 100 }), '2026-06-13')).toBe(100)
    expect(tarifaAplicable(amenidad({}), '2026-06-13')).toBe(0)
  })
})

describe('diferenciaHoras / addMinutosToTime', () => {
  it('horas decimales entre HH:MM', () => {
    expect(diferenciaHoras('10:00', '12:30')).toBe(2.5)
    expect(diferenciaHoras('10:15', '10:45')).toBe(0.5)
  })

  it('suma minutos con padding y envuelve a las 24 h', () => {
    expect(addMinutosToTime('10:00', 90)).toBe('11:30')
    expect(addMinutosToTime('23:30', 60)).toBe('00:30')
    expect(addMinutosToTime('00:10', -30)).toBe('00:00')
  })
})

describe('validarReglasAmenidad', () => {
  const fechaFutura = (() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  })()

  it('rechaza duración mayor a la máxima', () => {
    const a = amenidad({ duracion_max_horas: 2 })
    expect(validarReglasAmenidad(a, fechaFutura, '10:00', '13:00', 'u1', [])).toMatch(/duración máxima/)
    expect(validarReglasAmenidad(a, fechaFutura, '10:00', '12:00', 'u1', [])).toBeNull()
  })

  it('rechaza reservas sin la antelación mínima', () => {
    const a = amenidad({ horas_minimas_antelacion: 48 })
    const hoy = hoyLocalISO()
    expect(validarReglasAmenidad(a, hoy, '23:59', '23:59', 'u1', [])).toMatch(/anticipación/)
    expect(validarReglasAmenidad(a, fechaFutura, '10:00', '11:00', 'u1', [])).toBeNull()
  })

  it('rechaza al alcanzar el límite mensual por unidad (canceladas no cuentan)', () => {
    const a = amenidad({ max_reservas_mes_unidad: 1 })
    const mes = fechaFutura.slice(0, 7)
    const existentes = [
      reserva({ fecha: `${mes}-01`, estado: 'confirmada' }),
      reserva({ id: 'r2', fecha: `${mes}-02`, estado: 'cancelada' }),
    ]
    expect(validarReglasAmenidad(a, fechaFutura, '10:00', '11:00', 'u1', existentes)).toMatch(/límite/)
    expect(validarReglasAmenidad(a, fechaFutura, '10:00', '11:00', 'u2', existentes)).toBeNull()
    expect(validarReglasAmenidad(a, fechaFutura, '10:00', '11:00', 'u1', [existentes[1]])).toBeNull()
  })
})

describe('calendario semanal', () => {
  it('lunesDeSemana retrocede al lunes (domingo incluido)', () => {
    expect(lunesDeSemana(new Date('2026-06-11T12:00:00')).getDay()).toBe(4 - 3) // jueves → lunes
    expect(lunesDeSemana(new Date('2026-06-14T12:00:00')).getDay()).toBe(1)     // domingo → lunes anterior
    expect(lunesDeSemana(new Date('2026-06-14T12:00:00')).getDate()).toBe(8)
  })

  it('diasDeSemana produce 7 días consecutivos desde el lunes', () => {
    const dias = diasDeSemana(lunesDeSemana(new Date('2026-06-11T12:00:00')))
    expect(dias).toHaveLength(7)
    expect(dias[0].getDay()).toBe(1)
    expect(dias[6].getDay()).toBe(0)
  })
})
