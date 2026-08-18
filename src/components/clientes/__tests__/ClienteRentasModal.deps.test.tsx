// Regresión react-hooks/exhaustive-deps (ClienteRentasModal:87).
//
// El efecto solo miraba `[cliente.id]` mientras `fetchData` leía
// `clienteUnidades`, derivado de la prop `unidades`. Si las unidades llegaban
// DESPUÉS del primer render (carga asíncrona del padre — el caso normal al
// abrir el modal), el efecto ya había corrido con la lista vacía, salía por el
// early-return y nunca volvía a intentarlo: contratos y reservas del cliente
// quedaban en blanco de forma permanente.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import type { Cliente, Unidad } from '../../../types'

const h = vi.hoisted(() => ({
  fetchContratosByUnidades: vi.fn(async () => []),
  fetchReservasByUnidades: vi.fn(async () => []),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../domain/clientes/queries', () => ({
  fetchContratosByUnidades: h.fetchContratosByUnidades,
  fetchReservasByUnidades: h.fetchReservasByUnidades,
}))
vi.mock('../../../domain/clientes/mutations', () => ({
  createContrato: vi.fn(), updateContrato: vi.fn(), deleteContrato: vi.fn(),
  createReserva: vi.fn(), updateReserva: vi.fn(), deleteReserva: vi.fn(),
}))

const { ClienteRentasModal } = await import('../ClienteRentasModal')

const cliente = { id: 'cli-1', nombre: 'Ana' } as unknown as Cliente

function unidad(id: string, clienteId: string): Unidad {
  return { id, nombre: id, cliente_id: clienteId, activo: true } as unknown as Unidad
}

function modal(unidades: Unidad[], c: Cliente = cliente) {
  return (
    <ClienteRentasModal
      cliente={c} unidades={unidades} companyId="c1" canEdit
      onClose={() => {}}
    />
  )
}

beforeEach(() => {
  h.fetchContratosByUnidades.mockClear()
  h.fetchReservasByUnidades.mockClear()
})

afterEach(cleanup)

describe('ClienteRentasModal — el efecto declara `fetchData`', () => {
  it('consulta cuando las unidades llegan DESPUÉS del primer render', async () => {
    const { rerender } = render(modal([]))
    await act(async () => {})
    expect(h.fetchContratosByUnidades).not.toHaveBeenCalled()

    // El padre termina de cargar las unidades: antes esto no disparaba nada.
    rerender(modal([unidad('u1', 'cli-1')]))
    await act(async () => {})

    expect(h.fetchContratosByUnidades).toHaveBeenCalledWith(['u1'])
    expect(h.fetchReservasByUnidades).toHaveBeenCalledWith(['u1'])
  })

  it('vuelve a consultar si cambia el conjunto de unidades del cliente', async () => {
    const { rerender } = render(modal([unidad('u1', 'cli-1')]))
    await act(async () => {})
    expect(h.fetchContratosByUnidades).toHaveBeenLastCalledWith(['u1'])

    rerender(modal([unidad('u1', 'cli-1'), unidad('u2', 'cli-1')]))
    await act(async () => {})

    expect(h.fetchContratosByUnidades).toHaveBeenLastCalledWith(['u1', 'u2'])
  })

  it('NO consulta de nuevo al re-renderizar con el mismo array (sin ciclo)', async () => {
    const unidades = [unidad('u1', 'cli-1')]
    const { rerender } = render(modal(unidades))
    await act(async () => {})
    rerender(modal(unidades))
    rerender(modal(unidades))
    await act(async () => {})

    expect(h.fetchContratosByUnidades).toHaveBeenCalledTimes(1)
  })

  it('ignora unidades de otro cliente (el memo filtra por cliente.id)', async () => {
    render(modal([unidad('u1', 'cli-1'), unidad('u9', 'cli-9')]))
    await act(async () => {})

    expect(h.fetchContratosByUnidades).toHaveBeenCalledWith(['u1'])
  })
})
