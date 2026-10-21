import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { Asamblea, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRowAfectando: vi.fn(async () => ({ error: null })),
  upsertCondominioRow: vi.fn(async () => ({ error: null })),
  fetchPuntosAsambleaConVotos: vi.fn(async () => [
    {
      id: 'pt1', asamblea_id: 'a1', orden: 1, titulo: 'Aprobar presupuesto', descripcion: null, tipo: 'votacion',
      votos_asamblea: [{ id: 'v1', punto_id: 'pt1', unidad_id: 'u1', voto: 'a_favor', unidades: { nombre: 'Casa 1' } }],
    },
  ] as Record<string, unknown>[]),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRowAfectando: mocks.deleteCondominioRowAfectando,
  upsertCondominioRow: mocks.upsertCondominioRow,
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({ fetchPuntosAsambleaConVotos: mocks.fetchPuntosAsambleaConVotos }))
vi.mock('../../../../lib/toast', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: vi.fn() }))

const { AsambleasTab } = await import('../AsambleasTab')

const unidades = [
  { id: 'u1', nombre: 'Casa 1', activo: true },
  { id: 'u2', nombre: 'Casa 2', activo: true },
] as unknown as Unidad[]

function asamblea(over: Partial<Asamblea> = {}): Asamblea {
  return {
    id: 'a1', company_id: 'co1', project_id: 'p1', titulo: 'Asamblea Ordinaria Abril', tipo: 'ordinaria',
    fecha: '2026-04-20', hora_inicio: '18:00', lugar: 'Salón social', estado: 'en_curso',
    quorum_requerido: 50, created_at: '2026-04-01T10:00:00Z',
    ...over,
  } as unknown as Asamblea
}

const asambleas = [
  asamblea(),
  asamblea({ id: 'a2', titulo: 'Asamblea Extraordinaria Mayo', estado: 'finalizada', acta: 'Se aprobó la pintura.' }),
]

function renderTab(props: Partial<Parameters<typeof AsambleasTab>[0]> = {}) {
  return render(
    <AsambleasTab asambleas={asambleas} unidades={unidades} proyectoId="p1" companyId="co1" userId="user1"
      canCreate canEdit canDelete onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('AsambleasTab — ventanas', () => {
  it('cada asamblea abre su agenda en ventana (pantalla completa en el teléfono) y Escape la cierra', async () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Ordinaria Abril/ }))

    const dialog = screen.getByRole('dialog', { name: 'Asamblea Ordinaria Abril' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(mocks.fetchPuntosAsambleaConVotos).toHaveBeenCalledWith('a1')
    expect(await within(dialog).findByText('Aprobar presupuesto')).toBeTruthy()
    expect(within(dialog).getByText('A favor: 1')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('registrar un voto por unidad desde la ventana guarda y recarga la agenda', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Ordinaria Abril/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(await within(dialog).findByRole('button', { name: 'En contra — Casa 2' }))
    await waitFor(() => expect(mocks.upsertCondominioRow).toHaveBeenCalledWith('votos_asamblea', {
      punto_id: 'pt1', unidad_id: 'u2', voto: 'en_contra', registrado_por: 'user1',
    }, 'punto_id,unidad_id'))
    await waitFor(() => expect(mocks.fetchPuntosAsambleaConVotos).toHaveBeenCalledTimes(2))
  })

  it('"+ Punto" al pie abre el subformulario y agregar crea el punto', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Ordinaria Abril/ }))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByText('Aprobar presupuesto')
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Punto' }))
    fireEvent.change(within(dialog).getByLabelText('Título del punto'), { target: { value: 'Varios' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agregar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('puntos_asamblea', expect.objectContaining({
      asamblea_id: 'a1', orden: 2, titulo: 'Varios', tipo: 'informativo',
    })))
  })

  it('el formulario de convocatoria es una ventana y convocar crea la asamblea', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: '+ Convocar asamblea' }))
    const dialog = screen.getByRole('dialog', { name: 'Convocar asamblea' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Título *'), { target: { value: 'Asamblea Junio' } })
    fireEvent.change(within(dialog).getByLabelText('Fecha *'), { target: { value: '2026-06-10' } })
    fireEvent.change(within(dialog).getByLabelText('Hora inicio *'), { target: { value: '19:00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '📅 Convocar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('asambleas', expect.objectContaining({
      titulo: 'Asamblea Junio', fecha: '2026-06-10', hora_inicio: '19:00', estado: 'programada', convocado_por: 'user1',
    })))
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Asamblea convocada')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('cerrar con Escape mientras se escribe el acta la guarda igual', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Extraordinaria Mayo/ }))
    const dialog = screen.getByRole('dialog', { name: 'Asamblea Extraordinaria Mayo' })
    const acta = within(dialog).getByLabelText('📝 Acta de la asamblea') as HTMLTextAreaElement
    acta.focus()
    fireEvent.change(acta, { target: { value: 'Se aprobó la pintura y el portón.' } })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('asambleas', 'a2', { acta: 'Se aprobó la pintura y el portón.' }))
  })

  it('sin permiso de edición la agenda es de solo lectura', async () => {
    renderTab({ canCreate: false, canEdit: false })
    expect(screen.queryByRole('button', { name: '+ Convocar asamblea' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: /Estado de/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Ordinaria Abril/ }))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByText('Aprobar presupuesto')
    expect(within(dialog).queryByRole('button', { name: '+ Punto' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /Casa 2/ })).toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Extraordinaria Mayo/ }))
    const finalizada = screen.getByRole('dialog', { name: 'Asamblea Extraordinaria Mayo' })
    await within(finalizada).findByText('Aprobar presupuesto')
    expect(within(finalizada).getByText('Se aprobó la pintura.')).toBeTruthy()
    expect(within(finalizada).queryByLabelText('📝 Acta de la asamblea')).toBeNull()
  })

  it('eliminar exige su propio permiso: editar no basta', async () => {
    renderTab({ canDelete: false })
    expect(screen.getAllByRole('combobox', { name: /Estado de/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /^Eliminar / })).toBeNull()
    cleanup()

    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Asamblea Ordinaria Abril' }))
    await waitFor(() => expect(mocks.deleteCondominioRowAfectando).toHaveBeenCalledWith('asambleas', 'a1'))
  })

  it('eliminar no depende de editar; si la base no borra (la RLS lo rechaza), avisa y no la da por eliminada', async () => {
    mocks.deleteCondominioRowAfectando.mockResolvedValueOnce({ error: { message: 'El servidor no aplicó el cambio', code: 'SIN_FILAS' } } as never)
    const onRefresh = vi.fn()
    renderTab({ canEdit: false, onRefresh })
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Asamblea Ordinaria Abril' }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('El servidor no aplicó el cambio'))
    expect(onRefresh).not.toHaveBeenCalled()
  })
})
