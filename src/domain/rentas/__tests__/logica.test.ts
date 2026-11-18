import { describe, it, expect } from 'vitest'
import type { ArticuloInventarioRenta, ContratoRenta, PropiedadRenta, ReservaRenta, ReservaSTR, ReservaUnificada } from '../../../types'
import {
  contratoActivo, diasEntre, diasParaVencer, mensajeErrorRentas, noches, numeroONulo, ocupacionDePropiedad,
  fotosPorBorrar, reservaCubre, reservasSolapadas, resumenCartera, resumenInventario, unificarReservas,
} from '../logica'

const HOY = '2026-11-16'

const prop = (id: string, extra: Partial<PropiedadRenta> = {}): PropiedadRenta => ({
  id, company_id: 'c1', project_id: null, unidad_id: null, nombre: `Prop ${id}`, codigo: null,
  tipo_renta: 'corto_plazo', tipo_detalle: null, estado: 'activa', direccion: null, ciudad: null,
  propietario_nombre: null, propietario_telefono: null, propietario_email: null,
  habitaciones: null, banos: null, capacidad: null, area_m2: null, tarifa_base: null, comision_pct: null,
  notas: null, created_at: '', updated_at: '', ...extra,
})
const reserva = (id: string, propiedad_id: string, entrada: string, salida: string, extra: Partial<ReservaUnificada> = {}): ReservaUnificada => ({
  id, origen: 'rentas', propiedad_id, huesped_nombre: 'Ana', huesped_email: null, huesped_telefono: null,
  fecha_entrada: entrada, fecha_salida: salida, num_huespedes: 2, plataforma: 'directo', codigo_confirmacion: null,
  monto_noche: null, monto_total: null, estado: 'confirmada', notas: null, politica_cancelacion: null, num_mascotas: 0, ...extra,
})
const contrato = (id: string, propiedad_id: string, extra: Partial<ContratoRenta> = {}): ContratoRenta => ({
  id, company_id: 'c1', propiedad_id, inquilino_nombre: 'Luis', inquilino_identificacion: null,
  inquilino_telefono: null, inquilino_email: null, fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31',
  moneda: 'USD',
  renta_mensual: 4500, deposito: null, dia_pago: 5, estado: 'vigente', notas: null, created_at: '', updated_at: '', ...extra,
})
const articulo = (id: string, extra: Partial<ArticuloInventarioRenta> = {}): ArticuloInventarioRenta => ({
  id, company_id: 'c1', propiedad_id: 'a', nombre: 'Sofá', categoria: 'mobiliario', ambiente: null,
  cantidad: 1, estado: 'bueno', valor_unitario: null, numero_serie: null, fecha_revision: null, notas: null,
  fotos: [], created_at: '', updated_at: '', ...extra,
})

describe('fechas', () => {
  it('cuenta días de calendario y noches sin depender de la hora ni del huso', () => {
    expect(diasEntre('2026-11-16', '2026-11-19')).toBe(3)
    expect(diasEntre('2026-03-01', '2026-02-27')).toBe(-2)
    expect(noches('2026-12-30', '2027-01-02')).toBe(3)
    expect(noches('2026-12-10', '2026-12-10')).toBe(0)
    expect(noches('', '2026-12-10')).toBe(0)
  })
})

