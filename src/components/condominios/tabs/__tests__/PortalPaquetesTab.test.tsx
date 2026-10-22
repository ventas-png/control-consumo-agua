// Paquetería del portal del residente: el formulario para dejar un paquete a un
// tercero se abre en ventana (antes se desplegaba dentro de la lista y empujaba
// todo hacia abajo en el teléfono), y la lista de lo dejado dice en palabras si
// sigue esperando o si ya se lo llevaron.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { PaqueteRecibido } from '../../../../types'

vi.mock('../../../shared/Dialog', () => ({ notify: vi.fn() }))

vi.mock('../../../../domain/condominios/tabMutations', () => ({
  firmarRecepcionPaquete: vi.fn(),
  autorizarSalidaPaquete: vi.fn(),
}))

vi.mock('../../../../domain/shared/storage', () => ({ uploadCondominiosMedia: vi.fn() }))
vi.mock('../../../shared/ImageUploader', () => ({ MultiImageUploader: () => null }))
vi.mock('../../../shared/SecureImage', () => ({ SecureImage: () => null }))
vi.mock('../../../shared/SignaturePad', () => ({ SignaturePad: () => null }))

vi.mock('../../../shared/EditModal', () => ({
  EditModal: ({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) => (
    <div role="dialog" aria-label={title}>{children}{footer}</div>
  ),
}))

import { PortalPaquetesTab } from '../PortalPaquetesTab'

function salida(over: Partial<PaqueteRecibido> = {}): PaqueteRecibido {
  return {
    id: 's1', company_id: 'c1', project_id: 'pr1', unidad_id: 'u1',
    clase: 'paquete', destinatario_tipo: 'unidad', prioridad: 'normal',
    descripcion: 'Sobre con llaves', tipo: 'sobre', estado: 'pendiente',
    direccion: 'saliente_tercero', autorizado_nombre: 'Carlos García',
    codigo_retiro: 'RUKJ2BW7',
    hora_recepcion: '2026-10-20T10:00:00Z', created_at: '2026-10-20T10:00:00Z',
    ...over,
  }
}

function renderTab(paquetes: PaqueteRecibido[], vista: 'recibidos' | 'salidas' = 'salidas') {
  return render(
    <PortalPaquetesTab paquetes={paquetes} unidadId="u1" vista={vista} onVistaChange={vi.fn()} onRefresh={vi.fn()} />,
  )
}

afterEach(cleanup)

describe('PortalPaquetesTab — dejar un paquete para un tercero', () => {
  it('el formulario abre en ventana, no dentro de la lista', () => {
    renderTab([])
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Autorizar retiro' }))

    const ventana = screen.getByRole('dialog', { name: 'Dejar un paquete en recepción' })
    expect(ventana).toBeTruthy()
    expect(screen.getByLabelText('¿Qué dejarás? *')).toBeTruthy()
    expect(screen.getByLabelText('¿Quién lo recogerá? *')).toBeTruthy()
  })

  it('el tipo se elige con botones, y queda marcado el elegido', () => {
    renderTab([])
    fireEvent.click(screen.getByRole('button', { name: '+ Autorizar retiro' }))

    const sobre = screen.getByRole('button', { name: /Sobre/ })
    expect(sobre.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(sobre)
    expect(sobre.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /Paquete/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('lo que sigue esperando ofrece el código; lo retirado dice quién se lo llevó', () => {
    renderTab([
      salida(),
      salida({ id: 's2', descripcion: 'Bolsa de ropa', estado: 'entregado', entregado_a_nombre: 'Ana López', hora_entrega: '2026-10-21T15:00:00Z' }),
    ])

    expect(screen.getByText('Esperando retiro')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Ver código de retiro/ })).toHaveLength(1)
    expect(screen.getByText(/Retirado por Ana López/)).toBeTruthy()
  })
})
