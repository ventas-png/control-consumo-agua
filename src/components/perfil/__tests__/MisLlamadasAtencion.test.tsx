import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { LlamadaAtencionMia } from '../../../types'

const mocks = vi.hoisted(() => ({
  fetchMisLlamadasAtencion: vi.fn(async () => ({ data: [] as unknown[], error: null })),
  subirFirmaLlamada: vi.fn(async () => ({ path: 'p1/ll1/acuse.png', error: null })),
  acusarLlamadaAtencion: vi.fn(async () => ({ data: null, error: null })),
  generarCartaLlamadaPdf: vi.fn(async () => new Blob(['pdf'])),
  compartirOdescargarPdf: vi.fn(async () => false),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../shared/Dialog', () => ({ notify: mocks.notify, confirm: vi.fn() }))
vi.mock('../../shared/SecureImage', () => ({ SecureImage: () => null }))
vi.mock('../../shared/SignaturePad', () => ({
  SignaturePad: ({ onSave, saveLabel }: { onSave: (f: File) => void; saveLabel?: string }) => (
    <button data-testid="firma-pad" onClick={() => onSave(new File(['x'], 'firma.png', { type: 'image/png' }))}>{saveLabel}</button>
  ),
}))
vi.mock('../../../domain/condominios/llamadasAtencion', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../domain/condominios/llamadasAtencion')>()),
  fetchMisLlamadasAtencion: mocks.fetchMisLlamadasAtencion,
  subirFirmaLlamada: mocks.subirFirmaLlamada,
  acusarLlamadaAtencion: mocks.acusarLlamadaAtencion,
}))
vi.mock('../../condominios/tabs/llamadasAtencion/llamadasAtencionPdf', () => ({ generarCartaLlamadaPdf: mocks.generarCartaLlamadaPdf }))
vi.mock('../../condominios/tabs/housekeepingPdf', () => ({ compartirOdescargarPdf: mocks.compartirOdescargarPdf }))

const { MisLlamadasAtencion } = await import('../MisLlamadasAtencion')

const pendiente: LlamadaAtencionMia = {
  id: 'll1', project_id: 'p1', proyecto_nombre: 'Condominio 1', personal_id: 'e1', empleado_nombre: 'Elena Empleada', empleado_cargo: 'Guardia',
  tipo: 'llamada_atencion', fecha_hechos: '2026-10-20', motivo: 'Llegada tarde', descripcion: 'Tres ingresos tarde.',
  estado: 'pendiente', emitido_por_nombre: 'Rosa RRHH', emitido_en: '2026-10-21T14:00:00Z', firma_emisor_path: 'p1/ll1/emisor.png',
}
const firmada: LlamadaAtencionMia = {
  ...pendiente, id: 'll0', motivo: 'Uniforme incompleto', estado: 'acusada',
  acuse_en: '2026-09-01T10:00:00Z', acuse_nombre: 'Elena Empleada', acuse_modo: 'usuario', firma_acuse_path: 'p1/ll0/acuse.png',
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('MisLlamadasAtencion (Mi perfil)', () => {
  it('sin cartas no pinta nada: es el caso normal de quien no es empleado', async () => {
    mocks.fetchMisLlamadasAtencion.mockResolvedValueOnce({ data: [], error: null })
    const { container } = render(<MisLlamadasAtencion />)
    await waitFor(() => expect(mocks.fetchMisLlamadasAtencion).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('avisa cuántas hay por firmar y lista todas con su estado', async () => {
    mocks.fetchMisLlamadasAtencion.mockResolvedValueOnce({ data: [pendiente, firmada], error: null })
    render(<MisLlamadasAtencion />)
    expect(await screen.findByText(/Tenés una carta por leer y firmar/)).toBeTruthy()
    expect(screen.getByText('Llegada tarde')).toBeTruthy()
    expect(screen.getByText('Uniforme incompleto')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Leer y firmar' })).toHaveLength(1)
  })

  it('leer y firmar: sube la firma bajo la carta, llama a la RPC y recarga', async () => {
    mocks.fetchMisLlamadasAtencion
      .mockResolvedValueOnce({ data: [pendiente], error: null })
      .mockResolvedValueOnce({ data: [{ ...pendiente, estado: 'acusada', acuse_en: '2026-10-22T09:00:00Z', acuse_nombre: 'Elena Empleada', acuse_modo: 'usuario', firma_acuse_path: 'p1/ll1/acuse.png' }], error: null })
    render(<MisLlamadasAtencion />)
    fireEvent.click(await screen.findByRole('button', { name: 'Leer y firmar' }))
    const d = screen.getByRole('dialog', { name: 'Leer y firmar de recibido' })
    expect(within(d).getByText('Tres ingresos tarde.')).toBeTruthy()
    expect(within(d).getByText(/no significa que estés de acuerdo/)).toBeTruthy()
    fireEvent.click(within(d).getByTestId('firma-pad'))
    await waitFor(() => expect(mocks.acusarLlamadaAtencion).toHaveBeenCalledWith('ll1', 'Elena Empleada', 'p1/ll1/acuse.png'))
    expect(mocks.subirFirmaLlamada).toHaveBeenCalledWith('p1', 'll1', expect.any(File), 'acuse')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Leer y firmar' })).toBeNull())
    expect(mocks.fetchMisLlamadasAtencion).toHaveBeenCalledTimes(2)
  })

  it('el PDF lleva la carta y el condominio', async () => {
    mocks.fetchMisLlamadasAtencion.mockResolvedValueOnce({ data: [firmada], error: null })
    render(<MisLlamadasAtencion />)
    fireEvent.click(await screen.findByRole('button', { name: 'PDF' }))
    await waitFor(() => expect(mocks.generarCartaLlamadaPdf).toHaveBeenCalledWith({ carta: firmada, proyectoNombre: 'Condominio 1' }))
    expect(mocks.compartirOdescargarPdf).toHaveBeenCalledWith(expect.any(Blob), 'Llamada_de_atencion-Elena_Empleada-2026-10-20.pdf')
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'PDF descargado' })))
  })
})
