// La solicitud de autorización de renta viaja COMPLETA: datos del contrato,
// responsables de los seis servicios y documentos anexos.
//
// Reglas que la UI debe sostener (el resto lo exigen la BD y los RPC, y se
// cubren en supabase/tests/solicitud_renta_contrato):
//   1. Con STR no aplican ni los datos del contrato ni los responsables.
//   2. Con arrendamiento, nombre + monto + fecha inicio son obligatorios.
//   3. Los adjuntos se suben AL ELEGIRLOS, bajo {unidad_id}/{solicitud_id}/ —
//      la carpeta del borrador reservado, que es lo que la policy del bucket
//      verifica (20260829000400).
//   4. El envío va por el RPC `portal_enviar_solicitud_renta`, no por un insert.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import type { SolicitudRentaUnidad } from '../../../../types'

const h = vi.hoisted(() => ({
  reservarSolicitudRenta: vi.fn<(unidadId: string) => Promise<{ solicitudId: string | null; error: string | null }>>(
    async () => ({ solicitudId: 'sol-1', error: null }),
  ),
  enviarSolicitudRenta: vi.fn(async () => ({ error: null as string | null })),
  uploadRentaDoc: vi.fn(async () => ({ error: null as string | null })),
  removeRentaDocs: vi.fn(async () => ({ error: null as string | null })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../lib/storageUrls', () => ({
  useSignedUrl: (src: string | null) => (src ? `https://firmado.test/${src}` : null),
}))
vi.mock('../../../shared/Dialog', () => ({ notify: h.notify, confirm: vi.fn(async () => ({ isConfirmed: false })) }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
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
vi.mock('../../../../domain/portal/solicitudRenta', () => ({
  reservarSolicitudRenta: h.reservarSolicitudRenta,
  enviarSolicitudRenta: h.enviarSolicitudRenta,
  descartarSolicitudRenta: vi.fn(),
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

/** Sin solicitud vigente el tab rinde el formulario y reserva el borrador. */
async function renderForm() {
  const r = render(
    <PortalRentasTab
      unidadId="u1" unidadNombre="Apto. 1D" proyectoId="p1" companyId="c1"
      solicitudRenta={null as unknown as SolicitudRentaUnidad | null} onSolicitudChange={() => {}}
    />,
  )
  await act(async () => {})   // deja resolver la reserva del borrador
  return r
}

function elegirTipo(label: string) {
  fireEvent.click(screen.getByLabelText(label, { selector: 'input' }))
}

function llenar(label: string, valor: string) {
  fireEvent.change(screen.getByLabelText(label, { selector: 'input' }), { target: { value: valor } })
}

async function adjuntar(nombre: string) {
  const file = new File(['%PDF-1.4'], nombre, { type: 'application/pdf' })
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [file] },
  })
  await act(async () => {})
  return file
}

beforeEach(() => {
  Object.values(h).forEach(m => m.mockClear())
  h.reservarSolicitudRenta.mockResolvedValue({ solicitudId: 'sol-1', error: null })
  h.enviarSolicitudRenta.mockResolvedValue({ error: null })
  h.uploadRentaDoc.mockResolvedValue({ error: null })
})
afterEach(cleanup)

describe('PortalRentasTab — solicitud con responsables y adjuntos', () => {
  it('reserva el borrador al abrir el formulario', async () => {
    await renderForm()
    expect(h.reservarSolicitudRenta).toHaveBeenCalledWith('u1')
  })

  it('con STR no se piden datos del contrato ni responsables', async () => {
    await renderForm()
    expect(screen.getByText('📄 Datos del arrendamiento')).toBeTruthy()
    expect(screen.getByText('🧾 Responsable del pago de servicios')).toBeTruthy()

    elegirTipo('STR / Corto Plazo')
    await act(async () => {})

    expect(screen.queryByText('📄 Datos del arrendamiento')).toBeNull()
    expect(screen.queryByText('🧾 Responsable del pago de servicios')).toBeNull()
    // Los documentos SÍ se piden en cualquier tipo: son el respaldo del archivo.
    expect(screen.getByText('📎 Documentos para la administración')).toBeTruthy()
  })

  it('rinde los seis selectores de responsable', async () => {
    await renderForm()
    for (const label of ['Mantenimiento', 'Agua', 'Electricidad', 'Extracción de basura', 'Telefonía', 'Internet']) {
      expect(screen.getByLabelText(`Responsable de ${label}`)).toBeTruthy()
    }
  })

  it('con arrendamiento y sin los datos obligatorios no envía nada', async () => {
    await renderForm()
    fireEvent.click(screen.getByText('Enviar solicitud'))
    await act(async () => {})

    expect(h.enviarSolicitudRenta).not.toHaveBeenCalled()
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
  })

  it('sube el adjunto a la carpeta del borrador, no a la de la unidad', async () => {
    await renderForm()
    const file = await adjuntar('contrato.pdf')

    expect(h.uploadRentaDoc).toHaveBeenCalledWith(
      'u1/sol-1/1700000000000-abc123-contrato.pdf',
      file,
      { contentType: 'application/pdf' },
    )
  })

  it('envía por RPC los datos, los seis responsables y los documentos', async () => {
    await renderForm()

    llenar('Nombre del arrendatario *', 'Luis de la Roca')
    llenar('Monto de renta *', '5000')
    llenar('Fecha inicio *', '2026-09-01')
    llenar('DPI / Identificación', '4545656565')

    fireEvent.change(screen.getByLabelText('Responsable de Agua'), { target: { value: 'inquilino' } })
    fireEvent.change(screen.getByLabelText('Responsable de Internet'), { target: { value: 'inquilino' } })

    await adjuntar('contrato.pdf')
    fireEvent.change(screen.getByLabelText('Etiqueta de contrato.pdf'), {
      target: { value: 'Contrato firmado' },
    })

    fireEvent.click(screen.getByText('Enviar solicitud'))
    await act(async () => {})

    expect(h.enviarSolicitudRenta).toHaveBeenCalledWith(expect.objectContaining({
      solicitudId: 'sol-1',
      tipoRenta: 'arrendamiento',
      arrendatarioNombre: 'Luis de la Roca',
      arrendatarioIdentificacion: '4545656565',
      montoRenta: 5000,
      fechaInicio: '2026-09-01',
      responsables: {
        mantenimiento: 'propietario',
        agua: 'inquilino',
        electricidad: 'propietario',
        basura: 'propietario',
        telefonia: 'propietario',
        internet: 'inquilino',
      },
      documentos: [expect.objectContaining({
        path: 'u1/sol-1/1700000000000-abc123-contrato.pdf',
        nombre: 'contrato.pdf',
        etiqueta: 'Contrato firmado',
      })],
    }))
  })

  it('quitar un adjunto lo borra del bucket', async () => {
    await renderForm()
    await adjuntar('dpi.pdf')

    fireEvent.click(screen.getByTitle('Quitar'))
    await act(async () => {})

    expect(h.removeRentaDocs).toHaveBeenCalledWith(['u1/sol-1/1700000000000-abc123-dpi.pdf'])
  })

  it('sin borrador reservado no deja adjuntar ni enviar', async () => {
    h.reservarSolicitudRenta.mockResolvedValue({ solicitudId: null, error: 'La unidad ya tiene una solicitud' })
    await renderForm()

    expect(screen.getByText(/No se pudo preparar la solicitud/)).toBeTruthy()
    expect((screen.getByText('Enviar solicitud') as HTMLButtonElement).disabled).toBe(true)
  })
})
