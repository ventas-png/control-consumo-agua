import { describe, it, expect } from 'vitest'
import {
  disponibilidadEquipo,
  enCirculacion,
  estadoRecepcionSugerido,
  faltantes,
  montoReposicionSugerido,
  prestamoAbierto,
  prestamoCerrado,
  prestamosDeReserva,
  rentaDeLineas,
  rentaDeReserva,
  rentaEquipoSolicitado,
  rentaUnitaria,
  resumenEquiposReserva,
  topePorReserva,
  totalCobroReserva,
} from '../prestamosEquipo'
import type { ItemInventario, PrestamoEquipo } from '../../types'

function item(partial: Partial<ItemInventario>): ItemInventario {
  return {
    id: 'inv1', company_id: 'c1', project_id: 'p1', nombre: 'Sillas', categoria: 'mobiliario',
    estado: 'disponible', cantidad: 50, cantidad_minima: 0, unidad_medida: 'unidad',
    costo_unitario: 120, created_at: '',
    ...partial,
  } as ItemInventario
}

function prestamo(partial: Partial<PrestamoEquipo>): PrestamoEquipo {
  return {
    id: 'pe', company_id: 'c1', project_id: 'p1', unidad_id: 'u1', equipo_nombre: 'Sillas',
    cantidad: 10, fecha_prestamo: '2026-11-02', estado: 'prestado', deposito_pagado: false,
    inventario_id: 'inv1', created_at: '',
    ...partial,
  } as PrestamoEquipo
}

describe('disponibilidadEquipo', () => {
  it('resta lo prestado en cualquier fecha y lo solicitado para la misma fecha', () => {
    const prestamos = [
      prestamo({ id: 'a', estado: 'prestado', cantidad: 10, fecha_prestamo: '2026-10-01' }),
      prestamo({ id: 'b', estado: 'solicitado', cantidad: 15, fecha_prestamo: '2026-11-02' }),
      prestamo({ id: 'c', estado: 'solicitado', cantidad: 20, fecha_prestamo: '2026-11-09' }), // otra fecha: no compite
      prestamo({ id: 'd', estado: 'devuelto', cantidad: 30 }),                                   // cerrado: no compite
      prestamo({ id: 'e', estado: 'cancelado', cantidad: 30 }),
      prestamo({ id: 'f', estado: 'prestado', cantidad: 99, inventario_id: 'otro' }),            // otro equipo
    ]
    expect(disponibilidadEquipo(item({}), prestamos, '2026-11-02')).toBe(25)
    expect(disponibilidadEquipo(item({}), prestamos, '2026-11-09')).toBe(20)
  })

  it('deja fuera el préstamo que se está editando', () => {
    const prestamos = [prestamo({ id: 'a', estado: 'solicitado', cantidad: 15, fecha_prestamo: '2026-11-02' })]
    expect(disponibilidadEquipo(item({}), prestamos, '2026-11-02', 'a')).toBe(50)
  })

  it('un equipo de baja o en reparación no tiene disponibilidad', () => {
    expect(disponibilidadEquipo(item({ estado: 'dado_de_baja' }), [], '2026-11-02')).toBe(0)
    expect(disponibilidadEquipo(item({ estado: 'en_reparacion' }), [], '2026-11-02')).toBe(0)
    expect(disponibilidadEquipo(item({ estado: 'en_uso' }), [], '2026-11-02')).toBe(50)
  })

  it('puede quedar en negativo si el inventario bajó por debajo de lo prestado (la pantalla lo muestra como 0)', () => {
    const prestamos = [prestamo({ estado: 'prestado', cantidad: 60 })]
    expect(disponibilidadEquipo(item({ cantidad: 50 }), prestamos, '2026-11-02')).toBe(-10)
    expect(topePorReserva({ cantidad_max_por_reserva: null }, -10)).toBe(0)
  })
})

