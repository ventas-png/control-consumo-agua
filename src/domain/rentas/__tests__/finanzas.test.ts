// El mes de un apartamento calculado igual que la hoja de Excel que llevan las
// administradoras: los datos de este test SON los del «Apto 1D SQ», febrero 2026.
import { describe, it, expect } from 'vitest'
import type { ConceptoRenta, ContratoRenta, GastoRenta, LiquidacionRenta, PropiedadRenta, ReservaUnificada } from '../../../types'
import {
  calendarioMes, codigoDeConcepto, contratoCubreMes, diasDelMes, importesDeFormulario, liquidacionesPorReserva,
  mesCorto, mesDesplazado, monedaDeReserva, resumenTendencia, tendenciaMeses, MONEDAS_RENTA, nochesEnMes, nombreMes, resumenCarteraMes, resumenMes, tieneDesglose, totalesDesglose,
} from '../finanzas'

const concepto = (bloque: 'huesped' | 'anfitrion', codigo: string, signo: 1 | -1, orden: number, extra: Partial<ConceptoRenta> = {}): ConceptoRenta => ({
  id: `${bloque}:${codigo}`, company_id: 'c1', codigo, nombre: codigo, bloque, signo, comisionable: bloque === 'anfitrion',
  orden, activo: true, created_at: '', updated_at: '', ...extra,
})
const CONCEPTOS: ConceptoRenta[] = [
  concepto('huesped', 'tarifa_habitacion', 1, 10), concepto('huesped', 'tarifa_limpieza', 1, 30),
  concepto('huesped', 'servicio_huesped', 1, 40), concepto('huesped', 'impuesto', 1, 50),
  concepto('anfitrion', 'tarifa_habitacion', 1, 10), concepto('anfitrion', 'tarifa_limpieza', 1, 20),
  concepto('anfitrion', 'descuentos', -1, 30), concepto('anfitrion', 'servicio_anfitrion', -1, 40),
  concepto('anfitrion', 'impuesto', 1, 70), concepto('anfitrion', 'adicionales', 1, 80),
]

const reserva = (id: string, entrada: string, salida: string, personas: number, extra: Partial<ReservaUnificada> = {}): ReservaUnificada => ({
  id, origen: 'rentas', propiedad_id: 'p1', huesped_nombre: id, huesped_email: null, huesped_telefono: null,
  fecha_entrada: entrada, fecha_salida: salida, num_huespedes: personas, plataforma: 'airbnb', codigo_confirmacion: id,
  monto_noche: null, monto_total: null, estado: 'completada', notas: null, politica_cancelacion: 'no_reembolsable', num_mascotas: 0, huesped_pais: null, fecha_reservacion: null, hora_llegada_estimada: null, hora_salida_estimada: null, num_adultos: 1, num_ninos: 0, num_bebes: 0, foto_url: null, foto_documento_url: null, ...extra,
})
// [huésped: habitación, limpieza, servicio, impuesto] · [anfitrión: habitación, limpieza, descuentos, servicio, impuesto]
const HOJA: [ReservaUnificada, number[], number[]][] = [
  [reserva('HM34NRSTRH', '2026-02-02', '2026-02-03', 1), [35.10, 29, 9.05, 7.69], [39, 29, 3.90, 1.92, 7.69]],
  [reserva('HMDYA2HFPF', '2026-02-04', '2026-02-08', 2), [178.40, 29, 31.65, 24.89], [196, 29, 17.60, 6.22, 24.89]],
  [reserva('HM5K2YCFNQ', '2026-02-09', '2026-02-10', 2), [40.10, 29, 9.76, 8.26], [44, 29, 3.90, 2.07, 8.29]],
  [reserva('HMWDKFWMPQ', '2026-02-12', '2026-02-14', 2), [88.30, 29, 16.56, 14.08], [97, 29, 8.70, 3.52, 14.08]],
  [reserva('HM5S2ZQJ8N', '2026-02-14', '2026-03-01', 2), [793.84, 29, 116.17, 98.74], [938, 29, 144.16, 24.69, 98.74]],
]
const RESERVAS = HOJA.map(h => h[0])
const LIQUIDACIONES: LiquidacionRenta[] = HOJA.map(([r, h, a]) => ({
  id: `l-${r.id}`, company_id: 'c1', propiedad_id: 'p1', reserva_id: r.id, reserva_str_id: null, moneda: 'USD', created_at: '', updated_at: '',
  importes: {
    'huesped:tarifa_habitacion': h[0], 'huesped:tarifa_limpieza': h[1], 'huesped:servicio_huesped': h[2], 'huesped:impuesto': h[3],
    'anfitrion:tarifa_habitacion': a[0], 'anfitrion:tarifa_limpieza': a[1], 'anfitrion:descuentos': a[2],
    'anfitrion:servicio_anfitrion': a[3], 'anfitrion:impuesto': a[4],
  },
}))
const propiedad = (extra: Partial<PropiedadRenta> = {}): PropiedadRenta =>
  ({ id: 'p1', company_id: 'c1', nombre: 'Apto 1D SQ', tipo_renta: 'corto_plazo', estado: 'activa', comision_pct: null, ...extra }) as PropiedadRenta
