// La solicitud de autorización de renta viaja COMPLETA: datos del contrato +
// documentos anexos (20260828000000 / 20260828000100).
//
// Estas pruebas cubren las tres reglas de producto que la UI debe sostener:
//   1. Con STR los datos de contrato no aplican y no se piden.
//   2. Con arrendamiento, nombre + monto + fecha inicio son obligatorios (son
//      justo las tres columnas NOT NULL de `contratos_arrendamiento`).
//   3. Los adjuntos se suben a `renta-docs` y viajan en el jsonb `documentos`
//      con su path bare y la etiqueta que el propietario escribió.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import type { SolicitudRentaUnidad } from '../../../../types'

const h = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  uploadRentaDoc: vi.fn(async () => ({ error: null })),
  removeRentaDocs: vi.fn(async () => ({ error: null })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../lib/storageUrls', () => ({
  useSignedUrl: (src: string | null) => (src ? `https://firmado.test/${src}` : null),
}))
vi.mock('../../../shared/Dialog', () => ({ notify: h.notify, confirm: vi.fn(async () => ({ isConfirmed: false })) }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: h.createCondominioRow,
  createCondominioRowReturning: vi.fn(async () => ({ error: null, data: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRowsByIds: vi.fn(async () => ({ error: null })),
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchContratosByUnidad: vi.fn(async () => []),
  fetchReservasStrByUnidad: vi.fn(async () => []),
  fetchHuespedesByReservas: vi.fn(async () => []),
}))
vi.mock('../../../../domain/portal/inquilinos', () => ({
  fetchInquilinosDeUnidad: vi.fn(async () => ({ data: [] })),
  registrarInquilino: vi.fn(),
  quitarInquilino: vi.fn(),
  darDeBajaRenta: vi.fn(),
}))
vi.mock('../../../../domain/shared/storage', () => ({
  uploadRentaDoc: h.uploadRentaDoc,
  removeRentaDocs: h.removeRentaDocs,
  uploadCondominiosMedia: vi.fn(),
  removeCondominiosMedia: vi.fn(),
}))
// El magic-byte check lee bytes reales; aquí se da por bueno para no acoplar la
// prueba a las firmas de archivo (ya cubiertas en fileValidation.test.ts).
vi.mock('../../../../lib/fileValidation', () => ({
  validateFileMagic: vi.fn(async () => ({ ok: true, detected: 'application/pdf' })),
  buildUploadPath: (folder: string, name: string) => `${folder}/1700000000000-abc123-${name}`,
  resolveUploadContentType: (detected: string) => detected,
}))
vi.mock('../../../shared/ImageUploader', () => ({ ImageUploader: () => null }))

const { PortalRentasTab } = await import('../PortalRentasTab')

/** Sin solicitud vigente el tab rinde el formulario de solicitud. */
function renderForm() {
  return render(
    <PortalRentasTab
      unidadId="u1" unidadNombre="Apto. 1D" proyectoId="p1" companyId="c1" clienteId="cli-1"
      solicitudRenta={null as unknown as SolicitudRentaUnidad | null} onSolicitudChange={() => {}}
    />,
  )
}

function elegirTipo(label: string) {
  fireEvent.click(screen.getByLabelText(label, { selector: 'input' }))
}

function llenar(label: string, valor: string) {
  const input = screen.getByLabelText(label, { selector: 'input' })
  fireEvent.change(input, { target: { value: valor } })
}

beforeEach(() => { Object.values(h).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('PortalRentasTab — solicitud con datos de contrato y adjuntos', () => {
  it('con STR no se piden los datos del contrato', async () => {
    renderForm()
    expect(screen.getByText('📄 Datos del arrendamiento')).toBeTruthy()

    elegirTipo('STR / Corto Plazo')
    await act(async () => {})

    expect(screen.queryByText('📄 Datos del arrendamiento')).toBeNull()
    // Los documentos SÍ se piden en cualquier tipo: son el respaldo del archivo.
    expect(screen.getByText('📎 Documentos para la administración')).toBeTruthy()
  })

  it('con arrendamiento y sin los datos obligatorios no envía nada', async () => {
    renderForm()
    fireEvent.click(screen.getByText('Enviar solicitud'))
    await act(async () => {})

    expect(h.createCondominioRow).not.toHaveBeenCalled()
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
  })

  it('envía los datos del contrato y los adjuntos con path y etiqueta', async () => {
    renderForm()

    llenar('Nombre del arrendatario *', 'Luis de la Roca')
    llenar('Monto de renta *', '5000')
    llenar('Fecha inicio *', '2026-09-01')
    llenar('DPI / Identificación', '4545656565')

    const file = new File(['%PDF-1.4'], 'contrato.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await act(async () => {})

    fireEvent.change(screen.getByLabelText('Etiqueta de contrato.pdf'), {
      target: { value: 'Contrato firmado' },
    })

    fireEvent.click(screen.getByText('Enviar solicitud'))
    await act(async () => {})

    // El primer segmento del path debe ser la unidad: la RLS del bucket
    // `renta-docs` autoriza por ahí.
    expect(h.uploadRentaDoc).toHaveBeenCalledWith(
      'u1/1700000000000-abc123-contrato.pdf',
      file,
      { contentType: 'application/pdf' },
    )

    expect(h.createCondominioRow).toHaveBeenCalledWith('solicitud_renta_unidad', expect.objectContaining({
      unidad_id: 'u1',
      tipo_renta: 'arrendamiento',
      arrendatario_nombre: 'Luis de la Roca',
      arrendatario_identificacion: '4545656565',
      monto_renta: 5000,
      fecha_inicio: '2026-09-01',
      documentos: [expect.objectContaining({
        path: 'u1/1700000000000-abc123-contrato.pdf',
        nombre: 'contrato.pdf',
        etiqueta: 'Contrato firmado',
      })],
    }))
  })

  it('si el insert falla, borra los adjuntos ya subidos', async () => {
    h.createCondominioRow.mockResolvedValueOnce({ error: { message: 'boom' } } as never)
    renderForm()

    llenar('Nombre del arrendatario *', 'Luis de la Roca')
    llenar('Monto de renta *', '5000')
    llenar('Fecha inicio *', '2026-09-01')

    const file = new File(['%PDF-1.4'], 'dpi.pdf', { type: 'application/pdf' })
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    })
    await act(async () => {})

    fireEvent.click(screen.getByText('Enviar solicitud'))
    await act(async () => {})

    expect(h.removeRentaDocs).toHaveBeenCalledWith(['u1/1700000000000-abc123-dpi.pdf'])
  })
})