describe('topePorReserva', () => {
  it('respeta el tope configurado sin pasar de lo disponible', () => {
    expect(topePorReserva({ cantidad_max_por_reserva: 20 }, 50)).toBe(20)
    expect(topePorReserva({ cantidad_max_por_reserva: 20 }, 8)).toBe(8)
    expect(topePorReserva({ cantidad_max_por_reserva: null }, 8)).toBe(8)
  })
})

describe('recepción: faltantes y reposición', () => {
  it('propone perdido cuando falta algo y devuelto cuando volvió todo', () => {
    expect(estadoRecepcionSugerido(10, 10)).toBe('devuelto')
    expect(estadoRecepcionSugerido(10, 7)).toBe('perdido')
  })

  it('la reposición es faltantes × costo congelado, con dos decimales', () => {
    expect(montoReposicionSugerido(10, 7, 120)).toBe(360)
    expect(montoReposicionSugerido(10, 10, 120)).toBe(0)
    expect(montoReposicionSugerido(3, 0, 33.333)).toBe(100)
    expect(montoReposicionSugerido(3, 0, null)).toBe(0)
    expect(montoReposicionSugerido(3, -5, 10)).toBe(30)
  })

  it('los faltantes sólo cuentan en préstamos cerrados', () => {
    expect(faltantes(prestamo({ estado: 'prestado', cantidad: 10, cantidad_devuelta: null }))).toBe(0)
    expect(faltantes(prestamo({ estado: 'perdido', cantidad: 10, cantidad_devuelta: 6 }))).toBe(4)
    expect(faltantes(prestamo({ estado: 'devuelto', cantidad: 10, cantidad_devuelta: null }))).toBe(0)
  })
})

describe('resumenEquiposReserva', () => {
  it('cuenta por estado, suma la reposición y separa la que no tiene cargo', () => {
    const r = resumenEquiposReserva([
      prestamo({ id: '1', estado: 'solicitado' }),
      prestamo({ id: '2', estado: 'prestado' }),
      prestamo({ id: '3', estado: 'perdido', monto_reposicion: 240, cuota_reposicion_id: 'cu1' }),
      prestamo({ id: '4', estado: 'dañado', monto_reposicion: 99.5 }),
      prestamo({ id: '5', estado: 'devuelto', monto_reposicion: null }),
      prestamo({ id: '6', estado: 'cancelado' }),
    ])
    expect(r).toEqual({
      total: 6, solicitados: 1, prestados: 1, cerrados: 3, cancelados: 1,
      reposicion: 339.5, reposicionSinCargo: 99.5, renta: 0, pendienteEntrega: true, pendienteRecepcion: true,
    })
  })

  it('suma la renta de las líneas vivas; la cancelada no cuenta', () => {
    const r = resumenEquiposReserva([
      prestamo({ id: '1', estado: 'solicitado', monto_renta: 50 }),
      prestamo({ id: '2', estado: 'devuelto', monto_renta: 12.25 }),
      prestamo({ id: '3', estado: 'cancelado', monto_renta: 99 }),
    ])
    expect(r.renta).toBe(62.25)
  })

  it('sin préstamos no hay nada pendiente', () => {
    const r = resumenEquiposReserva([])
    expect(r.total).toBe(0)
    expect(r.pendienteEntrega).toBe(false)
    expect(r.pendienteRecepcion).toBe(false)
  })
})

