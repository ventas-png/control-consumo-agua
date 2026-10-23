import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { Votacion, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  fetchVotosVotacion: vi.fn(async () => [
    { id: 'vt1', votacion_id: 'v1', unidad_id: 'u1', opcion_id: 'o1', unidades: { nombre: 'Casa 1' } },
  ] as Record<string, unknown>[]),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({ fetchVotosVotacion: mocks.fetchVotosVotacion }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { VotacionesTab } = await import('../VotacionesTab')

const unidades = [
  { id: 'u1', nombre: 'Casa 1', activo: true },
  { id: 'u2', nombre: 'Casa 2', activo: true },
] as unknown as Unidad[]

const votacion = {
  id: 'v1', company_id: 'co1', project_id: 'p1',
  titulo: 'Aprobación del presupuesto 2026', descripcion: 'Presupuesto anual de mantenimiento.',
  opciones: [{ id: 'o1', texto: 'A favor' }, { id: 'o2', texto: 'En contra' }],
  estado: 'abierta', quorum_requerido: null, total_unidades: 2,
  fecha_inicio: '2026-10-01T10:00:00Z', fecha_cierre: null, resultado: null, created_at: '2026-10-01T10:00:00Z',
} as unknown as Votacion

function renderTab(props: Partial<Parameters<typeof VotacionesTab>[0]> = {}) {
  return render(
    <VotacionesTab votaciones={[votacion]} unidades={unidades} proyectoId="p1" companyId="co1"
      canCreate canEdit onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('VotacionesTab — ventanas', () => {
  it('cada votación (fila-botón) se abre en ventana a pantalla completa en el teléfono y Escape la cierra', async () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Aprobación del presupuesto 2026/ }))

    const dialog = screen.getByRole('dialog', { name: 'Aprobación del presupuesto 2026' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText('Presupuesto anual de mantenimiento.')).toBeTruthy()
    expect(mocks.fetchVotosVotacion).toHaveBeenCalledWith('v1')
    expect(await within(dialog).findByText('1 · 100%')).toBeTruthy()
    expect(within(dialog).getByText('→ A favor')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('registrar un voto desde la ventana crea el voto de la unidad', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^Aprobación del presupuesto 2026/ }))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByText('1 · 100%')

    // Casa 1 ya votó: solo queda Casa 2 en la lista.
    const unidad = within(dialog).getByLabelText('Unidad') as HTMLSelectElement
    expect(Array.from(unidad.options).map(o => o.text)).toEqual(['— Seleccionar —', 'Casa 2'])
    fireEvent.change(unidad, { target: { value: 'u2' } })
    fireEvent.change(within(dialog).getByLabelText('Opción'), { target: { value: 'o2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar voto' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('votos', {
      company_id: 'co1', votacion_id: 'v1', unidad_id: 'u2', opcion_id: 'o2',
    }))
  })

  it('"Cerrar votación" al pie sólo pide cerrar: el conteo y el resultado los escribe la base', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: /^Aprobación del presupuesto 2026/ }))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByText('1 · 100%')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar votación' }))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('votaciones', 'v1', { estado: 'cerrada' }))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('si la base no cierra la votación, se avisa y no recarga', async () => {
    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'VOTACION_CERRADA: la votación está anulada; ya no cambia' } } as never)
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: /^Aprobación del presupuesto 2026/ }))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByText('1 · 100%')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar votación' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'error', text: 'VOTACION_CERRADA: la votación está anulada; ya no cambia',
    })))
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('una votación cerrada muestra el resultado que escribió la base', async () => {
    renderTab({ votaciones: [{ ...votacion, estado: 'cerrada', resultado: 'Empate' } as Votacion] })
    fireEvent.click(screen.getByRole('button', { name: /^Aprobación del presupuesto 2026/ }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByText(/Resultado: Empate/)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Cerrar votación' })).toBeNull()
  })

  it('el formulario de nueva votación es una ventana y crear guarda las opciones', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva Votación' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva votación' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Título *'), { target: { value: 'Cambio de horario de piscina' } })
    fireEvent.change(within(dialog).getByLabelText('Opción 1'), { target: { value: 'Sí' } })
    fireEvent.change(within(dialog).getByLabelText('Opción 2'), { target: { value: 'No' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear Votación' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('votaciones', expect.objectContaining({
      titulo: 'Cambio de horario de piscina', estado: 'abierta', total_unidades: 2,
      opciones: [{ id: '1', texto: 'Sí' }, { id: '2', texto: 'No' }],
    })))
    // Sin tipo ni asamblea: la consulta va fuera de asamblea (20261106000300).
    const payload = (mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]
    expect(payload).not.toHaveProperty('tipo')
    expect(payload).not.toHaveProperty('asamblea_id')
    expect(within(dialog).queryByLabelText('Asamblea (opcional)')).toBeNull()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('sin permisos la ventana solo muestra resultados', async () => {
    renderTab({ canCreate: false, canEdit: false })
    expect(screen.queryByRole('button', { name: '+ Nueva Votación' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Aprobación del presupuesto 2026/ }))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByText('1 · 100%')
    expect(within(dialog).queryByRole('button', { name: 'Cerrar votación' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Registrar voto' })).toBeNull()
  })
})
