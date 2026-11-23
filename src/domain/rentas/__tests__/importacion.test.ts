// Lectura de la hoja de reservas con desglose: lo que se acepta escrito a mano
// (fechas, montos con signo de moneda, encabezados sin acento) y lo que se rechaza.
import { describe, it, expect } from 'vitest'
import type { ConceptoRenta } from '../../../types'
import { COL, columnaDeConcepto, conceptosDePlantilla, leerFecha, leerFilaReserva, leerMonto } from '../importacion'

const con = (id: string, bloque: 'huesped' | 'anfitrion', nombre: string, orden: number, activo = true): ConceptoRenta =>
  ({ id, company_id: 'c1', codigo: id, nombre, bloque, signo: 1, comisionable: true, orden, activo, created_at: '', updated_at: '' })
const CONCEPTOS = [
  con('a1', 'anfitrion', 'Tarifa de la habitación', 10), con('h1', 'huesped', 'Tarifa de limpieza', 30),
  con('a2', 'anfitrion', 'Tarifa de limpieza', 20), con('ax', 'anfitrion', 'Viejo', 90, false),
]

describe('plantilla', () => {
  it('una columna por concepto ACTIVO, el bloque del huésped primero, sin choque de nombres entre bloques', () => {
    expect(conceptosDePlantilla(CONCEPTOS).map(columnaDeConcepto)).toEqual([
      'Cobro huésped · Tarifa de limpieza', 'Recibido · Tarifa de la habitación', 'Recibido · Tarifa de limpieza',
    ])
  })
})

describe('leerFecha / leerMonto', () => {
  it('fechas ISO, día/mes/año y de Excel; lo imposible es null', () => {
    expect(leerFecha('2026-02-02')).toBe('2026-02-02')
    expect(leerFecha('2/2/2026')).toBe('2026-02-02')
    expect(leerFecha('14-02-2026')).toBe('2026-02-14')
    expect(leerFecha(new Date(Date.UTC(2026, 1, 9)))).toBe('2026-02-09')
    expect(leerFecha('31/02/2026')).toBeNull()
    expect(leerFecha('pronto')).toBeNull()
    expect(leerFecha('')).toBeNull()
  })
  it('montos con signo de moneda, miles y coma decimal; vacío es null; negativo o texto, inválido', () => {
    expect(leerMonto('$ 1,037.75')).toBe(1037.75)
    expect(leerMonto('1037,75')).toBe(1037.75)
    expect(leerMonto(29)).toBe(29)
    expect(leerMonto('')).toBeNull()
    expect(leerMonto(' $ - ')).toBeNull()
    expect(leerMonto('-5')).toBeUndefined()
    expect(leerMonto('mucho')).toBeUndefined()
  })
})

describe('leerFilaReserva', () => {
  const fila = (extra: Record<string, unknown> = {}) => ({
    [COL.codigo]: 'HM34NRSTRH', [COL.huesped]: 'Ana', [COL.entrada]: '2026-02-02', [COL.salida]: '03/02/2026', [COL.huespedes]: 1,
    [COL.politica]: 'No reembolsable', 'Recibido · Tarifa de la habitación': '$ 39.00', 'Cobro huésped · Tarifa de limpieza': 29, ...extra,
  })
  it('lee la reserva y su desglose; una reserva ya pasada nace completada', () => {
    const r = leerFilaReserva(fila(), CONCEPTOS, '2026-11-16')
    expect(r).toEqual({
      ok: true,
      data: {
        importes: { a1: 39, h1: 29 }, moneda: 'USD', propiedad: '', proyecto: '',
        datos: expect.objectContaining({
          huesped_nombre: 'Ana', codigo_confirmacion: 'HM34NRSTRH', fecha_entrada: '2026-02-02', fecha_salida: '2026-02-03',
          num_huespedes: 1, plataforma: 'airbnb', politica_cancelacion: 'no_reembolsable', num_mascotas: 0, estado: 'completada',
        }),
      },
    })
  })
  it('encabezados sin acentos ni mayúsculas casan igual; el estado sale de las fechas', () => {
    const r = leerFilaReserva({ 'codigo de reserva': 'X1', huesped: '', entrada: '2026-11-15', salida: '2026-11-20', 'recibido tarifa de la habitacion': '10', plataforma: 'Booking', mascotas: 'sí' }, CONCEPTOS, '2026-11-16')
    expect(r.ok && r.data.datos).toMatchObject({ huesped_nombre: 'X1', estado: 'en_curso', plataforma: 'booking', num_mascotas: 1 })
    expect(r.ok && r.data.importes).toEqual({ a1: 10 })
    const futura = leerFilaReserva(fila({ [COL.entrada]: '2027-01-01', [COL.salida]: '2027-01-02' }), CONCEPTOS, '2026-11-16')
    expect(futura.ok && futura.data.datos.estado).toBe('confirmada')
  })
  it('junta todos los errores de la fila', () => {
    const r = leerFilaReserva(fila({ [COL.codigo]: '', [COL.huesped]: '', [COL.entrada]: 'ayer', [COL.huespedes]: 0, 'Recibido · Tarifa de limpieza': 'x' }), CONCEPTOS, '2026-11-16')
    expect(r).toEqual({ ok: false, errors: [
      'Falta el huésped o el código de reserva', 'Entrada: fecha inválida (usa AAAA-MM-DD o DD/MM/AAAA)',
      'Huéspedes: debe ser un número entero mayor que cero', 'Recibido · Tarifa de limpieza: no es un monto válido',
    ] })
    const cruzada = leerFilaReserva(fila({ [COL.salida]: '2026-02-01' }), CONCEPTOS, '2026-11-16')
    expect(cruzada).toEqual({ ok: false, errors: ['La salida debe ser posterior a la entrada'] })
  })
})

describe('moneda y propiedad de la fila', () => {
  const base = { [COL.huesped]: 'Ana', [COL.entrada]: '2026-02-02', [COL.salida]: '2026-02-03' }
  it('la moneda se normaliza a mayúsculas y por defecto es USD', () => {
    const r = leerFilaReserva({ ...base, moneda: 'gtq', Propiedad: ' Apto 1A ' }, CONCEPTOS, '2026-11-16')
    expect(r.ok && r.data).toMatchObject({ moneda: 'GTQ', propiedad: 'Apto 1A', proyecto: '' })
  })
  it('una moneda que no es un código de tres letras se rechaza', () => {
    expect(leerFilaReserva({ ...base, [COL.moneda]: 'dólares' }, CONCEPTOS, '2026-11-16'))
      .toEqual({ ok: false, errors: ['Moneda: usa el código de tres letras (USD, GTQ, MXN…)'] })
  })
})
