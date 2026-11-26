// Conciliar un movimiento del banco eligiendo uno o varios documentos a mano.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { BancoMovimiento, CandidatoConciliacion } from '../../../types/bancos'

const h = vi.hoisted(() => ({
  candidatos: [] as unknown[],
  busquedas: [] as (string | undefined)[],
  errorCarga: null as Error | null,
  llamadas: [] as unknown[],
  errorConciliar: null as Error | null,
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify }))
vi.mock('../../../domain/bancos/queries', () => ({
  useCandidatosConciliacionQuery: (_id: string, buscar?: string) => {
    h.busquedas.push(buscar)
    return { data: h.errorCarga ? undefined : h.candidatos, isLoading: false, isError: !!h.errorCarga, error: h.errorCarga }
  },
}))
vi.mock('../../../domain/bancos/mutations', () => ({
  useConciliarVariosMutation: () => ({
    isPending: false,
    mutateAsync: async (v: unknown) => { h.llamadas.push(v); if (h.errorConciliar) throw h.errorConciliar; return {} },
  }),
}))

import { ConciliarVariosModal } from '../ConciliarVariosModal'

const mov = (c: Partial<BancoMovimiento> = {}): BancoMovimiento => ({
  id: 'm1', company_id: 'c', project_id: 'p1', cuenta_bancaria_id: 'cb', fecha: '2026-06-10', descripcion: 'Depósito del día',
  referencia: 'D-1', monto: 1850, lote_id: null, estado: 'pendiente', match_tipo: null, match_id: null,
  conciliado_por: null, conciliado_at: null, created_at: '2026-06-10T00:00:00Z', ...c,
})
const cand = (id: string, monto: number, c: Partial<CandidatoConciliacion> = {}): CandidatoConciliacion => ({
  candidato_tipo: 'pago', candidato_id: id, fecha: '2026-06-10', monto, descripcion: `Casa ${id} · Pago deposito`, referencia: `B-${id}`, ...c,
})

describe('ConciliarVariosModal', () => {
  beforeEach(() => {
    h.candidatos = [cand('1', 600), cand('2', 600), cand('3', 650), cand('4', 75)]
    h.busquedas = []; h.errorCarga = null; h.llamadas = []; h.errorConciliar = null; h.notify.mockReset()
  })
  afterEach(cleanup)

  const marcar = (id: string) => fireEvent.click(screen.getByLabelText(new RegExp(`Elegir Casa ${id} `)))
  const boton = () => screen.getByRole('button', { name: 'Conciliar' }) as HTMLButtonElement

  it('solo deja conciliar cuando lo elegido suma exactamente el movimiento, y dice cuánto falta o sobra', async () => {
    const onClose = vi.fn()
    render(<ConciliarVariosModal movimiento={mov()} moneda="GTQ" onClose={onClose} />)
    expect(boton().disabled).toBe(true)
    marcar('1'); marcar('2')
    expect(screen.getByRole('status').textContent).toMatch(/2 elegido\(s\).*1,200\.00.*faltan.*650\.00/)
    expect(boton().disabled).toBe(true)
    marcar('3'); marcar('4')
    expect(screen.getByRole('status').textContent).toMatch(/sobran.*75\.00/)
    marcar('4')
    expect(screen.getByRole('status').textContent).toMatch(/3 elegido\(s\).*1,850\.00.*cuadra/)
    expect(boton().disabled).toBe(false)

    fireEvent.click(boton())
    await waitFor(() => expect(h.llamadas).toEqual([{ movimientoId: 'm1', documentoIds: ['1', '2', '3'] }]))
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', text: expect.stringMatching(/3 documento\(s\).*1,850\.00/) }))
    expect(onClose).toHaveBeenCalled()
  })

  it('un retiro se compara por su importe absoluto y habla de órdenes de pago', () => {
    h.candidatos = [cand('8', 300, { candidato_tipo: 'orden_pago' }), cand('9', 400, { candidato_tipo: 'orden_pago' })]
    render(<ConciliarVariosModal movimiento={mov({ monto: -700, descripcion: 'Transferencia' })} moneda="GTQ" onClose={vi.fn()} />)
    expect(screen.getByText(/Conciliar retiro: elegir pagos a proveedores/)).toBeTruthy()
    marcar('8'); marcar('9')
    expect(screen.getByRole('status').textContent).toMatch(/cuadra/)
    expect(boton().disabled).toBe(false)
  })

  it('buscar consulta al servidor y lo ya marcado se conserva aunque deje de verse', () => {
    render(<ConciliarVariosModal movimiento={mov()} moneda="GTQ" onClose={vi.fn()} />)
    marcar('1')
    h.candidatos = [cand('3', 650)]
    fireEvent.change(screen.getByLabelText('Buscar documento'), { target: { value: 'B-3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(h.busquedas.at(-1)).toBe('B-3')
    expect(screen.queryByLabelText(/Elegir Casa 1 /)).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/1 elegido\(s\).*600\.00/)
  })

  it('sin documentos lo dice; un error de carga no se confunde con «no hay»', () => {
    h.candidatos = []
    const { unmount } = render(<ConciliarVariosModal movimiento={mov()} moneda="GTQ" onClose={vi.fn()} />)
    expect(screen.getByText(/No hay cobros verificados sin conciliar/)).toBeTruthy()
    unmount()
    h.errorCarga = new Error('permiso denegado')
    render(<ConciliarVariosModal movimiento={mov()} moneda="GTQ" onClose={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toMatch(/permiso denegado/)
    expect(screen.queryByText(/No hay cobros/)).toBeNull()
  })

  it('el rechazo del servidor se muestra y el modal no se cierra', async () => {
    h.errorConciliar = new Error('Alguno de los documentos ya está conciliado con otro movimiento del banco.')
    const onClose = vi.fn()
    render(<ConciliarVariosModal movimiento={mov({ monto: 600 })} moneda="GTQ" onClose={onClose} />)
    marcar('1')
    fireEvent.click(boton())
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: expect.stringMatching(/ya está conciliado/) })))
    expect(onClose).not.toHaveBeenCalled()
  })
})
