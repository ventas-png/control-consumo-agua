// Detalle y registro de correspondencia en ventana (EditModal real). Lo del
// acuse y el motor único se prueba en CorrespondenciaCondTab.acuse.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { PiezaRecepcion } from '../../../../types'

type Resultado = { data: { id: string } | null; error: { message: string } | null }

const mocks = vi.hoisted(() => ({
  createCondominioRowReturning: vi.fn<(tabla: string, payload: Record<string, unknown>) => Promise<Resultado>>(
    async () => ({ data: { id: 'nueva-1' }, error: null }),
  ),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  registrarAcuseCorrespondencia: vi.fn(async () => ({ error: null })),
  avisarConReintento: vi.fn(async () => ({ estado: 'entregado' as const, detalle: {} })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRowReturning: mocks.createCondominioRowReturning,
  updateCondominioRow: mocks.updateCondominioRow,
  registrarAcuseCorrespondencia: mocks.registrarAcuseCorrespondencia,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../avisoRecepcion', () => ({ avisarConReintento: mocks.avisarConReintento }))
vi.mock('../../../../domain/shared/storage', () => ({
  uploadMedia: vi.fn(async () => ({ data: null, error: null })),
  removeMedia: vi.fn(async () => ({ error: null })),
}))
vi.mock('../../exportUtils', () => ({ exportarPDFTabla: vi.fn(), exportarExcel: vi.fn() }))
vi.mock('../../../shared/ImageUploader', () => ({ MultiImageUploader: () => null }))
vi.mock('../../../shared/SecureImage', () => ({ SecureImage: ({ alt }: { alt: string }) => <span>[img {alt}]</span> }))
vi.mock('../../../shared/SignaturePad', () => ({ SignaturePad: () => null }))

const { CorrespondenciaCondTab } = await import('../CorrespondenciaCondTab')

const PIEZA: PiezaRecepcion = {
  id: 'c1', company_id: 'comp', project_id: 'proj', unidad_id: null,
  clase: 'correspondencia', destinatario_tipo: 'administracion',
  direccion: 'entrante', tipo: 'notificacion_legal', descripcion: 'Citación municipal',
  fecha_pieza: '2026-08-12', prioridad: 'urgente', estado: 'pendiente',
  hora_recepcion: '2026-08-12T09:00:00Z', created_at: '2026-08-12T09:00:00Z',
  destinatario: 'Junta Directiva', remitente: 'Alcaldía', notas: 'Entregar al presidente de la junta.',
  firma_path: 'proj/c1/firma.png',
}

function renderTab(props: Partial<Parameters<typeof CorrespondenciaCondTab>[0]> = {}) {
  return render(
    <CorrespondenciaCondTab correspondencia={[PIEZA]} paquetes={[]} unidades={[]}
      proyectoId="proj" companyId="comp" userId="user-1"
      canCreate canEdit puedeVerPaqueteria onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('CorrespondenciaCondTab — ventanas', () => {
  it('el asunto es un botón que abre la pieza en ventana (pantalla completa en el teléfono)', () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Citación municipal/ }))

    const dialog = screen.getByRole('dialog', { name: 'Citación municipal' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText('📥 Entrada · Notif. Legal · pendiente')).toBeTruthy()
    expect(within(dialog).getByText('Alcaldía')).toBeTruthy()
    expect(within(dialog).getByText('Junta Directiva')).toBeTruthy()
    expect(within(dialog).getByText('Administración')).toBeTruthy()
    expect(within(dialog).getByText('Acuse de recibo')).toBeTruthy()
    expect(within(dialog).getByText('Entregar al presidente de la junta.')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('el clic en cualquier parte de la fila también la abre', () => {
    renderTab()
    fireEvent.click(screen.getByText('Notif. Legal'))
    expect(screen.getByRole('dialog', { name: 'Citación municipal' })).toBeTruthy()
  })

  it('"Entregar" abre solo el acuse, no el detalle', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '✍ Entregar' }))
    expect(screen.getByRole('dialog', { name: 'Acuse de recibo' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Citación municipal' })).toBeNull()
  })

  it('el registro es una ventana con etiquetas y guardar escribe en el motor único', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar' }))
    const dialog = screen.getByRole('dialog', { name: 'Registrar correspondencia' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Asunto *'), { target: { value: 'Factura de jardinería' } })
    fireEvent.change(within(dialog).getByLabelText('Remitente'), { target: { value: 'Jardines S.A.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.createCondominioRowReturning).toHaveBeenCalledWith('paquetes_recibidos', expect.objectContaining({
      clase: 'correspondencia', descripcion: 'Factura de jardinería', remitente: 'Jardines S.A.', recibido_por: 'user-1',
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('mientras guarda, Escape no cierra el registro', async () => {
    let resolver: (r: Resultado) => void = () => {}
    mocks.createCondominioRowReturning.mockImplementationOnce(() => new Promise<Resultado>(r => { resolver = r }))
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar' }))
    const dialog = screen.getByRole('dialog', { name: 'Registrar correspondencia' })
    fireEvent.change(within(dialog).getByLabelText('Asunto *'), { target: { value: 'Sobre judicial' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.createCondominioRowReturning).toHaveBeenCalled())

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Registrar correspondencia' })).toBeTruthy()

    resolver({ data: { id: 'nueva-1' }, error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('sin permisos no se registra ni se entrega, pero la pieza se puede consultar', () => {
    renderTab({ canCreate: false, canEdit: false })
    expect(screen.queryByRole('button', { name: '+ Registrar' })).toBeNull()
    expect(screen.queryByRole('button', { name: '✍ Entregar' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Citación municipal/ }))
    expect(screen.getByRole('dialog', { name: 'Citación municipal' })).toBeTruthy()
  })
})
