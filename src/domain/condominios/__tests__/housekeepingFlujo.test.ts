// Reglas puras del flujo por pasos (20261031000000). La base es la autoridad; estas
// funciones solo tienen que coincidir con ella.
import { describe, it, expect } from 'vitest'
import {
  clasificarDestinatario, construirEnlaceWhatsApp, esAdminDeTransiciones, etiquetaReserva, filtrarReservas,
  formatearDuracion, horasDedicadas, mensajeErrorFlujo, minutosDedicados, resumenTextoInforme, sugerirReservas,
  transicionPermitida,
} from '../housekeepingFlujo'
import type { ReservaSTRVinculable } from '../../../types'

describe('transicionPermitida (misma matriz que hk_transicion_estado)', () => {
  it('operador: iniciar, finalizar y cancelar; nunca saltar ni reabrir', () => {
    expect(transicionPermitida('pendiente', 'en_proceso', false)).toBe(true)
    expect(transicionPermitida('en_proceso', 'completado', false)).toBe(true)
    expect(transicionPermitida('pendiente', 'cancelado', false)).toBe(true)
    expect(transicionPermitida('en_proceso', 'cancelado', false)).toBe(true)
    expect(transicionPermitida('pendiente', 'completado', false)).toBe(false)
    expect(transicionPermitida('completado', 'en_proceso', false)).toBe(false)
    expect(transicionPermitida('cancelado', 'pendiente', false)).toBe(false)
    expect(transicionPermitida('en_proceso', 'pendiente', false)).toBe(false)
  })
  it('admin: además salta, reabre y reactiva; completado → cancelado no existe para nadie', () => {
    expect(transicionPermitida('pendiente', 'completado', true)).toBe(true)
    expect(transicionPermitida('completado', 'en_proceso', true)).toBe(true)
    expect(transicionPermitida('cancelado', 'pendiente', true)).toBe(true)
    expect(transicionPermitida('completado', 'cancelado', true)).toBe(false)
    expect(transicionPermitida('en_proceso', 'pendiente', true)).toBe(false)
  })
  it('quedarse en el mismo estado siempre vale', () => {
    expect(transicionPermitida('completado', 'completado', false)).toBe(true)
  })
  it('esAdminDeTransiciones: dueño, admin y super_admin', () => {
    expect(esAdminDeTransiciones('company_owner')).toBe(true)
    expect(esAdminDeTransiciones('admin')).toBe(true)
    expect(esAdminDeTransiciones('super_admin')).toBe(true)
    expect(esAdminDeTransiciones('operator')).toBe(false)
    expect(esAdminDeTransiciones(null)).toBe(false)
  })
})

describe('mensajeErrorFlujo', () => {
  it('traduce los prefijos de la base y deja el resto tal cual', () => {
    expect(mensajeErrorFlujo('HK_TRANSICION_INVALIDA: de "pendiente" a "completado"')).toMatch(/Iniciar servicio/)
    expect(mensajeErrorFlujo('HK_RESERVA_FUERA_DE_ALCANCE: …')).toMatch(/mismo proyecto/)
    expect(mensajeErrorFlujo('HK_RESERVA_CANCELADA')).toMatch(/cancelada/)
    expect(mensajeErrorFlujo('HK_RESERVA_UNIDAD_DISTINTA')).toMatch(/unidad/)
    expect(mensajeErrorFlujo('HK_INFORME_NO_COMPLETADO')).toMatch(/finalizado/)
    expect(mensajeErrorFlujo('HK_EMAIL_INVALIDO')).toMatch(/correo/)
    expect(mensajeErrorFlujo('HK_SIN_DESTINATARIOS')).toMatch(/destinatario/)
    expect(mensajeErrorFlujo('otra cosa')).toBe('otra cosa')
  })
})

describe('horas dedicadas', () => {
  it('minutos entre inicio y fin; null si falta algo o el fin es anterior', () => {
    expect(minutosDedicados('2026-11-10T15:00:00Z', '2026-11-10T17:30:00Z')).toBe(150)
    expect(minutosDedicados(null, '2026-11-10T17:30:00Z')).toBeNull()
    expect(minutosDedicados('2026-11-10T18:00:00Z', '2026-11-10T17:30:00Z')).toBeNull()
    expect(minutosDedicados('basura', '2026-11-10T17:30:00Z')).toBeNull()
  })
  it('formatea en horas y minutos', () => {
    expect(formatearDuracion(150)).toBe('2 h 30 min')
    expect(formatearDuracion(120)).toBe('2 h')
    expect(formatearDuracion(45)).toBe('45 min')
    expect(formatearDuracion(0)).toBe('0 min')
    expect(formatearDuracion(null)).toBe('—')
  })
  it('horasDedicadas lee los sellos del servicio', () => {
    expect(horasDedicadas({ iniciado_en: '2026-11-10T15:00:00Z', completado_en: '2026-11-10T15:45:00Z' })).toBe('45 min')
    expect(horasDedicadas({ iniciado_en: null, completado_en: '2026-11-10T15:45:00Z' })).toBe('—')
  })
})