describe('unificarReservas', () => {
  const propiedades = [prop('ind'), prop('enl', { project_id: 'p1', unidad_id: 'u1' })]
  const propias = [{
    id: 'r1', company_id: 'c1', propiedad_id: 'ind', huesped_nombre: 'Ana', huesped_email: null, huesped_telefono: null,
    fecha_entrada: '2026-12-01', fecha_salida: '2026-12-04', num_huespedes: 2, plataforma: 'airbnb',
    codigo_confirmacion: 'HM1', monto_noche: 100, monto_total: 300, estado: 'confirmada', notas: null, created_at: '', updated_at: '',
  }] as ReservaRenta[]
  const str = [
    { id: 's1', company_id: 'c1', project_id: 'p1', unidad_id: 'u1', huesped_nombre: 'Beto', fecha_entrada: '2026-12-10', fecha_salida: '2026-12-12',
      num_adultos: 2, num_ninos: 1, num_bebes: 1, plataforma: 'booking', estado: 'en_curso', mascotas: false, created_at: '' },
    { id: 's2', company_id: 'c1', project_id: 'p1', unidad_id: 'u-otra', huesped_nombre: 'Ajena', fecha_entrada: '2026-12-10', fecha_salida: '2026-12-12',
      num_adultos: 1, num_ninos: 0, num_bebes: 0, plataforma: 'directo', estado: 'confirmada', mascotas: false, created_at: '' },
    { id: 's3', company_id: 'c1', project_id: 'p1', unidad_id: null, huesped_nombre: 'Sin unidad', fecha_entrada: '2026-12-10', fecha_salida: '2026-12-12',
      num_adultos: 1, num_ninos: 0, num_bebes: 0, plataforma: 'directo', estado: 'confirmada', mascotas: false, created_at: '' },
  ] as ReservaSTR[]

  it('junta las propias con las STR de unidades enlazadas, y deja fuera las de unidades que no son propiedad en renta', () => {
    const u = unificarReservas(propiedades, propias, str)
    expect(u.map(r => `${r.origen}:${r.id}`)).toEqual(['condominio:s1', 'rentas:r1'])
    const s1 = u[0]
    expect(s1.propiedad_id).toBe('enl')
    expect(s1.num_huespedes).toBe(4)
    expect(s1.estado).toBe('en_curso')
    expect(s1.huesped_telefono).toBeNull()
  })

  it('una reserva propia de una propiedad que ya no está a la vista no aparece huérfana', () => {
    expect(unificarReservas([prop('otra')], propias, [])).toEqual([])
  })

  it('una plataforma o un estado que Rentas no conoce no rompe la lista', () => {
    const raro = [{ ...str[0], plataforma: 'expedia', estado: 'no_show' }] as unknown as ReservaSTR[]
    const [r] = unificarReservas(propiedades, [], raro)
    expect(r.plataforma).toBe('otro')
    expect(r.estado).toBe('confirmada')
  })
})

describe('ocupación', () => {
  it('la estancia ocupa desde la entrada hasta la víspera de la salida', () => {
    const r = reserva('r', 'a', '2026-11-14', '2026-11-16')
    expect(reservaCubre(r, '2026-11-14')).toBe(true)
    expect(reservaCubre(r, '2026-11-15')).toBe(true)
    expect(reservaCubre(r, '2026-11-16')).toBe(false)
    expect(reservaCubre({ ...r, estado: 'cancelada' }, '2026-11-15')).toBe(false)
    expect(reservaCubre({ ...r, estado: 'completada' }, '2026-11-15')).toBe(false)
  })

  it('el estado operativo manda; activa, la ocupa una reserva que cubre hoy o un contrato dentro de sus fechas', () => {
    const rs = [reserva('r', 'a', '2026-11-15', '2026-11-18')]
    const cs = [contrato('c', 'b'), contrato('v', 'c', { fecha_fin: '2026-10-31' }), contrato('f', 'd', { estado: 'finalizado' })]
    expect(ocupacionDePropiedad(prop('a'), rs, cs, HOY)).toBe('ocupada')
    expect(ocupacionDePropiedad(prop('a', { estado: 'mantenimiento' }), rs, cs, HOY)).toBe('mantenimiento')
    expect(ocupacionDePropiedad(prop('a', { estado: 'inactiva' }), rs, cs, HOY)).toBe('inactiva')
    expect(ocupacionDePropiedad(prop('b', { tipo_renta: 'largo_plazo' }), rs, cs, HOY)).toBe('ocupada')
    // Contrato vencido sin cerrar y contrato finalizado: no ocupan.
    expect(ocupacionDePropiedad(prop('c', { tipo_renta: 'largo_plazo' }), rs, cs, HOY)).toBe('disponible')
    expect(ocupacionDePropiedad(prop('d', { tipo_renta: 'largo_plazo' }), rs, cs, HOY)).toBe('disponible')
  })

  it('contrato indefinido: activo desde su inicio', () => {
    expect(contratoActivo(contrato('c', 'a', { fecha_fin: null }), HOY)).toBe(true)
    expect(contratoActivo(contrato('c', 'a', { fecha_inicio: '2026-12-01', fecha_fin: null }), HOY)).toBe(false)
  })
})

