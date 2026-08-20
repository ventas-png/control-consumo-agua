// Regresión react-hooks/exhaustive-deps (ClienteRentasModal:87).
//
// El efecto solo miraba `[cliente.id]` mientras `fetchData` leía
// `clienteUnidades`, derivado de la prop `unidades`. Si las unidades llegaban
// DESPUÉS del primer render (carga asíncrona del padre — el caso normal al
// abrir el modal), el efecto ya había corrido con la lista vacía, salía por el
// early-return y nunca volvía a intentarlo: contratos y reservas del cliente
// quedaban en blanco de forma permanente.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import type { Cliente, Unidad } from '../../../types'

const h = vi.hoisted(() => ({
  fetchContratosByUnidades: vi.fn(async (): Promise<unknown[]> => []),
  fetchReservasByUnidades: vi.fn(async (): Promise<unknown[]> => []),
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

  // Revisión, punto 5: el early-return por lista vacía solo apagaba el loading y
  // dejaba `contratos`/`reservas` de la carga anterior en el estado. Hoy eso NO
  // llega a verse porque el cuerpo del modal está tras dos guardas
  // (`clienteUnidades.length === 0` → EmptyState, y `loading` → spinner), así
  // que estas pruebas NO fallan contra el código sin corregir: fijan el
  // contrato observable ("no se muestran registros del cliente anterior") para
  // que siga siendo cierto si alguna de esas guardas cambia. La limpieza del
  // estado se hace igual, porque conservarlo es incorrecto en sí mismo.
  it('al quedarse sin unidades NO deja en pantalla los datos del cliente anterior', async () => {
    h.fetchContratosByUnidades.mockResolvedValue([
      {
        id: 'ct-1', unidad_id: 'u1', arrendatario_nombre: 'INQUILINO ANTERIOR',
        fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31',
        monto_renta: 4500, dia_pago: 5, estado: 'activo',
      },
    ])

    const { rerender } = render(modal([unidad('u1', 'cli-1')]))
    await act(async () => {})
    expect(screen.getByText(/INQUILINO ANTERIOR/)).toBeTruthy()

    // El padre cambia a un cliente sin unidades (o se las quitan todas).
    rerender(modal([], { id: 'cli-2', nombre: 'Beto' } as unknown as Cliente))
    await act(async () => {})

    expect(screen.queryByText(/INQUILINO ANTERIOR/)).toBeNull()
    expect(screen.getByText('Este cliente no tiene unidades asignadas')).toBeTruthy()
  })

  it('al recuperar unidades, lo que se pinta viene de la consulta NUEVA', async () => {
    h.fetchContratosByUnidades.mockResolvedValueOnce([
      {
        id: 'ct-1', unidad_id: 'u1', arrendatario_nombre: 'CONTRATO VIEJO',
        fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31',
        monto_renta: 4500, dia_pago: 5, estado: 'activo',
      },
    ])

    const { rerender } = render(modal([unidad('u1', 'cli-1')]))
    await act(async () => {})
    expect(screen.getByText(/CONTRATO VIEJO/)).toBeTruthy()

    rerender(modal([]))
    await act(async () => {})

    // Vuelven unidades: la consulta se relanza y ahora no hay contratos.
    h.fetchContratosByUnidades.mockResolvedValueOnce([])
    rerender(modal([unidad('u2', 'cli-1')]))
    await act(async () => {})

    expect(h.fetchContratosByUnidades).toHaveBeenLastCalledWith(['u2'])
    expect(screen.queryByText(/CONTRATO VIEJO/)).toBeNull()
  })

  it('ignora unidades de otro cliente (el memo filtra por cliente.id)', async () => {
    render(modal([unidad('u1', 'cli-1'), unidad('u9', 'cli-9')]))
    await act(async () => {})

    expect(h.fetchContratosByUnidades).toHaveBeenCalledWith(['u1'])
  })
})
