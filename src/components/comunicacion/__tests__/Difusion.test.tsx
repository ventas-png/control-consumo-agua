import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { Broadcast, Cliente, Unidad } from '../../../types'

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) } }))
vi.mock('../../../hooks/useBroadcasts', () => ({
  useBroadcasts: () => ({ createBroadcast: vi.fn(async () => ({ success: true, recipientCount: 0, emailsQueued: 0 })) }),
}))

import { NuevoComunicadoModal, resolveEstimatedCount } from '../NuevoComunicadoModal'
import { BroadcastDetailModal } from '../BroadcastDetailModal'

beforeEach(cleanup)

const clientes = [
  { id: 'c1', nombre: 'Ana López', codigo: 'A1' },
  { id: 'c2', nombre: 'Bruno Díaz', codigo: 'B2' },
  { id: 'c3', nombre: 'Carla Ruiz', codigo: 'C3' },
] as Cliente[]

const unidades = [
  { id: 'u1', nombre: 'Casa 1', project_id: 'p1', cliente_id: 'c1' },
  { id: 'u2', nombre: 'Casa 2', project_id: 'p1', cliente_id: 'c1' },
  { id: 'u3', nombre: 'Casa 3', project_id: 'p2', cliente_id: 'c2' },
  { id: 'u4', nombre: 'Casa 4', project_id: 'p2', cliente_id: null },
] as Unidad[]

describe('resolveEstimatedCount', () => {
  const base = { selected_proyecto_ids: [], selected_unidad_ids: [], selected_cliente_ids: [] }
  it('todos = el padrón accesible', () => {
    expect(resolveEstimatedCount({ ...base, target_type: 'todos' }, clientes, unidades)).toBe(3)
  })
  it('por unidades cuenta clientes distintos, no unidades', () => {
    expect(resolveEstimatedCount({ ...base, target_type: 'unidades', selected_unidad_ids: ['u1', 'u2', 'u4'] }, clientes, unidades)).toBe(1)
  })
  it('por proyecto', () => {
    expect(resolveEstimatedCount({ ...base, target_type: 'proyecto', selected_proyecto_ids: ['p2'] }, clientes, unidades)).toBe(1)
  })
})

describe('NuevoComunicadoModal', () => {
  function renderModal() {
    return render(
      <NuevoComunicadoModal clientes={clientes} proyectos={[]} unidades={unidades} onClose={() => {}} onSent={() => {}} />,
    )
  }

  it('es una ventana a pantalla completa en el teléfono, con resumen de destinatarios', () => {
    renderModal()
    const dialog = screen.getByRole('dialog', { name: 'Nuevo comunicado' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(screen.getByText(/Llegará a 3 clientes/)).toBeDefined()
  })

  it('clientes específicos: buscar y "seleccionar los filtrados"', () => {
    renderModal()
    fireEvent.click(screen.getByRole('radio', { name: /Clientes específicos/ }))
    expect(screen.getByText('Ningún destinatario seleccionado')).toBeDefined()

    fireEvent.change(screen.getByLabelText('Buscar por nombre o código…'), { target: { value: 'ruiz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar los filtrados' }))
    expect(screen.getByText('1 seleccionado')).toBeDefined()
    expect(screen.getByText(/Llegará a 1 cliente$/)).toBeDefined()
  })

  it('"Seleccionar todos" y "Quitar todos" sobre la lista completa', () => {
    renderModal()
    fireEvent.click(screen.getByRole('radio', { name: /Clientes específicos/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar todos' }))
    expect(screen.getByText('3 seleccionados')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar todos' }))
    expect(screen.getByText('0 seleccionados')).toBeDefined()
  })
})

describe('BroadcastDetailModal', () => {
  const b: Broadcast = {
    id: 'b1', company_id: 'co1', title: 'Corte programado', body: 'Mañana no habrá agua de 8 a 12.',
    sent_by_id: 'u1', sent_by_name: 'Santos', target_type: 'todos', target_ids: [],
    recipient_count: 40, send_email: true, created_at: '2026-10-20T10:00:00Z', read_count: 10,
  }

  it('muestra el mensaje completo y la lectura en el portal', () => {
    render(<BroadcastDetailModal broadcast={b} onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Corte programado' })
    expect(within(dialog).getByText('Mañana no habrá agua de 8 a 12.')).toBeDefined()
    expect(within(dialog).getByText('25%')).toBeDefined()
    expect(within(dialog).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25')
  })

  it('entrega por email: solo muestra rebotes y fallos cuando los hay', () => {
    render(<BroadcastDetailModal
      broadcast={b}
      emailStats={{ pendientes: 0, enviados: 30, abiertos: 12, rebotados: 2, fallidos: 0 }}
      onClose={() => {}}
    />)
    expect(screen.getByText('rebotados')).toBeDefined()
    expect(screen.queryByText('fallidos')).toBeNull()
    expect(screen.queryByText('en cola')).toBeNull()
  })
})
