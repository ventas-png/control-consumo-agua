import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { ComunicadoCondominio } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { ComunicadosTab } = await import('../ComunicadosTab')

const comunicado = {
  id: 'c1', titulo: 'Corte de agua', contenido: 'Mañana no habrá servicio de 8 a 12.\nAlmacene agua.',
  tipo: 'aviso', destinatario: 'todos', unidad_id: null, unidad_nombre: null,
  enviado_por: 'Administración', fecha_envio: '2026-10-20', firmado: true,
} as unknown as ComunicadoCondominio

function renderTab(props: Partial<Parameters<typeof ComunicadosTab>[0]> = {}) {
  return render(
    <ComunicadosTab comunicados={[comunicado]} unidades={[]} proyectoId="p1" companyId="co1" userId="u1"
      canCreate canDelete onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('ComunicadosTab — ventanas', () => {
  it('cada comunicado se abre en ventana (pantalla completa en el teléfono) y ya no parte la lista', () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^📌 Corte de agua/ }))

    const dialog = screen.getByRole('dialog', { name: 'Corte de agua' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText(/Almacene agua/)).toBeTruthy()
    expect(within(dialog).getByText('✓ Documento firmado')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('publicar en el portal desde la ventana crea el anuncio', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: /^📌 Corte de agua/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '📢 Publicar en portal' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('anuncios_comunidad', expect.objectContaining({ titulo: 'Corte de agua' })))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('el formulario de nuevo comunicado es una ventana con sus etiquetas', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo Comunicado' }))
    const dialog = screen.getByRole('dialog', { name: 'Nuevo comunicado' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Título *'), { target: { value: 'Asamblea' } })
    fireEvent.change(within(dialog).getByLabelText('Contenido *'), { target: { value: 'Se convoca…' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('comunicados_condominio', expect.objectContaining({ titulo: 'Asamblea', contenido: 'Se convoca…' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('sin permiso de crear no hay botón de nuevo ni de publicar', () => {
    renderTab({ canCreate: false, canDelete: false })
    expect(screen.queryByRole('button', { name: '+ Nuevo Comunicado' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Portal/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^📌 Corte de agua/ }))
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /Publicar/ })).toBeNull()
  })
})