describe('reservasSolapadas', () => {
  const rs = [
    reserva('r1', 'a', '2026-12-10', '2026-12-13'),
    reserva('r2', 'a', '2026-12-20', '2026-12-22', { estado: 'cancelada' }),
    reserva('r3', 'b', '2026-12-10', '2026-12-13'),
  ]
  it('salir y entrar el mismo día no es solape', () => {
    expect(reservasSolapadas(rs, 'a', '2026-12-13', '2026-12-15')).toEqual([])
    expect(reservasSolapadas(rs, 'a', '2026-12-08', '2026-12-10')).toEqual([])
  })
  it('detecta el cruce, ignora canceladas, otras propiedades y la propia reserva', () => {
    expect(reservasSolapadas(rs, 'a', '2026-12-12', '2026-12-14').map(r => r.id)).toEqual(['r1'])
    expect(reservasSolapadas(rs, 'a', '2026-12-19', '2026-12-23')).toEqual([])
    expect(reservasSolapadas(rs, 'a', '2026-12-10', '2026-12-13', 'r1')).toEqual([])
    expect(reservasSolapadas(rs, 'a', '', '2026-12-13')).toEqual([])
  })
})

describe('contratos por vencer', () => {
  it('días hasta el fin; null si es indefinido o no está vigente', () => {
    expect(diasParaVencer(contrato('c', 'a', { fecha_fin: '2026-12-16' }), HOY)).toBe(30)
    expect(diasParaVencer(contrato('c', 'a', { fecha_fin: '2026-11-10' }), HOY)).toBe(-6)
    expect(diasParaVencer(contrato('c', 'a', { fecha_fin: null }), HOY)).toBeNull()
    expect(diasParaVencer(contrato('c', 'a', { estado: 'finalizado' }), HOY)).toBeNull()
  })
})

describe('fotosPorBorrar', () => {
  it('sin guardar (cancelar) sólo se van las subidas en esta edición; las de la fila se quedan', () => {
    expect(fotosPorBorrar(['e/p/a.jpg'], ['e/p/a.jpg', 'e/p/n1.jpg', 'e/p/n2.jpg'], null)).toEqual(['e/p/n1.jpg', 'e/p/n2.jpg'])
  })
  it('guardando, se va todo lo que la fila ya no nombra: quitadas y subidas descartadas', () => {
    expect(fotosPorBorrar(['e/p/a.jpg', 'e/p/b.jpg'], ['e/p/n1.jpg', 'e/p/n2.jpg'], ['e/p/b.jpg', 'e/p/n2.jpg']).sort())
      .toEqual(['e/p/a.jpg', 'e/p/n1.jpg'])
  })
  it('un alta guardada con sus fotos no borra nada; sin tocar nada tampoco', () => {
    expect(fotosPorBorrar([], ['e/p/n1.jpg'], ['e/p/n1.jpg'])).toEqual([])
    expect(fotosPorBorrar(['e/p/a.jpg'], [], null)).toEqual([])
    expect(fotosPorBorrar(['e/p/a.jpg'], ['e/p/a.jpg'], ['e/p/a.jpg'])).toEqual([])
  })
})

describe('resumenInventario', () => {
  it('lo faltante no suma al valor; cuenta dañados y faltantes por artículo', () => {
    const r = resumenInventario([
      articulo('1', { cantidad: 2, valor_unitario: 100 }),
      articulo('2', { cantidad: 1, valor_unitario: 500, estado: 'danado' }),
      articulo('3', { cantidad: 3, valor_unitario: 50, estado: 'faltante' }),
      articulo('4', { cantidad: 4 }),
    ])
    expect(r).toEqual({ articulos: 4, unidades: 10, valor: 700, danados: 1, faltantes: 1 })
  })
})

