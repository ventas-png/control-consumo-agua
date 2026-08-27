// Prueba 12 (catálogo compartido): el CRUD de áreas extraído de RutasRondaTab
// funciona igual desde cualquier anfitrión, y corrige los tres huecos del
// original: el insert ahora manda `activo`, el delete maneja el error de FK en
// lugar de fallar en silencio, y el nombre duplicado (normalizado) se rechaza.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { AreaCondominio } from '../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  updateCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))
vi.mock('../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../shared/Dialog', () => ({
  confirm: mocks.confirm,
  notify: mocks.notify,
}))

const { AreasCatalog } = await import('../AreasCatalog')

function area(over: Partial<AreaCondominio> = {}): AreaCondominio {
  return {
    id: 'a1', company_id: 'co1', project_id: 'p1', nombre: 'Piscina',
    descripcion: null, icono: '🏊', orden: 0, activo: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function renderCatalog(props: Partial<Parameters<typeof AreasCatalog>[0]> = {}) {
  return render(
    <AreasCatalog
      areas={[area()]}
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

describe('AreasCatalog — catálogo compartido de áreas', () => {
  it('lista las áreas del catálogo', () => {
    renderCatalog()
    expect(screen.getByText('Piscina')).toBeTruthy()
    expect(screen.getByText(/Orden: 0 · Activa/)).toBeTruthy()
  })

  it('el alta manda `activo` en el payload (el original dependía del DEFAULT)', async () => {
    renderCatalog()
    fireEvent.click(screen.getByText('+ Nueva área'))
    fireEvent.change(screen.getByPlaceholderText(/Lobby principal/), { target: { value: ' Gimnasio ' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('areas_condominio')
    expect(payload).toMatchObject({
      company_id: 'co1', project_id: 'p1', nombre: 'Gimnasio', activo: true,
    })
  })

  it('rechaza el nombre duplicado por normalización (espacios/mayúsculas)', async () => {
    renderCatalog()
    fireEvent.click(screen.getByText('+ Nueva área'))
    fireEvent.change(screen.getByPlaceholderText(/Lobby principal/), { target: { value: '  PISCINA ' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect(mocks.notify.mock.calls[0][0]).toMatchObject({ title: 'Área duplicada' })
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })

  it('renombrar un área no choca consigo misma', async () => {
    renderCatalog()
    fireEvent.click(screen.getByText('✏️ Editar'))
    fireEvent.click(screen.getByText('Actualizar'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(tabla).toBe('areas_condominio')
    expect(id).toBe('a1')
    expect(patch).toMatchObject({ nombre: 'Piscina', activo: true })
  })

  it('el toggle desactiva sin borrar', async () => {
    renderCatalog()
    fireEvent.click(screen.getByText('Desactivar'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('areas_condominio', 'a1', { activo: false }))
  })

  it('el delete bloqueado por FK (23503) explica que se desactive, no truena en silencio', async () => {
    mocks.deleteCondominioRow.mockResolvedValue({ error: { message: 'violates foreign key constraint', code: '23503' } })
    renderCatalog()
    fireEvent.click(screen.getByLabelText('Eliminar Piscina'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const aviso = mocks.notify.mock.calls[0][0] as { title: string; text: string }
    expect(aviso.title).toBe('El área está en uso')
    expect(aviso.text).toMatch(/Desactívala/)
  })

  it('sin permisos de edición no hay botones de escritura', () => {
    renderCatalog({ canCreate: false, canEdit: false, canDelete: false })
    expect(screen.queryByText('+ Nueva área')).toBeNull()
    expect(screen.queryByText('✏️ Editar')).toBeNull()
  })

  it('canEdit sin canDelete: se puede editar y desactivar, pero NO eliminar', () => {
    // El DELETE de areas_condominio es de company_owner/admin: mostrar el
    // botón a quien solo edita produciría un fallo silencioso de RLS.
    renderCatalog({ canDelete: false })
    expect(screen.getByText('✏️ Editar')).toBeTruthy()
    expect(screen.getByText('Desactivar')).toBeTruthy()
    expect(screen.queryByLabelText('Eliminar Piscina')).toBeNull()
  })

  it('catálogo vacío → estado vacío compartido', () => {
    renderCatalog({ areas: [] })
    expect(screen.getByText('Sin áreas definidas')).toBeTruthy()
  })
})