const reservas: ReservaSTRVinculable[] = [
  { id: 'r2', codigo_confirmacion: 'HM-002', huesped_nombre: 'Luis Gómez', fecha_entrada: '2026-11-20', fecha_salida: '2026-11-25', hora_llegada_estimada: null, hora_salida_estimada: null, estado: 'confirmada', unidad_id: 'u2', unidad_nombre: 'Apto 2B', plataforma: 'booking' },
  { id: 'r1', codigo_confirmacion: 'HM-001', huesped_nombre: 'Ana Pérez', fecha_entrada: '2026-11-08', fecha_salida: '2026-11-12', hora_llegada_estimada: '15:00:00', hora_salida_estimada: null, estado: 'en_curso', unidad_id: 'u1', unidad_nombre: 'Apto 1A', plataforma: 'airbnb' },
  { id: 'r7', codigo_confirmacion: null, huesped_nombre: 'Sin unidad', fecha_entrada: '2026-11-30', fecha_salida: '2026-12-02', hora_llegada_estimada: null, hora_salida_estimada: null, estado: 'confirmada', unidad_id: null, unidad_nombre: null, plataforma: 'vrbo' },
]

describe('selector de reservas', () => {
  it('etiquetaReserva: código · huésped · dd/mm → dd/mm; sin código, lo que haya', () => {
    expect(etiquetaReserva(reservas[1])).toBe('HM-001 · Ana Pérez · 08/11 → 12/11')
    expect(etiquetaReserva(reservas[2])).toBe('Sin unidad · 30/11 → 02/12')
    expect(etiquetaReserva({ codigo_confirmacion: null, huesped_nombre: null, fecha_entrada: null, fecha_salida: null })).toBe('Reserva')
  })
  it('sugerirReservas: la unidad elegida primero, luego la que cubre la fecha, luego en curso, luego por entrada', () => {
    expect(sugerirReservas(reservas, { unidadId: 'u2' }).map(r => r.id)).toEqual(['r2', 'r1', 'r7'])
    expect(sugerirReservas(reservas, { fecha: '2026-12-01' }).map(r => r.id)).toEqual(['r7', 'r1', 'r2'])
    expect(sugerirReservas(reservas, {}).map(r => r.id)).toEqual(['r1', 'r2', 'r7'])
  })
  it('sugerirReservas no muta la lista', () => {
    const copia = [...reservas]
    sugerirReservas(reservas, { unidadId: 'u2' })
    expect(reservas).toEqual(copia)
  })
  it('filtrarReservas: por código, huésped o unidad, sin acentos', () => {
    expect(filtrarReservas(reservas, 'perez').map(r => r.id)).toEqual(['r1'])
    expect(filtrarReservas(reservas, 'hm-00').map(r => r.id)).toEqual(['r2', 'r1'])
    expect(filtrarReservas(reservas, '2b').map(r => r.id)).toEqual(['r2'])
    expect(filtrarReservas(reservas, '  ')).toHaveLength(3)
  })
})

describe('destinatario y WhatsApp', () => {
  it('clasificarDestinatario: correo, teléfono o nada', () => {
    expect(clasificarDestinatario(' ana@x.test ')).toEqual({ kind: 'email', valor: 'ana@x.test' })
    expect(clasificarDestinatario('+502 5555-0001')).toEqual({ kind: 'telefono', valor: '50255550001' })
    expect(clasificarDestinatario('(502) 5555 0001')).toEqual({ kind: 'telefono', valor: '50255550001' })
    expect(clasificarDestinatario('12')).toBeNull()
    expect(clasificarDestinatario('ana@')).toBeNull()
    expect(clasificarDestinatario('')).toBeNull()
  })
  it('construirEnlaceWhatsApp: wa.me con el número limpio y el texto codificado', () => {
    expect(construirEnlaceWhatsApp('+502 5555-0001', 'Hola & adiós')).toBe('https://wa.me/50255550001?text=Hola%20%26%20adi%C3%B3s')
    expect(construirEnlaceWhatsApp(null, 'x')).toBe('https://wa.me/?text=x')
  })
  it('resumenTextoInforme: líneas del informe con horas, reserva y textos (o sus ausencias)', () => {
    const t = resumenTextoInforme({
      tipo: 'limpieza_estandar', fecha: '2026-11-10', hora_inicio: '09:00:00',
      iniciado_en: '2026-11-10T15:00:00Z', completado_en: '2026-11-10T17:30:00Z',
      hallazgos_ingreso: 'Polvo', inconvenientes: null, observaciones_cierre: '',
      reserva_str_resumen: { reserva_id: 'r1', codigo_confirmacion: 'HM-001', huesped_nombre: 'Ana Pérez', huesped_telefono: null, huesped_email: null, fecha_entrada: '2026-11-08', fecha_salida: '2026-11-12', hora_llegada_estimada: null, hora_salida_estimada: null, estado: 'en_curso', plataforma: 'airbnb', unidad_id: 'u1', vinculado_en: '2026-11-09T00:00:00Z' },
    }, { unidad: 'Apto 1A', responsable: 'Operador PA1', tipoEtiqueta: 'Limpieza estándar' })
    expect(t.split('\n')).toEqual([
      '🧹 Informe de housekeeping · Limpieza estándar',
      'Unidad: Apto 1A · Fecha: 10/11/2026 · ingreso tentativo 09:00',
      'Responsable: Operador PA1',
      'Horas dedicadas: 2 h 30 min',
      'Reserva: HM-001 · Ana Pérez · 08/11 → 12/11',
      'Estado al ingresar: Polvo',
      'Inconvenientes: ninguno',
      'Resultado: sin observaciones',
    ])
  })
})
