// Pruebas 11 y 12 (lado Limpieza): los registros legados sin `area_id` siguen
// mostrando su texto histórico y quedan señalados como pendientes; las
// programaciones nuevas seleccionan el área del catálogo (payload con area_id +
// snapshot); editar un legado sin vincular no toca su texto; y el borrado con
// historial protegido (FK RESTRICT) se explica en lugar de tronar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { AreaCondominio, ProgramacionLimpieza } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  updateCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({
  confirm: mocks.confirm,
  notify: mocks.notify,
}))

const { VistaAreas } = await import('../limpieza/VistaAreas')

function areaCat(over: Partial<AreaCondominio> = {}): AreaCondominio {
  return {
    id: 'area-piscina', company_id: 'co1', project_id: 'p1', nombre: 'Piscina principal',
    descripcion: null, icono: '🏊', orden: 0, activo: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function prog(over: Partial<ProgramacionLimpieza> = {}): ProgramacionLimpieza {
  return {
    id: 'prog1', company_id: 'co1', project_id: 'p1', area: 'piscina (texto viejo)',
    frecuencia: 'semanal', estado: 'pendiente', activo: true,
    created_at: '2026-01-01T00:00:00.000Z', orden: 0, requiere_foto: true,
    ...over,
  }
}

function renderVista(props: Partial<Parameters<typeof VistaAreas>[0]> = {}) {
  return render(
    <VistaAreas
      programaciones={[prog()]}
      personal={[]}
      areas={[areaCat()]}
      proyectoId="p1"
      companyId="co1"
      canCreate
      canEdit
      canDelete
      onRefresh={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.deleteCondominioRow.mockResolvedValue({ error: null })
})

afterEach(() => { cleanup() })

describe('VistaAreas — registros legados sin area_id', () => {
  it('muestran el texto histórico y la marca de pendiente', () => {
    renderVista()
    expect(screen.getByText(/piscina \(texto viejo\)/)).toBeTruthy()
    expect(screen.getByText('⚠ Pendiente de vincular')).toBeTruthy()
  })

  it('con area_id manda el nombre del catálogo, no el snapshot, y sin marca', () => {
    renderVista({ programaciones: [prog({ area_id: 'area-piscina' })] })
    expect(screen.getByText(/Piscina principal/)).toBeTruthy()
    expect(screen.queryByText(/texto viejo/)).toBeNull()
    expect(screen.queryByText('⚠ Pendiente de vincular')).toBeNull()
  })

  it('editar un legado SIN vincular no toca `area` ni `area_id`', async () => {
    renderVista()
    fireEvent.click(screen.getByLabelText(/^Editar /))
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(id).toBe('prog1')
    expect('area' in patch).toBe(false)
    expect('area_id' in patch).toBe(false)
  })

  it('editar un legado Y elegir área lo vincula con snapshot del nombre', async () => {
    renderVista()
    fireEvent.click(screen.getByLabelText(/^Editar /))
    fireEvent.change(screen.getByDisplayValue('— Sin vincular (registro anterior) —'), { target: { value: 'area-piscina' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [, , patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(patch.area_id).toBe('area-piscina')
    expect(patch.area).toBe('Piscina principal')
  })
})

describe('VistaAreas — alta nueva desde el catálogo', () => {
  it('sin área seleccionada no crea y lo dice', async () => {
    renderVista()
    fireEvent.click(screen.getByText('+ Nueva área'))
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect(mocks.notify.mock.calls[0][0]).toMatchObject({ title: 'Campo requerido' })
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })

  it('con área del catálogo crea con area_id + snapshot', async () => {
    renderVista()
    fireEvent.click(screen.getByText('+ Nueva área'))
    fireEvent.change(screen.getByDisplayValue('— Selecciona un área —'), { target: { value: 'area-piscina' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('programacion_limpieza')
    expect(payload).toMatchObject({
      company_id: 'co1', project_id: 'p1',
      area_id: 'area-piscina', area: 'Piscina principal',
    })
  })
})

describe('VistaAreas — historial protegido', () => {
  it('el delete bloqueado por FK (23503) explica que el historial se conserva', async () => {
    mocks.deleteCondominioRow.mockResolvedValue({ error: { message: 'violates foreign key constraint', code: '23503' } })
    renderVista()
    fireEvent.click(screen.getByLabelText(/^Eliminar /))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const aviso = mocks.notify.mock.calls[0][0] as { title: string; text: string }
    expect(aviso.title).toBe('Tiene historial')
    expect(aviso.text).toMatch(/desactívala/i)
  })

  it('canEdit sin canDelete: se edita y desactiva, pero no se elimina', async () => {
    renderVista({ canDelete: false })
    expect(screen.getByLabelText(/^Editar /)).toBeTruthy()
    expect(screen.getByText(/Desactivar/)).toBeTruthy()
    expect(screen.queryByLabelText(/^Eliminar /)).toBeNull()
  })

  it('el confirm ya no promete borrar el historial en cascada', async () => {
    renderVista()
    fireEvent.click(screen.getByLabelText(/^Eliminar /))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    const [{ text }] = mocks.confirm.mock.calls[0] as unknown as [{ text: string }]
    expect(text).not.toMatch(/se borra también su historial/)
    expect(text).toMatch(/se conservan/)
  })
})
