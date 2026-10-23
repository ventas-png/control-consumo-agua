import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { BitacoraManto as BitacoraMantoRow } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null })),
  deleteCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { BitacoraManto } = await import('../BitacoraManto')

const LOBBY = { tarea: 'Limpieza de lobby', completado: true, observaciones: '' }
const EXTINTORES = { tarea: 'Revisión de extintores', completado: false, observaciones: 'Falta uno en piso 2' }

function registro(over: Partial<BitacoraMantoRow> = {}): BitacoraMantoRow {
  return {
    id: 'b1', company_id: 'co1', project_id: 'p1', fecha: '2026-10-20', turno: 'mañana',
    responsable: 'Pedro Ruiz', area: 'Lobby', tareas: [LOBBY, EXTINTORES],
    observaciones: 'Sin novedades', firmado: false, created_at: '2026-10-20T07:00:00Z',
    ...over,
  } as unknown as BitacoraMantoRow
}

function props(over: Partial<Parameters<typeof BitacoraManto>[0]> = {}): Parameters<typeof BitacoraManto>[0] {
  return { registros: [registro()], proyectoId: 'p1', companyId: 'co1', canCreate: true, canEdit: true, canDelete: true, onRefresh: () => {}, ...over }
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('BitacoraManto — ventanas', () => {
  it('el registro se abre en ventana (pantalla completa en el teléfono)', () => {
    render(<BitacoraManto {...props()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Pedro Ruiz/ }))

    const dialog = screen.getByRole('dialog', { name: '🌅 2026-10-20 — Mañana' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText('Revisión de extintores')).toBeTruthy()
    expect(within(dialog).getByText('Falta uno en piso 2')).toBeTruthy()
    expect(within(dialog).getByText('Sin novedades')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '🖨️ Imprimir' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('marcar dos tareas seguidas parte del registro refrescado y no deshace la primera', async () => {
    const onRefresh = vi.fn()
    const { rerender } = render(<BitacoraManto {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: /Pedro Ruiz/ }))

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'Completada: Revisión de extintores' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('bitacora_manto', 'b1', {
      tareas: [LOBBY, { ...EXTINTORES, completado: true }],
    }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())

    rerender(<BitacoraManto {...props({ onRefresh, registros: [registro({ tareas: [LOBBY, { ...EXTINTORES, completado: true }] })] })} />)
    const casilla = within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'Completada: Revisión de extintores' }) as HTMLInputElement
    expect(casilla.checked).toBe(true)

    // Con la copia vieja, esta segunda marca volvía a dejar "extintores" sin hacer.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'Completada: Limpieza de lobby' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenLastCalledWith('bitacora_manto', 'b1', {
      tareas: [{ ...LOBBY, completado: false }, { ...EXTINTORES, completado: true }],
    }))
  })

  it('firmar desde la ventana y ver el registro firmado tras refrescar', async () => {
    const onRefresh = vi.fn()
    const { rerender } = render(<BitacoraManto {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: /Pedro Ruiz/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Firmar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('bitacora_manto', 'b1', { firmado: true }))

    rerender(<BitacoraManto {...props({ onRefresh, registros: [registro({ firmado: true })] })} />)
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '✓ Firmado' })).toBeTruthy()
  })

  it('el formulario de nuevo registro es una ventana y guarda sus tareas', async () => {
    const onRefresh = vi.fn()
    render(<BitacoraManto {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo Registro' }))
    const dialog = screen.getByRole('dialog', { name: 'Nuevo registro de mantenimiento' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Responsable *'), { target: { value: 'Juan Torres' } })
    fireEvent.change(within(dialog).getByLabelText('Agregar tarea predefinida'), { target: { value: 'Revisión de cámaras' } })
    expect((within(dialog).getByLabelText('Tarea 1') as HTMLInputElement).value).toBe('Revisión de cámaras')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('bitacora_manto', expect.objectContaining({
      responsable: 'Juan Torres', company_id: 'co1', project_id: 'p1', firmado: false,
      tareas: [{ tarea: 'Revisión de cámaras', completado: false, observaciones: '' }],
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('sin permiso de edición se consulta e imprime, pero no se marca ni firma', () => {
    render(<BitacoraManto {...props({ canCreate: false, canEdit: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nuevo Registro' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Imprimir registro del 2026-10-20' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Editar registro del 2026-10-20' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Pedro Ruiz/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Revisión de extintores')).toBeTruthy()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Firmar' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: '✏️ Editar' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: '🖨️ Imprimir' })).toBeTruthy()
  })
})
