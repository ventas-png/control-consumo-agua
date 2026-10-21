import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { Encuesta, RespuestaEncuesta, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRowBy: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
  deleteCondominioRowBy: mocks.deleteCondominioRowBy,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { EncuestasTab } = await import('../EncuestasTab')

const unidades = [{ id: 'u4', nombre: 'Casa 4', activo: true }] as unknown as Unidad[]

const encuestas = [
  {
    id: 'e1', company_id: 'co1', project_id: 'p1', titulo: 'Satisfacción servicios Q1', descripcion: 'Cuéntanos cómo te fue.',
    preguntas: [
      { id: 'p1', texto: '¿Cómo califica la limpieza?', tipo: 'rating_5' },
      { id: 'p2', texto: '¿Recomendaría el condominio?', tipo: 'si_no' },
      { id: 'p3', texto: 'Comentarios', tipo: 'texto' },
    ],
    fecha_inicio: '2026-01-10', fecha_fin: '2026-01-31', estado: 'activa', created_at: '2026-01-05T10:00:00Z',
  },
  {
    id: 'e2', company_id: 'co1', project_id: 'p1', titulo: 'Encuesta de piscina', descripcion: null,
    preguntas: [], fecha_inicio: null, fecha_fin: null, estado: 'borrador', created_at: '2026-02-01T10:00:00Z',
  },
] as unknown as Encuesta[]

const respuestas = [
  {
    id: 'r1', company_id: 'co1', project_id: 'p1', encuesta_id: 'e1', unidad_id: 'u4', unidad_nombre: 'Casa 4',
    nombre_respondente: 'Ana', respuestas: { p1: '4', p2: 'si', p3: 'Todo bien' }, created_at: '2026-01-15T12:00:00Z',
  },
] as unknown as RespuestaEncuesta[]

function renderTab(props: Partial<Parameters<typeof EncuestasTab>[0]> = {}) {
  return render(
    <EncuestasTab encuestas={encuestas} respuestas={respuestas} unidades={unidades} proyectoId="p1" companyId="co1"
      canCreate canEdit onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('EncuestasTab — ventanas', () => {
  it('cada encuesta se abre en ventana (pantalla completa en el teléfono) con sus respuestas y Escape la cierra', () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Satisfacción servicios Q1/ }))

    const dialog = screen.getByRole('dialog', { name: 'Satisfacción servicios Q1' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText('Cuéntanos cómo te fue.')).toBeTruthy()
    expect(within(dialog).getByText('Respuestas recibidas (1)')).toBeTruthy()
    expect(within(dialog).getByText(/Todo bien/)).toBeTruthy()
    expect(within(dialog).getByText(/✅ Sí/)).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"+ Respuesta" al pie abre el formulario y guardar registra la respuesta', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: /^Satisfacción servicios Q1/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Respuesta' }))

    fireEvent.change(within(dialog).getByLabelText('Unidad'), { target: { value: 'u4' } })
    fireEvent.click(within(within(dialog).getByRole('group', { name: '¿Cómo califica la limpieza?' })).getByRole('button', { name: '5' }))
    fireEvent.click(within(within(dialog).getByRole('group', { name: '¿Recomendaría el condominio?' })).getByRole('button', { name: 'No' }))
    fireEvent.change(within(dialog).getByLabelText('Comentarios'), { target: { value: 'Mejorar el jardín' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar Respuesta' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('respuestas_encuesta', expect.objectContaining({
      encuesta_id: 'e1', unidad_id: 'u4', respuestas: { p1: '5', p2: 'no', p3: 'Mejorar el jardín' },
    })))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('el formulario de nueva encuesta es una ventana y crear guarda las preguntas', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva Encuesta' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva encuesta' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Título *'), { target: { value: 'Seguridad nocturna' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Agregar' }))
    fireEvent.change(within(dialog).getByLabelText('Pregunta 1'), { target: { value: '¿Se siente seguro?' } })
    fireEvent.change(within(dialog).getByLabelText('Tipo de la pregunta 1'), { target: { value: 'si_no' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear Encuesta' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('encuestas', expect.objectContaining({
      titulo: 'Seguridad nocturna', estado: 'borrador',
      preguntas: [expect.objectContaining({ texto: '¿Se siente seguro?', tipo: 'si_no' })],
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('editar desde la ventana cambia al formulario de la encuesta y actualiza', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^Satisfacción servicios Q1/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '✏️ Editar' }))

    const dialog = screen.getByRole('dialog', { name: 'Editar encuesta' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect((within(dialog).getByLabelText('Título *') as HTMLInputElement).value).toBe('Satisfacción servicios Q1')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Actualizar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('encuestas', 'e1', expect.objectContaining({ titulo: 'Satisfacción servicios Q1' })))
  })

  it('sin permiso de edición no hay acciones de gestión, pero se puede responder una encuesta activa', () => {
    renderTab({ canCreate: false, canEdit: false })
    expect(screen.queryByRole('button', { name: '+ Nueva Encuesta' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Editar/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Activar' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Satisfacción servicios Q1/ }))
    let dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: /Editar|Eliminar|Cerrar encuesta/ })).toBeNull()
    expect(within(dialog).getByRole('button', { name: '+ Respuesta' })).toBeTruthy()

    // Borrador sin permiso de edición: la ventana no tiene pie de acciones.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /^Encuesta de piscina/ }))
    dialog = screen.getByRole('dialog', { name: 'Encuesta de piscina' })
    expect(within(dialog).queryByRole('button', { name: '+ Respuesta' })).toBeNull()
    expect(within(dialog).getByText('Aún no hay respuestas')).toBeTruthy()
  })
})
