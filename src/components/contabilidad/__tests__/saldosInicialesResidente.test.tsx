// Saldos iniciales por residente: pegar, previsualizar y cargar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CuotaSaldoInicialFila, CuotaSaldoInicialInput } from '../../../types/contabilidad'

type Vars = { projectId: string; fecha: string; filas: CuotaSaldoInicialInput[]; aplicar: boolean; contrapartidaCuentaId: string | null }

const h = vi.hoisted(() => ({
  llamadas: [] as unknown[],
  responder: (_v: unknown): unknown[] => [],
  error: null as Error | null,
  especiales: [] as unknown[],
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify }))
vi.mock('../../../domain/contabilidad/mutations', () => ({
  useCuotasSaldoInicialMutation: () => ({
    isPending: false,
    mutateAsync: async (vars: unknown) => {
      h.llamadas.push(vars)
      if (h.error) throw h.error
      return h.responder(vars)
    },
  }),
}))
vi.mock('../../../domain/contabilidad/queries', () => ({
  useUnidadesLedgerQuery: () => ({ data: [{ id: 'u14', nombre: 'Casa 14' }, { id: 'u15', nombre: 'Casa 15' }], isLoading: false }),
  useCuentasQuery: () => ({ data: [
    { id: 'cxc', codigo: '1103', nombre: 'Cuotas por cobrar', es_detalle: true, activa: true },
    { id: 'tit', codigo: '11', nombre: 'Activo corriente', es_detalle: false, activa: true },
  ] }),
  useCuentasEspecialesQuery: () => ({ data: h.especiales }),
}))

import { SaldosInicialesResidenteModal } from '../SaldosInicialesResidenteModal'

const fila = (c: Partial<CuotaSaldoInicialFila>): CuotaSaldoInicialFila => ({
  fila: 1, unidad_id: 'u14', unidad_nombre: 'Casa 14', responsable_cliente_id: 'c1', responsable_nombre: 'Ana Pérez',
  periodo: '2026-02', tipo_cargo: 'mantenimiento', monto: 600, mora: 0, fecha_vencimiento: '2026-02-15',
  resultado: 'previsualizacion', motivo: null, cuota_id: null, asiento_id: null, ...c,
})

const PEGADO = 'Unidad\tPeriodo\tMonto\tVencimiento\tMora\n'
  + 'Casa 14\t2026-02\t600\t15/02/2026\t25\n'
  + 'Casa 99\t2026-02\t600\n'
  + 'Casa 15\t03/2026\t650\n'