const gasto = (fecha: string, monto: number, a_cargo_de: GastoRenta['a_cargo_de'] = 'propietario'): GastoRenta =>
  ({ id: `g${fecha}${monto}`, company_id: 'c1', propiedad_id: 'p1', fecha, categoria: 'limpieza', descripcion: 'x', proveedor: null, monto, moneda: 'USD', a_cargo_de, notas: null, created_at: '', updated_at: '' })
const mes = (extra: Partial<Parameters<typeof resumenMes>[0]> = {}) => resumenMes({
  propiedad: propiedad(), mes: '2026-02', reservas: RESERVAS, contratos: [], gastos: [], conceptos: CONCEPTOS,
  liquidaciones: liquidacionesPorReserva(LIQUIDACIONES), ...extra,
})

describe('totalesDesglose', () => {
  it('suma y resta según el signo del concepto: la primera fila de la hoja', () => {
    expect(totalesDesglose(CONCEPTOS, LIQUIDACIONES[0].importes)).toEqual({ huesped: 80.84, anfitrion: 69.87, baseComision: 69.87 })
  })
  it('un concepto no comisionable sale de la base; uno que ya no existe no suma', () => {
    const sinImpuesto = CONCEPTOS.map(c => c.id === 'anfitrion:impuesto' ? { ...c, comisionable: false } : c)
    expect(totalesDesglose(sinImpuesto, LIQUIDACIONES[0].importes).baseComision).toBe(62.18)
    expect(totalesDesglose(CONCEPTOS, { 'anfitrion:borrado': 500 })).toEqual({ huesped: 0, anfitrion: 0, baseComision: 0 })
  })
  it('tieneDesglose: vacío o todo en cero no cuenta', () => {
    expect(tieneDesglose(undefined)).toBe(false)
    expect(tieneDesglose({})).toBe(false)
    expect(tieneDesglose({ a: 0 })).toBe(false)
    expect(tieneDesglose({ a: 1 })).toBe(true)
  })
})

