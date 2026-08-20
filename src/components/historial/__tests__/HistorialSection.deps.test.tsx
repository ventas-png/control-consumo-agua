// Regresión react-hooks/exhaustive-deps (HistorialSection:316).
//
// El memo `columns` no declaraba `enviarWhatsApp` ni `eliminarRegistro`. Ambas
// eran funciones sueltas, así que las columnas quedaban con la closure del
// primer render: como `clientes` TAMPOCO estaba en las deps del memo, si el
// listado de clientes terminaba de cargar después (lo normal: viaja en otra
// consulta), el botón de WhatsApp seguía respondiendo "este cliente no tiene
// teléfono" para siempre. Ahora las dos son useCallback con sus deps reales y
// el memo las declara.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Registro, Cliente, Contador } from '../../../types'

const h = vi.hoisted(() => ({ deleteRegistro: vi.fn(async () => ({ error: null, count: 1 })) }))

vi.mock('../../../domain/agua/mutations', () => ({
  updateRegistro: vi.fn(async () => ({ error: null })),
  deleteRegistro: h.deleteRegistro,
}))
vi.mock('../../shared/Dialog', () => ({
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
}))
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) } }))

import { HistorialSection } from '../HistorialSection'

const registro: Registro = {
  id: 'reg-1', cliente_id: 'cli-1', cliente_nombre: 'Melba Girón',
  contador_id: 'cont-1', fecha: '2026-11-25',
  lectura_anterior: 1205, lectura_actual: 1208, consumo: 3,
  tarifa_aplicada: 25, tarifa_exceso_aplicada: 30, canon_aplicado: 20,
  monto_calculado: 75, tipo_cobro: 'Consumo con Exceso', estado: 'pendiente',
  mes: 'Noviembre 2026',
} as unknown as Registro

const cliente = { id: 'cli-1', nombre: 'Melba Girón', telefono: '55551234' } as unknown as Cliente
const contadores = [{ id: 'cont-1', numero_serie: 'CVH 3 70367900' } as unknown as Contador]

function seccion(clientes: Cliente[], onRegistroDeleted?: (id: string) => void) {
  return (
    <HistorialSection
      registros={[registro]} clientes={clientes} contadores={contadores}
      userRole="admin" moneda="Q" canEdit canDelete
      onEstadoUpdated={vi.fn()} onRegistroDeleted={onRegistroDeleted}
    />
  )
}

function renderSection(clientes: Cliente[], onRegistroDeleted?: (id: string) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={qc}>{seccion(clientes, onRegistroDeleted)}</QueryClientProvider>,
  )
  return {
    ...utils,
    rerenderCon: (cs: Cliente[], cb?: (id: string) => void) =>
      utils.rerender(<QueryClientProvider client={qc}>{seccion(cs, cb)}</QueryClientProvider>),
  }
}

beforeEach(() => {
  cleanup()
  h.deleteRegistro.mockClear()
})

describe('HistorialSection — las columnas ven los callbacks vigentes', () => {
  it('WhatsApp usa el teléfono de los clientes que llegan DESPUÉS del primer render', () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { rerenderCon } = renderSection([])   // clientes aún sin cargar

    fireEvent.click(screen.getByLabelText('Enviar por WhatsApp'))
    expect(abrir).not.toHaveBeenCalled()        // sin cliente no hay teléfono

    rerenderCon([cliente])                      // llega la lista de clientes
    fireEvent.click(screen.getByLabelText('Enviar por WhatsApp'))

    expect(abrir).toHaveBeenCalledTimes(1)
    expect(abrir.mock.calls[0][0]).toContain('50255551234')
    abrir.mockRestore()
  })

  it('el mensaje se arma con la moneda y el total vigentes', () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderSection([cliente])

    fireEvent.click(screen.getByLabelText('Enviar por WhatsApp'))

    expect(decodeURIComponent(String(abrir.mock.calls[0][0]))).toContain('Q 75.00')
    abrir.mockRestore()
  })

  it('eliminar usa el callback `onRegistroDeleted` MÁS RECIENTE', async () => {
    const viejo = vi.fn()
    const nuevo = vi.fn()
    const { rerenderCon } = renderSection([cliente], viejo)

    // El padre cambia de handler (p. ej. al re-crearse con otro estado).
    rerenderCon([cliente], nuevo)

    fireEvent.click(screen.getByLabelText('Eliminar lectura'))
    await vi.waitFor(() => expect(nuevo).toHaveBeenCalledWith('reg-1'))
    expect(viejo).not.toHaveBeenCalled()
  })
})
