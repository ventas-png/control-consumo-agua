// Corrección 2 (historial de ejecuciones): la app ya no borra ejecuciones.
// "Quitar de la ruta" es una ANULACIÓN LÓGICA con motivo obligatorio; la fila
// y sus fotos se conservan, quedan fuera de la ruta activa y son restaurables.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { EjecucionLimpieza, PersonalCondominio, ProgramacionLimpieza } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  updateCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  openPromptDialog: vi.fn(async () => null as Record<string, string> | null),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  // deleteCondominioRow NO se exporta al mock a propósito: si VistaRuta
  // volviera a importarlo para borrar historial, el módulo fallaría al cargar.
}))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))
vi.mock('../../../shared/ImageUploader', () => ({ MultiImageUploader: () => null }))
vi.mock('../../../shared/ImageGallery', () => ({ ImageGallery: () => null }))

const { VistaRuta } = await import('../limpieza/VistaRuta')

const HOY = new Date().toISOString().slice(0, 10)

const empleado: PersonalCondominio = {
  id: 'emp1', company_id: 'co1', project_id: 'p1', nombre: 'Lucía Conserje',
  cargo: 'conserje', turno: 'diurno', estado: 'activo',
} as PersonalCondominio

function prog(over: Partial<ProgramacionLimpieza> = {}): ProgramacionLimpieza {
  return {
    id: 'prog1', company_id: 'co1', project_id: 'p1', area: 'Piscina',
    frecuencia: 'semanal', estado: 'pendiente', activo: true,
    created_at: '2026-01-01T00:00:00.000Z', orden: 0, requiere_foto: false,
    personal_id: 'emp1',
    ...over,
  }
}

function ejec(over: Partial<EjecucionLimpieza> = {}): EjecucionLimpieza {
  return {
    id: 'ej1', company_id: 'co1', project_id: 'p1', programacion_id: 'prog1',
    personal_id: 'emp1', fecha: HOY, orden: 0, estado: 'pendiente',
    foto_urls: [], requiere_mantenimiento: false,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function renderRuta(props: Partial<Parameters<typeof VistaRuta>[0]> = {}) {
  return render(
    <VistaRuta
      programaciones={[prog()]}
      ejecuciones={[ejec()]}
      personal={[empleado]}
      proyectoId="p1"
      companyId="co1"
      canCreate
      canEdit
      onRefresh={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.openPromptDialog.mockResolvedValue({ motivo: 'Cargada al área equivocada' })
})

afterEach(() => { cleanup() })

describe('VistaRuta — el historial se anula, no se borra', () => {
  it('la acción destructiva es "Anular" y pide motivo', async () => {
    renderRuta()
    expect(screen.getByLabelText('Anular Piscina')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Anular Piscina'))

    await waitFor(() => expect(mocks.openPromptDialog).toHaveBeenCalled())
    const [opciones] = mocks.openPromptDialog.mock.calls[0] as unknown as [{
      fields: Array<{ name: string; required?: boolean }>
      description?: string
    }]
    expect(opciones.fields[0]).toMatchObject({ name: 'motivo', required: true })
    expect(opciones.description).toMatch(/no se borra/)
  })

  it('anular escribe la marca lógica con motivo, sin tocar las fotos', async () => {
    renderRuta()
    fireEvent.click(screen.getByLabelText('Anular Piscina'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(tabla).toBe('ejecuciones_limpieza')
    expect(id).toBe('ej1')
    expect(patch.motivo_anulacion).toBe('Cargada al área equivocada')
    expect(patch.anulada_en).toBeTruthy()
    // `anulada_por` lo sella la BD (trg_sellar_anulacion); no viaja en el patch.
    expect(patch.anulada_por).toBeUndefined()
    expect('foto_urls' in patch).toBe(false)
  })

  it('cancelar el motivo no anula nada', async () => {
    mocks.openPromptDialog.mockResolvedValue(null)
    renderRuta()
    fireEvent.click(screen.getByLabelText('Anular Piscina'))

    await waitFor(() => expect(mocks.openPromptDialog).toHaveBeenCalled())
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('la anulada sale de la ruta activa y se lista aparte con su motivo', () => {
    renderRuta({
      ejecuciones: [ejec({
        anulada_en: '2026-08-22T10:00:00.000Z',
        motivo_anulacion: 'Duplicada por error',
        foto_urls: ['p1/limpieza/foto1.jpg'],
      })],
    })
    expect(screen.getByText(/🚫 Anuladas \(1\)/)).toBeTruthy()
    expect(screen.getByText(/Motivo: Duplicada por error/)).toBeTruthy()
    // Y conserva su evidencia.
    expect(screen.getByText('📷 1')).toBeTruthy()
  })

  it('una anulada se puede restaurar (limpia el trío completo)', async () => {
    renderRuta({
      ejecuciones: [ejec({ anulada_en: '2026-08-22T10:00:00.000Z', motivo_anulacion: 'Error' })],
    })
    fireEvent.click(screen.getAllByLabelText('Restaurar Piscina')[0])

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [, , patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(patch).toEqual({ anulada_en: null, anulada_por: null, motivo_anulacion: null })
  })
})
