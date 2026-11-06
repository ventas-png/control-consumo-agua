// Portal del residente · Paquetería: la tarjeta de cada pieza (recibida o dejada para un tercero) abre
// su ficha en ventana emergente (EditModal real, pantalla completa en el teléfono) con datos, notas,
// fotos y firma, y la acción en el pie: Firmar recepción (abre la firma encima de la ficha) o Ver
// código de retiro (abre el código encima). Antes cada tarjeta traía desplegadas fotos, firma y botón.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { PaqueteRecibido } from '../../../../types'

const mocks = vi.hoisted(() => ({
  firmarRecepcionPaquete: vi.fn(async (..._a: unknown[]) => ({ error: null as { message: string } | null })),
  autorizarSalidaPaquete: vi.fn(async () => ({ data: null, error: null })),
  uploadCondominiosMedia: vi.fn(async (..._a: unknown[]) => ({ error: null as string | null })),
  notify: vi.fn(),
  onRefresh: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}), rpc: () => ({}) } }))
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrl: (src: string | null) => (src ? `https://firmado.test/${src}` : null), useSignedUrls: (s: string[]) => s }))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({ firmarRecepcionPaquete: mocks.firmarRecepcionPaquete, autorizarSalidaPaquete: mocks.autorizarSalidaPaquete }))
vi.mock('../../../../domain/shared/storage', () => ({ uploadCondominiosMedia: mocks.uploadCondominiosMedia }))
vi.mock('../../../shared/ImageUploader', () => ({ MultiImageUploader: () => null }))
// El lienzo de la firma no existe en jsdom: el stub ofrece el botón de guardar con un PNG de mentira.
vi.mock('../../../shared/SignaturePad', () => ({
  SignaturePad: ({ onSave, saveLabel }: { onSave: (f: File) => void; saveLabel?: string }) => (
    <button type="button" onClick={() => onSave(new File(['firma'], 'firma.png', { type: 'image/png' }))}>{saveLabel ?? 'Guardar firma'}</button>
  ),
}))

const { PortalPaquetesTab } = await import('../PortalPaquetesTab')
const { MediaScopeProvider } = await import('../../../shared/MediaScopeContext')

const pieza = (o: Partial<PaqueteRecibido>): PaqueteRecibido => ({
  id: 'p?', company_id: 'co1', project_id: 'pr1', unidad_id: 'u1', clase: 'paquete', destinatario_tipo: 'unidad', prioridad: 'normal',
  descripcion: '?', tipo: 'paquete', estado: 'pendiente', hora_recepcion: '2026-11-05T15:30:00.000Z', created_at: '2026-11-05T15:30:00.000Z', ...o,
})
const CAJA = pieza({ id: 'r1', descripcion: 'Caja Amazon', remitente: 'Amazon', empresa_mensajeria: 'DHL', num_guia: 'GT123', fotos: ['pr1/paquetes/a.jpg', 'pr1/paquetes/b.jpg'], notas: 'Pesado, con cuidado.', prioridad: 'urgente' })
const BANCO = pieza({ id: 'r2', descripcion: 'Documentos del banco', tipo: 'documento', estado: 'entregado', hora_recepcion: '2026-11-01T10:00:00.000Z', hora_entrega: '2026-11-02T20:00:00.000Z', entregado_a_nombre: 'Ana Morales', firma_path: 'pr1/paquetes-firmas/f.png' })
const LLAVES = pieza({ id: 's1', descripcion: 'Sobre con llaves', tipo: 'sobre', direccion: 'saliente_tercero', autorizado_nombre: 'Carlos García', autorizado_documento: '1234 56789 0101', autorizado_telefono: '5555-1111', codigo_retiro: 'RUKJ2BW7', hora_recepcion: '2026-10-20T10:00:00.000Z' })
const ROPA = pieza({ id: 's2', descripcion: 'Bolsa de ropa', direccion: 'saliente_tercero', estado: 'entregado', autorizado_nombre: 'Ana López', entregado_a_nombre: 'Ana López', hora_recepcion: '2026-10-18T10:00:00.000Z', hora_entrega: '2026-10-21T15:00:00.000Z' })

function montar(vista: 'recibidos' | 'salidas' = 'recibidos') {
  return render(
    <MediaScopeProvider projectId="pr1">
      <PortalPaquetesTab paquetes={[CAJA, BANCO, LLAVES, ROPA]} unidadId="u1" nombrePrefill="Ana Morales" vista={vista} onVistaChange={vi.fn()} onRefresh={mocks.onRefresh} />
    </MediaScopeProvider>,
  )
}
const abrir = (nombre: string) => fireEvent.click(screen.getByRole('button', { name: nombre }))
const ficha = (titulo: string) => screen.getByRole('dialog', { name: titulo })
const pie = (titulo: string) => ficha(titulo).querySelector('.at-modal-footer') as HTMLElement
const botonesPie = (titulo: string) => within(pie(titulo)).getAllByRole('button').map(b => b.textContent)

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

