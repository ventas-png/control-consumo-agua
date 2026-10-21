// Contadores en el teléfono: la tabla se lee como tarjetas (data-label por
// celda, columnas secundarias ocultas) y el formulario ocupa toda la pantalla
// sin poder cerrarse a mitad del guardado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { Contador, Tarifa, Unidad } from '../../../types'

const h = vi.hoisted(() => ({
  validatedInsert: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../shared/SessionContext', () => ({
  useSession: () => ({ user_id: 'u1', role: 'admin', company_id: 'co1', name: 'Admin', email: 'admin@x.com' }),
}))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify, confirm: vi.fn(async () => ({ isConfirmed: false })) }))
vi.mock('../../../domain/contadores/mutations', () => ({
  updateContador: vi.fn(), setContadorActivo: vi.fn(async () => ({ error: null })), deleteContador: vi.fn(),
}))
vi.mock('../../../domain/contadores/queries', () => ({
  fetchUnidadesByCompany: vi.fn(async () => []), resolveDefaultProjectCompany: vi.fn(async () => ({})),
}))
vi.mock('../../../lib/validatedInsert', () => ({ validatedInsert: h.validatedInsert, validatedInsertMany: vi.fn() }))

const { ContadoresSection } = await import('../ContadoresSection')

const unidad = { id: 'un-1', nombre: 'Casa 7', project_id: 'p1', company_id: 'co1', activo: true } as unknown as Unidad
const tarifa = { id: 't-1', nombre: 'Residencial', tipo_agua: 'potable', precio_m3: 5, canon_fijo: 0, activa: true } as unknown as Tarifa
const contador = {
  id: 'c-1', numero_serie: 'MED-0001', tipo_agua: 'potable', marca: 'Sensus', modelo: '620',
  lectura_inicial: 12.5, activo: true, unidad_id: 'un-1', tarifa_id: 't-1', medida: '1/2"',
} as unknown as Contador

function renderSection() {
  return render(
    <ContadoresSection
      contadores={[contador]} tarifas={[tarifa]} unidades={[unidad]}
      onContadorAdded={() => {}} onContadorUpdated={() => {}} onContadorDeleted={() => {}}
    />,
  )
}

beforeEach(() => { Object.values(h).forEach(m => m.mockReset()) })
afterEach(cleanup)

describe('ContadoresSection — tabla en tarjetas', () => {
  it('cada fila es una tarjeta con etiquetas; marca, lectura inicial y características son secundarias', () => {
    const { container } = renderSection()
    const table = container.querySelector('table')!
    expect(table.classList.contains('table-cards-on-mobile')).toBe(true)

    const celdas = Array.from(table.querySelectorAll('tbody td'))
    expect(celdas.map(td => td.getAttribute('data-label'))).toEqual([
      'N° Serie', 'Tipología', 'Marca / Modelo', 'Características', 'Lect. Inicial', 'Unidad', 'Tarifa', 'Estado', 'Acciones',
    ])
    const secundarias = celdas.filter(td => td.classList.contains('table-col-secondary')).map(td => td.getAttribute('data-label'))
    expect(secundarias).toEqual(['Marca / Modelo', 'Características', 'Lect. Inicial'])

    const acciones = container.querySelector('td[data-label="Acciones"]') as HTMLElement
    expect(within(acciones).getByRole('button', { name: 'Editar' })).toBeTruthy()
    expect(within(acciones).getByRole('button', { name: 'Eliminar' })).toBeTruthy()
  })
})

describe('ContadorFormModal — pantalla completa en el teléfono', () => {
  it('"Nuevo Contador" es un diálogo a pantalla completa con etiquetas asociadas y Escape lo cierra', () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo Contador' }))
    const dialog = screen.getByRole('dialog', { name: 'Nuevo Contador' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    // El textarea hereda la fuente de la app (antes se veía monoespaciado).
    const descripcion = within(dialog).getByLabelText('Descripción') as HTMLTextAreaElement
    expect(descripcion.tagName).toBe('TEXTAREA')
    expect(descripcion.style.fontFamily).toBe('inherit')
    expect(within(dialog).getByLabelText('Número de Serie *')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('mientras guarda, ni Escape ni el fondo cierran la ventana (y el payload no cambia)', async () => {
    h.validatedInsert.mockReturnValue(new Promise(() => {}))
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo Contador' }))
    const dialog = screen.getByRole('dialog', { name: 'Nuevo Contador' })
    fireEvent.change(within(dialog).getByLabelText('Número de Serie *'), { target: { value: 'MED-0002' } })
    fireEvent.change(within(dialog).getByLabelText('Unidad asignada'), { target: { value: 'un-1' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(h.validatedInsert).toHaveBeenCalledTimes(1))
    expect(h.validatedInsert).toHaveBeenCalledWith(
      'contadores',
      expect.anything(),
      expect.objectContaining({ numero_serie: 'MED-0002', unidad_id: 'un-1', project_id: 'p1', company_id: 'co1' }),
      { returning: true },
    )
    expect(within(dialog).getByRole('button', { name: 'Guardando...' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(dialog)
    expect(screen.getByRole('dialog', { name: 'Nuevo Contador' })).toBeTruthy()
  })

  it('"Editar" abre el formulario con los datos del contador', () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = screen.getByRole('dialog', { name: 'Editar Contador' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect((within(dialog).getByLabelText('Número de Serie *') as HTMLInputElement).value).toBe('MED-0001')
    expect((within(dialog).getByLabelText('Marca') as HTMLInputElement).value).toBe('Sensus')
  })
})
