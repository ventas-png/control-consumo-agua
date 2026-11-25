import { describe, it, expect } from 'vitest'
import { hojasExcelHistorial, nombreArchivoHistorial } from '../historialExcel'
import type { HistorialFiltros } from '../historialFiltros'
import type { FilaLectura } from '../historialImportado'
import type { Contador, Registro, Unidad } from '../../types'

const contador = { id: 'c1', numero_serie: 'VSC3-281', unidad_id: 'u1', tipo_agua: 'potable' } as unknown as Contador
const unidad = { id: 'u1', nombre: 'Casa 7', project_id: 'p1' } as unknown as Unidad
const proyectos = [{ id: 'p1', nombre: 'Viñas del Sur' }, { id: 'p2', nombre: 'Otro' }]
const sinFiltros: HistorialFiltros = { texto: '', estado: '', proyecto: '', unidad: '', tipoAgua: '', fechaInicio: '', fechaFin: '' }

function reg(partial: Partial<Registro>): FilaLectura {
  return {
    id: 'r1', cliente_id: 'cl1', cliente_nombre: 'Ana López', contador_id: 'c1', project_id: 'p1',
    fecha: '2026-11-25T15:30:00', lectura_anterior: 1473, lectura_actual: 1485, consumo: 12,
    tarifa_aplicada: 8, canon_aplicado: 18, monto_calculado: 114, tipo_cobro: 'Consumo', estado: 'pendiente',
    ...partial,
  }
}

const ctx = {
  contadoresById: new Map([[contador.id, contador]]),
  unidades: [unidad],
  proyectos,
  moneda: 'Q',
  totalDe: (r: Registro) => r.monto_calculado,
  tiposAgua: { potable: 'Agua Potable' },
}

describe('hojasExcelHistorial', () => {
  const filas: FilaLectura[] = [
    reg({}),
    reg({ id: 'r2', estado: 'pagado', monto_calculado: 28.5, consumo: 3, fecha_pago: '2026-11-26T10:00:00', notas: 'Pagó en caja' }),
    reg({ id: 'r3', estado: 'mora', monto_calculado: 50.004 }),
    // Fila del historial importado: sólo se anotó el consumo.
    { ...reg({ id: 'hist:h1', estado: 'historico' as Registro['estado'], fecha: '2026-10-31T12:00:00', lectura_actual: 0, monto_calculado: 0 }),
      historico: { lectura: null, anterior: 130, consumo: 12 } },
  ]

  it('la hoja «Lecturas» lleva una fila por lectura con los números como números', () => {
    const [lecturas] = hojasExcelHistorial(filas, sinFiltros, ctx, new Date(2026, 10, 25, 9, 5))
    expect(lecturas.name).toBe('Lecturas')
    expect(lecturas.rows[0]).toEqual([
      'Fecha', 'Proyecto', 'Unidad', 'Cliente', '# Contador', 'Tipo de agua',
      'Lectura anterior', 'Lectura actual', 'Consumo (m³)', 'Total (Q)', 'Estado', 'Fecha de pago', 'Notas',
    ])
    expect(lecturas.rows[1]).toEqual([
      '2026-11-25', 'Viñas del Sur', 'Casa 7', 'Ana López', 'VSC3-281', 'Agua Potable',
      1473, 1485, 12, 114, 'Pendiente', '', '',
    ])
    expect(lecturas.rows[2].slice(9)).toEqual([28.5, 'Pagado', '2026-11-26', 'Pagó en caja'])
    expect(lecturas.rows[3][9]).toBe(50)
    expect(lecturas.rows).toHaveLength(5)
  })

  it('una lectura importada deja en blanco lo que no se anotó y no tiene total ni estado de pago', () => {
    const [lecturas] = hojasExcelHistorial(filas, sinFiltros, ctx)
    expect(lecturas.rows[4].slice(0, 1)).toEqual(['2026-10-31'])
    expect(lecturas.rows[4].slice(6)).toEqual([130, '', 12, '', 'Histórico (importado)', '', ''])
  })

  it('la hoja «Resumen» dice los filtros aplicados y los totales sin el historial importado', () => {
    const filtros: HistorialFiltros = { ...sinFiltros, proyecto: 'p1', unidad: 'u1', estado: 'pendiente', tipoAgua: 'potable', fechaInicio: '2026-11-01', texto: ' ana ' }
    const [, resumen] = hojasExcelHistorial(filas, filtros, ctx, new Date(2026, 10, 25, 9, 5))
    const valor = (etiqueta: string) => resumen.rows.find(r => r[0] === etiqueta)?.[1]
    expect(resumen.name).toBe('Resumen')
    expect(valor('Generado')).toBe('2026-11-25 09:05')
    expect(valor('Proyecto')).toBe('Viñas del Sur')
    expect(valor('Unidad')).toBe('Casa 7')
    expect(valor('Estado')).toBe('Pendiente')
    expect(valor('Tipo de agua')).toBe('Agua Potable')
    expect(valor('Desde')).toBe('2026-11-01')
    expect(valor('Hasta')).toBe('—')
    expect(valor('Búsqueda')).toBe('ana')
    expect(valor('Lecturas')).toBe(3)
    expect(valor('Consumo (m³)')).toBe(27)
    expect(valor('Total (Q)')).toBe(192.5)
    expect(valor('Pagado (Q)')).toBe(28.5)
    expect(valor('Pendiente (Q)')).toBe(114)
    expect(valor('En mora (Q)')).toBe(50)
    expect(valor('Lecturas del historial importado')).toBe(1)
  })

  it('sin filtros, el resumen dice «Todos»', () => {
    const [, resumen] = hojasExcelHistorial([], sinFiltros, ctx)
    expect(resumen.rows.find(r => r[0] === 'Proyecto')?.[1]).toBe('Todos')
    expect(resumen.rows.find(r => r[0] === 'Lecturas')?.[1]).toBe(0)
  })
})

describe('nombreArchivoHistorial', () => {
  it('incluye el proyecto filtrado sin acentos ni espacios', () => {
    expect(nombreArchivoHistorial({ ...sinFiltros, proyecto: 'p1' }, proyectos, '2026-11-25')).toBe('historial-lecturas-vinas-del-sur-2026-11-25')
    expect(nombreArchivoHistorial(sinFiltros, proyectos, '2026-11-25')).toBe('historial-lecturas-2026-11-25')
  })
})
