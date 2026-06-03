import { describe, it, expect } from 'vitest'
import { registrosCalidadToCSV } from '../calidadCSV'
import { TIPOLOGIAS_CALIDAD } from '../../components/calidad/constants'
import type { RegistroCalidad, TipoAgua } from '../../types'

const tipo = Object.keys(TIPOLOGIAS_CALIDAD)[0] as TipoAgua

const reg = (r: Partial<RegistroCalidad>): RegistroCalidad =>
  ({
    id: 'x', fuente_id: 'f', fecha: '2026-05-20T06:00:00.000Z',
    parametros: {}, cumplimiento: {}, cumple_total: false,
    ...r,
  } as RegistroCalidad)

describe('registrosCalidadToCSV (serv:S27)', () => {
  it('arma encabezado con columnas base + parámetros (unión ordenada) + Observaciones', () => {
    const csv = registrosCalidadToCSV([
      reg({ parametros: { turbiedad: 1 } }),
      reg({ parametros: { pH: 7 } }),
    ])
    const header = csv.split('\r\n')[0]
    expect(header).toBe('Fecha,Fuente,Nombre,Tipología,Resultado,% Cumplimiento,pH,turbiedad,Observaciones')
  })

  it('mapea una fila: fecha (YYYY-MM-DD), fuente, tipología (label), resultado, % y parámetros', () => {
    const csv = registrosCalidadToCSV([
      reg({
        fecha: '2026-05-20T06:00:00.000Z',
        fuentes_agua: { identificador: 'P-1', nombre: 'Pozo Norte', tipo_agua: tipo },
        parametros: { pH: 7.2 },
        cumplimiento: { pH: true },
        cumple_total: true,
      }),
    ])
    const fila = csv.split('\r\n')[1]
    expect(fila).toBe(`2026-05-20,P-1,Pozo Norte,${TIPOLOGIAS_CALIDAD[tipo].label},CUMPLE,100,7.2,`)
  })

  it('% Cumplimiento usa los parámetros evaluados (50%) y NO_CUMPLE si cumple_total false', () => {
    const csv = registrosCalidadToCSV([
      reg({ parametros: { pH: 7, turbiedad: 9 }, cumplimiento: { pH: true, turbiedad: false }, cumple_total: false }),
    ])
    const cols = csv.split('\r\n')[1].split(',')
    expect(cols[4]).toBe('NO CUMPLE')
    expect(cols[5]).toBe('50')
  })

  it('parámetro ausente en un análisis queda como celda vacía', () => {
    const csv = registrosCalidadToCSV([
      reg({ parametros: { pH: 7 } }),          // sin turbiedad
      reg({ parametros: { turbiedad: 2 } }),   // sin pH
    ])
    const [, fila1, fila2] = csv.split('\r\n')
    // header: ...,pH,turbiedad,Observaciones → índices 6 (pH) y 7 (turbiedad)
    expect(fila1.split(',')[7]).toBe('') // fila1 sin turbiedad
    expect(fila2.split(',')[6]).toBe('') // fila2 sin pH
  })

  it('escapa comas, comillas y saltos de línea en observaciones (RFC 4180)', () => {
    const csv = registrosCalidadToCSV([
      reg({ observaciones: 'lab "X", muestra\nmañana' }),
    ])
    expect(csv.split('\r\n')[1]).toContain('"lab ""X"", muestra\nmañana"')
  })

  it('lista vacía → solo encabezado (sin columnas de parámetros)', () => {
    const csv = registrosCalidadToCSV([])
    expect(csv).toBe('Fecha,Fuente,Nombre,Tipología,Resultado,% Cumplimiento,Observaciones')
  })
})