describe('el mes', () => {
  it('días, desplazamiento y nombre', () => {
    expect(diasDelMes('2026-02')).toBe(28)
    expect(diasDelMes('2028-02')).toBe(29)
    expect(mesDesplazado('2026-01', -1)).toBe('2025-12')
    expect(mesDesplazado('2026-12', 1)).toBe('2027-01')
    expect(nombreMes('2026-02')).toBe('febrero de 2026')
  })
  it('nochesEnMes recorta la estancia al mes', () => {
    expect(nochesEnMes('2026-02-14', '2026-03-01', '2026-02')).toBe(15)
    expect(nochesEnMes('2026-01-30', '2026-02-03', '2026-02')).toBe(2)
    expect(nochesEnMes('2026-02-27', '2026-03-05', '2026-03')).toBe(4)
    expect(nochesEnMes('2026-01-01', '2026-01-05', '2026-02')).toBe(0)
  })
  it('calendario: el día de salida es de quien entra; la reserva cancelada no ocupa', () => {
    const dias = calendarioMes('2026-02', [...RESERVAS, reserva('X', '2026-02-01', '2026-02-02', 4, { estado: 'cancelada' })])
    expect(dias).toHaveLength(28)
    expect(dias[0].reserva).toBeNull()
    expect(dias[1]).toMatchObject({ dia: 2, esEntrada: true })
    expect(dias[2].reserva).toBeNull()
    expect(dias[4].reserva?.id).toBe('HMDYA2HFPF')
    expect(dias[4].esEntrada).toBe(false)
    expect(dias[13].reserva?.id).toBe('HM5S2ZQJ8N')
    expect(dias[27].reserva?.id).toBe('HM5S2ZQJ8N')
  })
})

describe('resumenMes — la hoja de febrero', () => {
  it('ocupación: 23 noches ocupadas, 5 libres, 82%', () => {
    expect(mes()).toMatchObject({ dias: 28, nochesOcupadas: 23, nochesLibres: 5, ocupacionPct: 82 })
  })
  it('personas: 9 recibidas en 5 estadías, 1.8 en promedio', () => {
    expect(mes()).toMatchObject({ estadias: 5, personas: 9, personasPromedio: 1.8 })
  })
  it('ingresos: los mismos totales por concepto y la acreditación del mes', () => {
    const r = mes()
    const de = (id: string) => r.porConcepto.find(x => x.concepto.id === id)?.total
    expect(de('anfitrion:tarifa_habitacion')).toBe(1314)
    expect(de('anfitrion:tarifa_limpieza')).toBe(145)
    expect(de('anfitrion:descuentos')).toBe(178.26)
    expect(de('anfitrion:servicio_anfitrion')).toBe(38.42)
    expect(de('anfitrion:impuesto')).toBe(153.69)
    expect(de('anfitrion:adicionales')).toBe(0)
    expect(r.acreditado).toBe(1396.01)
    expect(r.totalHuesped).toBe(1617.59)
    expect(r.reservasSinDesglose).toBe(0)
  })
  it('estado del propietario: acreditado − comisión − sus gastos; la administradora absorbe los suyos', () => {
    const r = mes({
      propiedad: propiedad({ comision_pct: 20 }),
      gastos: [gasto('2026-02-03', 100), gasto('2026-02-20', 30, 'administradora'), gasto('2026-03-01', 999)],
    })
    expect(r.comision).toBe(279.2)
    expect(r.gastosPropietario).toBe(100)
    expect(r.gastosAdministradora).toBe(30)
    expect(r.pagoPropietario).toBe(1016.81)
    expect(r.ingresoAdministradora).toBe(249.2)
    expect(r.utilidad).toBe(1266.01)
  })
  it('una reserva sin desglose suma su monto total y se avisa', () => {
    const r = mes({ reservas: [...RESERVAS, reserva('DIRECTA', '2026-02-10', '2026-02-12', 3, { monto_total: 200 })] })
    expect(r.acreditado).toBe(1596.01)
    expect(r.reservasSinDesglose).toBe(1)
    expect(r.nochesOcupadas).toBe(25)
  })
  it('el dinero va al mes de ENTRADA; las noches, al mes en que caen', () => {
    const marzo = mes({ mes: '2026-03' })
    expect(marzo).toMatchObject({ estadias: 0, acreditado: 0, nochesOcupadas: 0, personasPromedio: null })
    const larga = mes({ mes: '2026-03', reservas: [reserva('L', '2026-02-27', '2026-03-05', 2, { monto_total: 700 })], liquidaciones: new Map() })
    expect(larga).toMatchObject({ estadias: 0, acreditado: 0, nochesOcupadas: 4 })
  })
  it('las canceladas no cuentan en nada', () => {
    const r = mes({ reservas: RESERVAS.map(x => ({ ...x, estado: 'cancelada' as const })) })
    expect(r).toMatchObject({ estadias: 0, nochesOcupadas: 0, acreditado: 0 })
  })
})