describe('SaldosInicialesResidenteModal', () => {
  beforeEach(() => {
    h.llamadas = []; h.error = null; h.notify.mockReset()
    h.especiales = [{ evento: 'resultados_acumulados', cuenta_id: 'ra', codigo: '3201', nombre: 'Resultados acumulados' }]
    h.responder = (v) => {
      const { aplicar } = v as Vars
      return [
        fila({ fila: 1, mora: 25, resultado: aplicar ? 'cargada' : 'previsualizacion' }),
        fila({ fila: 2, unidad_id: 'u15', unidad_nombre: 'Casa 15', responsable_nombre: null, periodo: '2026-03', monto: 650,
          fecha_vencimiento: null, resultado: 'rechazada', motivo: 'La unidad no tiene un responsable de pago único.' }),
      ]
    }
  })
  afterEach(cleanup)

  const abrir = (puedeAplicar = true) =>
    render(<SaldosInicialesResidenteModal companyId="c" projectId="p1" monedaBase="GTQ" puedeAplicar={puedeAplicar} onClose={vi.fn()} />)
  const pegar = (texto = PEGADO) => fireEvent.change(screen.getByLabelText('Cuotas pendientes'), { target: { value: texto } })

  it('previsualiza: envía solo los renglones legibles y muestra cada uno con su estado y motivo', async () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Fecha de saldos iniciales'), { target: { value: '2026-06-30' } })
    pegar()
    fireEvent.click(screen.getByRole('button', { name: /Previsualizar/ }))
    await waitFor(() => expect(screen.getByText('Lista para cargar')).toBeTruthy())

    const v = h.llamadas[0] as Vars
    expect(v).toMatchObject({ projectId: 'p1', fecha: '2026-06-30', aplicar: false, contrapartidaCuentaId: null })
    expect(v.filas).toEqual([
      { unidad_id: 'u14', periodo: '2026-02', monto: 600, fecha_vencimiento: '2026-02-15', mora: 25, tipo_cargo: 'mantenimiento' },
      { unidad_id: 'u15', periodo: '2026-03', monto: 650, fecha_vencimiento: null, mora: 0, tipo_cargo: 'mantenimiento' },
    ])
    // el renglón ilegible no viajó y se explica aquí; el rechazado por el servidor trae su motivo
    expect(screen.getByText('No se envió')).toBeTruthy()
    expect(screen.getByText(/No hay una unidad llamada «Casa 99»/)).toBeTruthy()
    expect(screen.getByText('Rechazada')).toBeTruthy()
    expect(screen.getByText('La unidad no tiene un responsable de pago único.')).toBeTruthy()
    expect(screen.getByText(/Ana Pérez/)).toBeTruthy()
    // listas: 600 + 25 de mora
    expect(screen.getByText(/Listas para cargar/).textContent).toMatch(/625\.00/)
    expect((screen.getByRole('button', { name: /Cargar 1 cuota/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('carga, avisa cuántas entraron y cuántas no, y no deja cargar dos veces', async () => {
    abrir()
    pegar()
    fireEvent.click(screen.getByRole('button', { name: /Previsualizar/ }))
    await waitFor(() => expect(screen.getByText('Lista para cargar')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Cargar 1 cuota/ }))
    await waitFor(() => expect(screen.getByText('Cargada')).toBeTruthy())
    expect((h.llamadas[1] as Vars).aplicar).toBe(true)
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'warning', text: expect.stringMatching(/1 cuota\(s\) por .*625\.00.*2 renglón\(es\) no entraron/),
    }))
    expect((screen.getByRole('button', { name: /Cargar cuotas/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('la contrapartida elegida viaja; solo se ofrecen cuentas de detalle', async () => {
    abrir()
    const sel = screen.getByLabelText('Contrapartida') as HTMLSelectElement
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual([
      'Resultados acumulados (3201 · Resultados acumulados)', '1103 · Cuotas por cobrar',
    ])
    fireEvent.change(sel, { target: { value: 'cxc' } })
    pegar('Casa 14\t2026-02\t600')
    fireEvent.click(screen.getByRole('button', { name: /Previsualizar/ }))
    await waitFor(() => expect(h.llamadas).toHaveLength(1))
    expect((h.llamadas[0] as Vars).contrapartidaCuentaId).toBe('cxc')
  })

  it('sin «Resultados acumulados» asignada avisa y no deja previsualizar hasta elegir otra cuenta', () => {
    h.especiales = [{ evento: 'resultados_acumulados', cuenta_id: null, codigo: null, nombre: null }]
    abrir()
    pegar('Casa 14\t2026-02\t600')
    expect(screen.getByRole('alert').textContent).toMatch(/no tiene asignada la cuenta «Resultados acumulados»/)
    const ver = screen.getByRole('button', { name: /Previsualizar/ }) as HTMLButtonElement
    expect(ver.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Contrapartida'), { target: { value: 'cxc' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(ver.disabled).toBe(false)
  })

  it('editar lo pegado descarta la vista previa; sin permiso no hay botón de cargar', async () => {
    abrir(false)
    expect(screen.queryByRole('button', { name: /Cargar/ })).toBeNull()
    expect(screen.getByText(/Solo puede previsualizar/)).toBeTruthy()
    pegar()
    fireEvent.click(screen.getByRole('button', { name: /Previsualizar/ }))
    await waitFor(() => expect(screen.getByText('Lista para cargar')).toBeTruthy())
    pegar(PEGADO + 'Casa 14\t2026-04\t600\n')
    expect(screen.queryByText('Lista para cargar')).toBeNull()
  })

  it('si ningún renglón es legible no llama al servidor; el error del servidor se muestra tal cual', async () => {
    abrir()
    pegar('Casa 99\t2026-02\t600')
    fireEvent.click(screen.getByRole('button', { name: /Previsualizar/ }))
    await waitFor(() => expect(screen.getByText('No se envió')).toBeTruthy())
    expect(h.llamadas).toHaveLength(0)

    h.error = new Error('El ejercicio 2025 de esta contabilidad está cerrado; elige una fecha de un ejercicio abierto.')
    pegar('Casa 14\t2026-02\t600')
    fireEvent.click(screen.getByRole('button', { name: /Previsualizar/ }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: expect.stringMatching(/ejercicio 2025/) })))
  })
})