describe('renta del equipo (20261118000000)', () => {
  it('sólo renta lo marcado «se presta a un costo» con un monto mayor que cero', () => {
    expect(rentaUnitaria(item({ prestable_con_costo: true, costo_renta_unidad: 5 }))).toBe(5)
    expect(rentaUnitaria(item({ prestable_con_costo: false, costo_renta_unidad: 5 }))).toBeNull()
    expect(rentaUnitaria(item({ prestable_con_costo: true, costo_renta_unidad: 0 }))).toBeNull()
    expect(rentaUnitaria(item({ prestable_con_costo: true, costo_renta_unidad: null }))).toBeNull()
    // El catálogo del portal no trae el toggle: el servidor manda null cuando no se cobra.
    expect(rentaUnitaria({ costo_renta_unidad: 7.5 })).toBe(7.5)
    expect(rentaUnitaria({ costo_renta_unidad: null })).toBeNull()
  })

  it('la renta de lo pedido es Σ cantidad × renta unitaria, con dos decimales', () => {
    const inventario = [
      item({ id: 'sillas', prestable_con_costo: true, costo_renta_unidad: 5 }),
      item({ id: 'mesas', prestable_con_costo: false, costo_renta_unidad: null }),
      item({ id: 'carpa', prestable_con_costo: true, costo_renta_unidad: 33.333 }),
    ]
    expect(rentaEquipoSolicitado({ sillas: 10, mesas: 2 }, inventario)).toBe(50)
    expect(rentaEquipoSolicitado({ sillas: 10, carpa: 3 }, inventario)).toBe(150)
    expect(rentaEquipoSolicitado({ sillas: 0, desconocido: 4 }, inventario)).toBe(0)
    expect(rentaEquipoSolicitado({}, inventario)).toBe(0)
    // Con el catálogo del portal (inventario_id en vez de id).
    expect(rentaEquipoSolicitado({ sillas: 4 }, [{ inventario_id: 'sillas', costo_renta_unidad: 5 }])).toBe(20)
  })

  it('la renta de las líneas y el total a cobrar de la reserva', () => {
    expect(rentaDeLineas([
      prestamo({ estado: 'solicitado', monto_renta: 50 }),
      prestamo({ estado: 'prestado', monto_renta: 20 }),
      prestamo({ estado: 'cancelado', monto_renta: 99 }),
      prestamo({ estado: 'devuelto', monto_renta: null }),
    ])).toBe(70)
    const lineas = [
      prestamo({ id: 'a', reserva_id: 'r1', estado: 'solicitado', monto_renta: 50 }),
      prestamo({ id: 'b', reserva_id: 'r1', estado: 'cancelado', monto_renta: 99 }),
      prestamo({ id: 'c', reserva_id: 'r2', estado: 'prestado', monto_renta: 20 }),
    ]
    expect(rentaDeReserva('r1', lineas)).toBe(50)
    expect(rentaDeReserva('r2', lineas)).toBe(20)
    expect(rentaDeReserva('r3', lineas)).toBe(0)
    expect(totalCobroReserva({ id: 'r1', monto_tarifa: 100 }, lineas)).toBe(150)
    expect(totalCobroReserva({ id: 'r2', monto_tarifa: null }, lineas)).toBe(20)
    expect(totalCobroReserva({ id: 'r3', monto_tarifa: 100 }, lineas)).toBe(100)
    expect(totalCobroReserva({ id: 'r3', monto_tarifa: null }, [])).toBe(0)
  })
})

describe('utilidades', () => {
  it('abierto / cerrado / en circulación / de reserva', () => {
    expect(prestamoAbierto({ estado: 'solicitado' })).toBe(true)
    expect(prestamoAbierto({ estado: 'devuelto' })).toBe(false)
    expect(prestamoCerrado({ estado: 'dañado' })).toBe(true)
    expect(prestamoCerrado({ estado: 'cancelado' })).toBe(false)
    const lista = [
      prestamo({ id: 'a', estado: 'prestado', cantidad: 4, reserva_id: 'r1' }),
      prestamo({ id: 'b', estado: 'prestado', cantidad: 6, reserva_id: 'r2' }),
      prestamo({ id: 'c', estado: 'solicitado', cantidad: 6, reserva_id: 'r1' }),
    ]
    expect(enCirculacion('inv1', lista)).toBe(10)
    expect(prestamosDeReserva('r1', lista).map(p => p.id)).toEqual(['a', 'c'])
  })
})