describe('contratos en el mes', () => {
  const contrato = (extra: Partial<ContratoRenta> = {}): ContratoRenta => ({
    id: 'k1', company_id: 'c1', propiedad_id: 'p1', inquilino_nombre: 'Inq', inquilino_identificacion: null, inquilino_telefono: null,
    inquilino_email: null, fecha_inicio: '2026-01-15', fecha_fin: null, renta_mensual: 800, deposito: null, moneda: 'USD', dia_pago: 5,
    estado: 'vigente', notas: null, created_at: '', updated_at: '', ...extra,
  })
  it('cubre el mes si se cruza con él y no está cancelado', () => {
    expect(contratoCubreMes(contrato(), '2026-02')).toBe(true)
    expect(contratoCubreMes(contrato(), '2025-12')).toBe(false)
    expect(contratoCubreMes(contrato({ fecha_fin: '2026-01-31' }), '2026-02')).toBe(false)
    expect(contratoCubreMes(contrato({ estado: 'cancelado' }), '2026-02')).toBe(false)
    expect(contratoCubreMes(contrato({ estado: 'finalizado', fecha_fin: '2026-02-10' }), '2026-02')).toBe(true)
  })
  it('la renta mensual es lo acreditado y entra en la base de la comisión', () => {
    const r = resumenMes({
      propiedad: propiedad({ tipo_renta: 'largo_plazo', comision_pct: 10 }), mes: '2026-02', reservas: [],
      contratos: [contrato()], gastos: [], conceptos: CONCEPTOS, liquidaciones: new Map(),
    })
    expect(r).toMatchObject({ acreditado: 800, rentaContratos: 800, comision: 80, pagoPropietario: 720, nochesOcupadas: 28, ocupacionPct: 100 })
  })
  it('un contrato que termina a mitad de mes ocupa hasta su último día', () => {
    const r = resumenMes({
      propiedad: propiedad(), mes: '2026-02', reservas: [], contratos: [contrato({ fecha_fin: '2026-02-10' })],
      gastos: [], conceptos: [], liquidaciones: new Map(),
    })
    expect(r.nochesOcupadas).toBe(10)
  })
})

describe('resumenCarteraMes', () => {
  it('una fila por propiedad y totales; la inactiva no entra en la ocupación', () => {
    const otra = propiedad({ id: 'p2', nombre: 'Vacía' })
    const inactiva = propiedad({ id: 'p3', nombre: 'Cerrada', estado: 'inactiva' })
    const c = resumenCarteraMes([propiedad({ comision_pct: 20 }), otra, inactiva], '2026-02', RESERVAS, [], [gasto('2026-02-03', 100)],
      CONCEPTOS, liquidacionesPorReserva(LIQUIDACIONES))
    expect(c.filas.map(f => f.resumen.acreditado)).toEqual([1396.01, 0, 0])
    expect(c.total).toMatchObject({ dias: 56, nochesOcupadas: 23, ocupacionPct: 41, acreditado: 1396.01, comision: 279.2, pagoPropietario: 1016.81 })
  })
})

describe('captura', () => {
  it('importesDeFormulario: vacío no viaja, coma decimal, signo de moneda; inválido → null', () => {
    expect(importesDeFormulario({ a: ' 39 ', b: '', c: '3,90', d: '$ 29.00' })).toEqual({ a: 39, c: 3.9, d: 29 })
    expect(importesDeFormulario({ a: '-5' })).toBeNull()
    expect(importesDeFormulario({ a: 'mucho' })).toBeNull()
  })
  it('codigoDeConcepto: sin acentos ni espacios, y único', () => {
    expect(codigoDeConcepto('Propina extra', new Set())).toBe('propina_extra')
    expect(codigoDeConcepto('Comisión', new Set(['comision']))).toBe('comision_2')
    expect(codigoDeConcepto('¡¡!!', new Set())).toBe('concepto')
  })
})