describe('PortalPaquetesTab — la tarjeta abre la ficha en ventana', () => {
  it('recibidos: sin pulsar nada sólo hay tarjetas; la ficha trae datos, notas y fotos, y Firmar recepción abre la firma encima', async () => {
    montar()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('📷 2')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Firmar recepción/ })).toBeNull()
    expect(screen.queryByText('Pesado, con cuidado.')).toBeNull()

    abrir('Caja Amazon')
    const v = ficha('Caja Amazon')
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    // Estado: chip del subtítulo y tarjeta de datos.
    expect(within(v).getAllByText('Pendiente de retiro')).toHaveLength(2)
    expect(within(v).getByText('Amazon')).toBeTruthy()
    expect(within(v).getByText('DHL')).toBeTruthy()
    expect(within(v).getByText('GT123')).toBeTruthy()
    expect(within(v).getByText('Urgente')).toBeTruthy()
    expect(within(v).getByText(/05 de noviembre de 2026/)).toBeTruthy()
    expect(within(v).getByText('Pesado, con cuidado.')).toBeTruthy()
    expect(within(v).getByAltText('Foto 2 de Caja Amazon')).toBeTruthy()
    expect(botonesPie('Caja Amazon')).toEqual(['Cerrar', '✍ Firmar recepción'])

    fireEvent.click(within(pie('Caja Amazon')).getByRole('button', { name: '✍ Firmar recepción' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    const firma = ficha('Firmar recepción')
    expect(within(firma).getByDisplayValue('Ana Morales')).toBeTruthy()
    fireEvent.click(within(firma).getByRole('button', { name: 'Confirmar recepción' }))
    await waitFor(() => expect(mocks.firmarRecepcionPaquete).toHaveBeenCalledTimes(1))
    const [id, path, nombre] = mocks.firmarRecepcionPaquete.mock.calls[0] as unknown as [string, string, string]
    expect(id).toBe('r1')
    expect(path).toMatch(/^pr1\/paquetes-firmas\//)
    expect(nombre).toBe('Ana Morales')
    expect(mocks.uploadCondominiosMedia).toHaveBeenCalledTimes(1)
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Recepción firmada' }))
    expect(mocks.onRefresh).toHaveBeenCalledTimes(1)
    // La firma se cierra; la ficha sigue abierta.
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))
    expect(ficha('Caja Amazon')).toBeTruthy()
  })

  it('una pieza ya recibida muestra la firma y sólo Cerrar; Cerrar, Escape y Enter', () => {
    montar()
    abrir('Documentos del banco')
    const v = ficha('Documentos del banco')
    expect(within(v).getAllByText('Recibido')).toHaveLength(2)
    expect(within(v).getByAltText('Firma de recepción')).toBeTruthy()
    expect(within(v).getByText(/^Firmado por Ana Morales/)).toBeTruthy()
    expect(within(v).getByText(/02 de noviembre de 2026.*por Ana Morales/)).toBeTruthy()
    expect(botonesPie('Documentos del banco')).toEqual(['Cerrar'])
    fireEvent.click(within(pie('Documentos del banco')).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Caja Amazon' }), { key: 'Enter' })
    expect(ficha('Caja Amazon')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('dejados para retiro: la ficha trae a quien recoge y el código, y Ver código abre el QR encima; lo retirado sólo Cerrar', () => {
    montar('salidas')
    expect(screen.getByText('Esperando retiro')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Ver código de retiro/ })).toBeNull()
    expect(screen.queryByText('RUKJ2BW7')).toBeNull()

    abrir('Sobre con llaves')
    const v = ficha('Sobre con llaves')
    expect(within(v).getAllByText('Esperando retiro')).toHaveLength(2)
    expect(within(v).getByText('Carlos García')).toBeTruthy()
    expect(within(v).getByText('1234 56789 0101')).toBeTruthy()
    expect(within(v).getByText('5555-1111')).toBeTruthy()
    expect(within(v).getByText('RUKJ2BW7')).toBeTruthy()
    expect(botonesPie('Sobre con llaves')).toEqual(['Cerrar', '📲 Ver código de retiro'])
    fireEvent.click(within(pie('Sobre con llaves')).getByRole('button', { name: '📲 Ver código de retiro' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    const codigo = ficha('Código de retiro')
    expect(within(codigo).getByText('RUKJ2BW7')).toBeTruthy()
    expect(within(codigo).getByLabelText('QR del código')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(ficha('Sobre con llaves')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })

    abrir('Bolsa de ropa')
    expect(within(ficha('Bolsa de ropa')).getAllByText('Retirado')).toHaveLength(2)
    expect(within(ficha('Bolsa de ropa')).getByText(/21 de octubre de 2026.*por Ana López/)).toBeTruthy()
    expect(botonesPie('Bolsa de ropa')).toEqual(['Cerrar'])
  })
})
