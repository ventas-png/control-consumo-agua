// Tarifas en el teléfono: la tabla (hecha a mano, no DataTable) se lee como
// tarjetas con data-label, el formulario ocupa toda la pantalla y no se
// cierra a mitad del guardado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { Proyecto, Tarifa } from '../../../types'

const h = vi.hoisted(() => ({
  createTarifa: vi.fn(),
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
vi.mock('../../../domain/tarifas/mutations', () => ({
  createTarifa: h.createTarifa, updateTarifa: vi.fn(), setTarifaActiva: vi.fn(async () => ({ error: null })), deleteTarifa: vi.fn(),
}))
// La sub-vista de facturación tiene sus propias consultas; aquí no se usa.
vi.mock('../FacturacionConfigSection', () => ({ FacturacionConfigSection: () => null }))

const { TarifasSection } = await import('../TarifasSection')

const proyecto = { id: 'p1', nombre: 'Condado Norte' } as unknown as Proyecto
const tarifa = {
  id: 't-1', nombre: 'Residencial', tipo_agua: 'potable', precio_m3: 5.25, precio_m3_exceso: 7,
  canon_fijo: 30, consumo_minimo: 10, activa: true, descripcion: 'Casas del condominio', fecha_revision: null,
} as unknown as Tarifa

function renderSection() {
  return render(
    <TarifasSection
      tarifas={[tarifa]} proyectos={[proyecto]} moneda="Q"
      onTarifaAdded={() => {}} onTarifaUpdated={() => {}} onTarifaDeleted={() => {}}
    />,
  )
}

beforeEach(() => { Object.values(h).forEach(m => m.mockReset()) })
afterEach(cleanup)

describe('TarifasSection — tabla en tarjetas', () => {
  it('cada tarifa es una tarjeta con etiquetas; exceso y consumo mínimo son secundarias', () => {
    const { container } = renderSection()
    const table = container.querySelector('table')!
    expect(table.classList.contains('table-cards-on-mobile')).toBe(true)

    const celdas = Array.from(table.querySelectorAll('tbody td'))
    expect(celdas.map(td => td.getAttribute('data-label'))).toEqual([
      'Nombre', 'Tipo de Agua', 'Precio/m³', 'Precio Exceso/m³', 'Canon Fijo', 'Cons. Mínimo', 'Estado', 'Revisión',
      // Acciones sin etiqueta: el CSS la centra en su propia línea al pie de la tarjeta.
      null,
    ])
    const secundarias = celdas.filter(td => td.classList.contains('table-col-secondary')).map(td => td.getAttribute('data-label'))
    expect(secundarias).toEqual(['Precio Exceso/m³', 'Cons. Mínimo'])
    // El encabezado se oculta igual que la celda (si no, la tabla de 640–767px se descuadra).
    const thSecundarios = Array.from(table.querySelectorAll('thead th.table-col-secondary')).map(th => th.textContent)
    expect(thSecundarios).toEqual(['Precio Exceso/m³', 'Cons. Mínimo'])

    // Nombre + descripción en un solo bloque (la celda es flex en la tarjeta).
    const nombre = table.querySelector('td[data-label="Nombre"]')!
    expect(nombre.children).toHaveLength(1)
    expect(nombre.textContent).toContain('Casas del condominio')

    const acciones = celdas[celdas.length - 1] as HTMLElement
    expect(within(acciones).getByRole('button', { name: 'Editar' })).toBeTruthy()
    expect(within(acciones).getByRole('button', { name: 'Eliminar' })).toBeTruthy()
  })
})

describe('Formulario de tarifa — pantalla completa en el teléfono', () => {
  it('"Nueva Tarifa" es un diálogo a pantalla completa con etiquetas asociadas y Escape lo cierra', () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva Tarifa' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva Tarifa' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    const descripcion = within(dialog).getByLabelText('Descripción') as HTMLTextAreaElement
    expect(descripcion.tagName).toBe('TEXTAREA')
    expect(descripcion.style.fontFamily).toBe('inherit')
    expect(within(dialog).getByLabelText('Fecha de Revisión')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('mientras guarda, ni Escape ni el fondo cierran la ventana (y el payload no cambia)', async () => {
    h.createTarifa.mockReturnValue(new Promise(() => {}))
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva Tarifa' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva Tarifa' })
    fireEvent.change(within(dialog).getByLabelText('Nombre *'), { target: { value: 'Comercial' } })
    fireEvent.change(within(dialog).getByLabelText('Proyecto *'), { target: { value: 'p1' } })
    fireEvent.change(within(dialog).getByLabelText('Precio por m³ *'), { target: { value: '8.5' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(h.createTarifa).toHaveBeenCalledTimes(1))
    expect(h.createTarifa).toHaveBeenCalledWith(expect.objectContaining({
      nombre: 'Comercial', precio_m3: 8.5, project_id: 'p1', company_id: 'co1', tramos: null,
    }))

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(dialog)
    expect(screen.getByRole('dialog', { name: 'Nueva Tarifa' })).toBeTruthy()
  })
})
