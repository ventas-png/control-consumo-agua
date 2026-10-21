// Unidades en el teléfono: los formularios (Nueva Unidad, Residentes) ocupan
// toda la pantalla y no se cierran a mitad de un guardado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { Cliente, Proyecto, Unidad } from '../../../types'

const h = vi.hoisted(() => ({
  resolveUnidadProjectCompany: vi.fn(),
  fetchResidentesDeUnidad: vi.fn(),
  addResidente: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../shared/SessionContext', () => ({
  useSession: () => ({ user_id: 'u1', role: 'admin', company_id: 'co1', name: 'Admin', email: 'admin@x.com' }),
}))
vi.mock('../../shared/PermissionsContext', () => ({
  usePermissionsContext: () => ({ canEdit: () => true, canDelete: () => true, canCreate: () => true }),
}))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify, confirm: vi.fn(async () => ({ isConfirmed: false })) }))
vi.mock('../../shared/promptUpgrade', () => ({ promptUpgrade: vi.fn(async () => {}) }))
vi.mock('../../../domain/unidades/queries', () => ({
  resolveUnidadProjectCompany: h.resolveUnidadProjectCompany,
  checkUnidadesLimit: vi.fn(async () => ({ maxUnits: 100, total: 0 })),
}))
vi.mock('../../../domain/unidades/mutations', () => ({
  createUnidad: vi.fn(), updateUnidad: vi.fn(), setUnidadActiva: vi.fn(), deleteUnidad: vi.fn(),
  assignContadoresToUnidad: vi.fn(), unlinkContadores: vi.fn(),
}))
vi.mock('../../../domain/unidades/residentes', () => ({
  fetchResidentesDeUnidad: h.fetchResidentesDeUnidad,
  addResidente: h.addResidente,
  removeResidente: vi.fn(),
  setResponsablePago: vi.fn(),
}))

const { UnidadesSection } = await import('../UnidadesSection')
const { UnidadResidentesModal } = await import('../UnidadResidentesModal')

const proyecto = {
  id: 'p1', nombre: 'Condado Norte', estado: 'activo', company_id: 'co1',
  max_unidades_apartamento: null, max_unidades_casa: null, max_unidades_bodega: null,
  max_unidades_local_comercial: null, max_unidades_oficina: null, max_unidades_parqueadero: null,
  max_unidades_otro: null,
} as unknown as Proyecto
const unidad = {
  id: 'un-1', nombre: 'Casa 7', tipo: 'casa', activo: true, project_id: 'p1', company_id: 'co1', cliente_id: null,
} as unknown as Unidad
const cliente = { id: 'cli-1', nombre: 'Ana López', codigo: 'CLI-001' } as unknown as Cliente

function renderSection() {
  return render(
    <UnidadesSection
      unidades={[unidad]} contadores={[]} clientes={[cliente]} proyectos={[proyecto]}
      onUnidadAdded={() => {}} onUnidadUpdated={() => {}} onUnidadDeleted={() => {}} onContadorUpdated={() => {}}
    />,
  )
}

beforeEach(() => {
  Object.values(h).forEach(m => m.mockReset())
  h.fetchResidentesDeUnidad.mockResolvedValue({ data: [], error: null })
})
afterEach(cleanup)

describe('UnidadFormModal — pantalla completa en el teléfono', () => {
  it('"Nueva Unidad" es un diálogo a pantalla completa; la descripción no sale monoespaciada', () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva Unidad' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva Unidad' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    const descripcion = within(dialog).getByLabelText('Descripción') as HTMLTextAreaElement
    expect(descripcion.tagName).toBe('TEXTAREA')
    expect(descripcion.style.fontFamily).toBe('inherit')
    expect(within(dialog).getByLabelText('Datos Registrales').tagName).toBe('TEXTAREA')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('mientras guarda, ni Escape ni el fondo cierran la ventana', async () => {
    h.resolveUnidadProjectCompany.mockReturnValue(new Promise(() => {}))
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva Unidad' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva Unidad' })
    fireEvent.change(within(dialog).getByLabelText('Nombre / Número *'), { target: { value: 'Casa 8' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(h.resolveUnidadProjectCompany).toHaveBeenCalledWith('u1', 'p1', 'co1'))
    expect(within(dialog).getByRole('button', { name: 'Guardando...' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(dialog)
    expect(screen.getByRole('dialog', { name: 'Nueva Unidad' })).toBeTruthy()
  })
})

describe('UnidadResidentesModal — pantalla completa en el teléfono', () => {
  it('es un diálogo a pantalla completa con selectores etiquetados y Escape lo cierra', async () => {
    const onClose = vi.fn()
    render(<UnidadResidentesModal unidad={unidad} clientes={[cliente]} onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: '👥 Residentes — Casa 7' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    await waitFor(() => expect(within(dialog).getByText('Sin residentes asignados todavía.')).toBeTruthy())
    expect(within(dialog).getByLabelText('Cliente').tagName).toBe('SELECT')
    expect(within(dialog).getByLabelText('Tipo de residente').tagName).toBe('SELECT')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('mientras asigna un residente, ni Escape ni el fondo la cierran', async () => {
    h.addResidente.mockReturnValue(new Promise(() => {}))
    const onClose = vi.fn()
    render(<UnidadResidentesModal unidad={unidad} clientes={[cliente]} onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(within(dialog).getByText('Sin residentes asignados todavía.')).toBeTruthy())

    fireEvent.change(within(dialog).getByLabelText('Cliente'), { target: { value: 'cli-1' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Asignar$/ }))
    await waitFor(() => expect(h.addResidente).toHaveBeenCalledWith(expect.objectContaining({
      unidad_id: 'un-1', cliente_id: 'cli-1', tipo: 'arrendatario', activo: true,
    })))

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()
  })
})