describe('resumenCartera', () => {
  it('ocupación sobre lo que está en servicio, ingreso del mes y avisos de contratos', () => {
    const propiedades = [
      prop('a'), prop('b'), prop('m', { estado: 'mantenimiento' }),
      prop('l', { tipo_renta: 'largo_plazo' }), prop('loc', { tipo_renta: 'local_comercial' }),
    ]
    const reservas = [
      reserva('r1', 'a', '2026-11-15', '2026-11-18', { estado: 'en_curso', monto_total: 300 }),
      reserva('r2', 'b', '2026-11-20', '2026-11-22', { monto_total: 200 }),
      reserva('r3', 'b', '2026-11-25', '2026-11-27', { estado: 'cancelada', monto_total: 999 }),
      reserva('r4', 'b', '2026-12-05', '2026-12-07', { monto_total: 400 }),
    ]
    const contratos = [
      contrato('c1', 'l', { fecha_fin: '2026-12-31', renta_mensual: 4500 }),
      contrato('c2', 'loc', { fecha_fin: '2026-10-31', renta_mensual: 9000 }),
    ]
    const r = resumenCartera(propiedades, reservas, contratos, [articulo('1', { estado: 'faltante' })], HOY)
    expect(r.propiedades).toBe(5)
    expect(r.porTipo).toEqual({ corto_plazo: 3, largo_plazo: 1, local_comercial: 1, otro: 0 })
    expect([r.ocupadas, r.disponibles, r.fueraDeServicio]).toEqual([2, 2, 1])
    expect(r.ocupacionPct).toBe(50)
    expect(r.reservasEnCurso).toBe(1)
    expect(r.proximasLlegadas).toBe(1)
    // 300 + 200 de reservas que entran en noviembre + 4500 del contrato activo (el vencido no cuenta).
    expect(r.ingresoMes).toBe(5000)
    expect([r.contratosVigentes, r.contratosPorVencer, r.contratosVencidos]).toEqual([2, 1, 1])
    expect(r.inventario.faltantes).toBe(1)
  })

  it('sin propiedades en servicio no inventa un porcentaje', () => {
    expect(resumenCartera([prop('a', { estado: 'inactiva' })], [], [], [], HOY).ocupacionPct).toBeNull()
  })
})

describe('mensajeErrorRentas', () => {
  it('quita el código del servidor y traduce índices únicos y rechazos de permiso', () => {
    expect(mensajeErrorRentas(new Error('RENTAS_UNIDAD_AJENA: la unidad no es de ese proyecto'), 'x')).toBe('La unidad no es de ese proyecto')
    expect(mensajeErrorRentas(new Error('duplicate key value violates unique constraint "rentas_propiedades_unidad_uq"'), 'x')).toMatch(/ya está registrada/)
    expect(mensajeErrorRentas(new Error('duplicate key value violates unique constraint "rentas_contratos_vigente_uq"'), 'x')).toMatch(/contrato vigente/)
    expect(mensajeErrorRentas(new Error('new row violates row-level security policy for table "rentas_reservas"'), 'x')).toMatch(/No tienes permiso/)
    expect(mensajeErrorRentas(new Error('plan_limit_reached: max_units = 50'), 'x')).toMatch(/límite de unidades/)
    expect(mensajeErrorRentas(null, 'Intenta de nuevo.')).toBe('Intenta de nuevo.')
  })
})

describe('numeroONulo', () => {
  it('vacío → null; coma decimal; negativos y texto → inválido', () => {
    expect(numeroONulo('  ')).toBeNull()
    expect(numeroONulo('1250,50')).toBe(1250.5)
    expect(numeroONulo('0')).toBe(0)
    expect(numeroONulo('-3')).toBeUndefined()
    expect(numeroONulo('abc')).toBeUndefined()
  })
})
