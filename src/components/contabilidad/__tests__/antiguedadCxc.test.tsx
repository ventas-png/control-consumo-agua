// Antigüedad de saldos por cobrar y PDF del estado de cuenta.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AntiguedadCxcFila, EstadoCuenta } from '../../../types/contabilidad'

const h = vi.hoisted(() => ({
  filas: [] as unknown[],
  error: null as Error | null,
  cortes: [] as (string | null | undefined)[],
  excel: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../condominios/exportUtils', () => ({ exportarExcel: h.excel }))
vi.mock('../../../domain/contabilidad/queries', () => ({
  useCxcAntiguedadQuery: (_c: string, _p: string | null, corte?: string | null) => {
    h.cortes.push(corte)
    return { data: h.error ? undefined : h.filas, isLoading: false, isError: !!h.error, error: h.error, refetch: vi.fn() }
  },
}))

import { AntiguedadCxcPanel, totalesAntiguedad } from '../AntiguedadCxcPanel'
import { construirEstadoCuentaPdf, nombreArchivoEstadoCuenta, periodoEstadoCuenta } from '../estadoCuentaPdf'

const fila = (c: Partial<AntiguedadCxcFila>): AntiguedadCxcFila => ({
  cliente_id: 'c1', cliente_nombre: 'Ana Pérez', codigo_auxiliar: 'AUX-00001', unidad_id: 'u1', unidad_nombre: 'Casa 14',
  por_vencer: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_mas: 0, sin_asignar: 0, total: 0, vencimiento_mas_antiguo: null, ...c,
})

describe('totalesAntiguedad', () => {
  it('suma cada columna a centavos (sin arrastre de coma flotante)', () => {
    const t = totalesAntiguedad([fila({ d1_30: 0.1, total: 0.1 }), fila({ d1_30: 0.2, total: 0.2 }), fila({ sin_asignar: -50, total: -50 })])
    expect(t.d1_30).toBe(0.3)
    expect(t.sin_asignar).toBe(-50)
    expect(t.total).toBe(-49.7)
  })
})

describe('AntiguedadCxcPanel', () => {
  beforeEach(() => {
    h.error = null; h.cortes = []; h.excel.mockReset()
    h.filas = [
      fila({ por_vencer: 200, d1_30: 30, d61_90: 470, total: 700, vencimiento_mas_antiguo: '2026-04-20' }),
      fila({ cliente_id: 'c2', cliente_nombre: 'Luis Gómez', unidad_id: null, unidad_nombre: null, codigo_auxiliar: null, d90_mas: 1200, total: 1200 }),
    ]
  })
  afterEach(cleanup)

  it('muestra cada residente con sus tramos, el pie y el total por cobrar y vencido', () => {
    render(<AntiguedadCxcPanel companyId="c" projectId="p" monedaBase="GTQ" />)
    expect(screen.getByText('Ana Pérez')).toBeTruthy()
    expect(screen.getByText(/Casa 14 · AUX-00001 · vence desde/)).toBeTruthy()
    expect(screen.getByText('Totales (2)')).toBeTruthy()
    // por cobrar 1,900; vencido = 30 + 470 + 1,200 = 1,700 (lo por vencer no cuenta como vencido)
    expect(screen.getByText(/Por cobrar/).textContent).toMatch(/1,900\.00.*vencido.*1,700\.00/)
    // sin saldos «sin asignar», la columna no estorba
    expect(screen.queryByText('Sin asignar')).toBeNull()
  })

  it('«Sin asignar» aparece, con su explicación, solo cuando alguien pagó de más', () => {
    h.filas = [fila({ sin_asignar: -50, total: -50 })]
    render(<AntiguedadCxcPanel companyId="c" projectId="p" monedaBase="GTQ" />)
    expect(screen.getByText('Sin asignar')).toBeTruthy()
    expect(screen.getByText(/abonos de más/)).toBeTruthy()
  })

  it('«Ver estado» entrega la fila; cambiar el corte vuelve a consultar con esa fecha', () => {
    const onVerEstado = vi.fn()
    render(<AntiguedadCxcPanel companyId="c" projectId="p" monedaBase="GTQ" onVerEstado={onVerEstado} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver estado' })[1])
    expect(onVerEstado).toHaveBeenCalledWith(expect.objectContaining({ cliente_id: 'c2', unidad_id: null }))
    fireEvent.change(screen.getByLabelText('Al corte'), { target: { value: '2026-04-30' } })
    expect(h.cortes.at(-1)).toBe('2026-04-30')
  })

  it('exporta a Excel lo mismo que se ve, con un nombre que lleva el corte', () => {
    render(<AntiguedadCxcPanel companyId="c" projectId="p" monedaBase="GTQ" />)
    fireEvent.change(screen.getByLabelText('Al corte'), { target: { value: '2026-06-30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Exportar Excel' }))
    const [nombre, hojas] = h.excel.mock.calls[0]
    expect(nombre).toBe('antiguedad-saldos-por-cobrar-2026-06-30.xlsx')
    expect(hojas[0].rows[0]).toEqual(['Ana Pérez', 'AUX-00001', 'Casa 14', 200, 30, 0, 470, 0, 0, 700, '2026-04-20'])
  })

  it('sin saldos lo dice; si la consulta falla lo dice, en vez de «sin saldos»', () => {
    h.filas = []
    const { unmount } = render(<AntiguedadCxcPanel companyId="c" projectId="p" monedaBase="GTQ" />)
    expect(screen.getByText(/Sin saldos por cobrar al/)).toBeTruthy()
    unmount()
    h.error = new Error('No autorizado para ver la contabilidad.')
    render(<AntiguedadCxcPanel companyId="c" projectId="p" monedaBase="GTQ" />)
    expect(screen.getByRole('alert').textContent).toMatch(/No autorizado para ver la contabilidad/)
    expect(screen.queryByText(/Sin saldos por cobrar/)).toBeNull()
  })
})

describe('PDF del estado de cuenta', () => {
  const estado = {
    sujeto: { tipo: 'unidad', id: 'u1', nombre: 'Casa 14 — Ñandú', codigo_auxiliar: null },
    project_id: 'p', desde: '2026-01-01', hasta: '2026-06-30',
    resumen: { saldo_inicial: 0, cargos: 1430, abonos: 730, saldo_final: 700, movimientos: 120 },
    por_tipo: [], fuera_de_saldo: [], limite: 500, offset: 0,
    movimientos: Array.from({ length: 120 }, (_, i) => ({
      n: i + 1, fecha: '2026-03-01', asiento_numero: i + 1, documento: `Cuota ${i + 1}`, concepto: 'Mantenimiento',
      cargo: i % 2 ? 0 : 10, abono: i % 2 ? 5 : 0, saldo: 700, es_reverso: false,
    })),
    saldo_a_favor: { saldo_inicial: 0, abonos: 70, aplicaciones: 0, saldo_final: 70, saldo_documentos: 70, cuadra: true, total_movimientos: 1, movimientos: [] },
  } as unknown as EstadoCuenta

  it('el período y el nombre del archivo se dicen igual para el mismo sujeto y corte', () => {
    expect(periodoEstadoCuenta('2026-01-01', '2026-06-30')).toMatch(/^Del .* al /)
    expect(periodoEstadoCuenta(null, '2026-06-30')).toMatch(/^Al /)
    expect(periodoEstadoCuenta(null, null)).toBe('Todos los movimientos')
    expect(nombreArchivoEstadoCuenta(estado)).toBe('estado-cuenta-casa-14-nandu-al-2026-06-30.pdf')
    expect(nombreArchivoEstadoCuenta({ sujeto: null, hasta: null })).toBe('estado-cuenta-sujeto.pdf')
  })

  it('imprime TODOS los movimientos recibidos (varias páginas), no una página de pantalla', () => {
    const doc = construirEstadoCuentaPdf({ entidadNombre: 'Residencial Demo', monedaBase: 'GTQ', estado })
    expect(doc.getNumberOfPages()).toBeGreaterThan(1)
    const texto = JSON.stringify(doc.output())
    expect(texto).toContain('Estado de cuenta')
    expect(texto).toContain('Cuota 120')
    expect(texto).toContain('Saldo a favor disponible')
  })
})