describe('moneda', () => {
  it('una reserva sin ficha es USD; con ficha, la suya', () => {
    expect(monedaDeReserva({ id: 'x', origen: 'rentas' }, new Map())).toBe('USD')
    const m = liquidacionesPorReserva([{ ...LIQUIDACIONES[0], moneda: 'GTQ' }])
    expect(monedaDeReserva(RESERVAS[0], m)).toBe('GTQ')
    expect(MONEDAS_RENTA[0]).toBe('USD')
    expect(MONEDAS_RENTA).toContain('GTQ')
  })
  it('no se mezclan: lo que está en otra moneda cuenta para la ocupación pero no para el dinero, y se avisa', () => {
    const mixtas = liquidacionesPorReserva(LIQUIDACIONES.map((l, i) => (i === 4 ? { ...l, moneda: 'GTQ' } : l)))
    const usd = mes({ liquidaciones: mixtas, gastos: [gasto('2026-02-03', 100), { ...gasto('2026-02-04', 50), moneda: 'GTQ' }] })
    expect(usd).toMatchObject({ moneda: 'USD', estadias: 5, nochesOcupadas: 23, acreditado: 499.12, gastosPropietario: 100, otrasMonedas: ['GTQ'] })
    const gtq = mes({ liquidaciones: mixtas, moneda: 'GTQ', gastos: [gasto('2026-02-03', 100), { ...gasto('2026-02-04', 50), moneda: 'GTQ' }] })
    expect(gtq).toMatchObject({ moneda: 'GTQ', estadias: 5, acreditado: 896.89, gastosPropietario: 50, otrasMonedas: ['USD'] })
  })
  it('una reserva en otra moneda sin monto alguno no dispara el aviso', () => {
    const sinMonto = reserva('VACIA', '2026-02-10', '2026-02-11', 1)
    const m = liquidacionesPorReserva([...LIQUIDACIONES, { id: 'lv', company_id: 'c1', propiedad_id: 'p1', reserva_id: 'VACIA', reserva_str_id: null, importes: {}, moneda: 'MXN', created_at: '', updated_at: '' }])
    expect(mes({ reservas: [...RESERVAS, sinMonto], liquidaciones: m }).otrasMonedas).toEqual([])
  })
})

describe('tendencia', () => {
  const liq = liquidacionesPorReserva(LIQUIDACIONES)
  const puntos = tendenciaMeses([propiedad({ comision_pct: 20 })], '2026-03', 3, RESERVAS, [], [gasto('2026-02-03', 100)], CONCEPTOS, liq)
  it('un punto por mes, del más antiguo al más reciente, con el mismo cálculo del mes', () => {
    expect(puntos.map(p => p.mes)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(puntos[1]).toMatchObject({ dias: 28, nochesOcupadas: 23, ocupacionPct: 82, estadias: 5, acreditado: 1396.01, gastos: 100, pagoPropietario: 1016.81, ingresoPorNoche: 60.7 })
    expect(puntos[0]).toMatchObject({ acreditado: 0, nochesOcupadas: 0, ingresoPorNoche: null })
  })
  it('sólo cuentan las reservas de las propiedades pedidas', () => {
    const otra = tendenciaMeses([propiedad({ id: 'p9' })], '2026-02', 1, RESERVAS, [], [], CONCEPTOS, liq)
    expect(otra[0]).toMatchObject({ acreditado: 0, estadias: 0 })
  })
  it('resumen del periodo: totales, ocupación sobre todas las noches y el mejor mes', () => {
    const r = resumenTendencia(puntos)
    expect(r).toMatchObject({ acreditado: 1396.01, nochesOcupadas: 23, dias: 90, ocupacionPct: 26, estadias: 5, ingresoPorNoche: 60.7 })
    expect(r.mejorMes?.mes).toBe('2026-02')
    expect(resumenTendencia([puntos[0]]).mejorMes).toBeNull()
    expect(mesCorto('2026-02')).toBe('feb 26')
  })
})
