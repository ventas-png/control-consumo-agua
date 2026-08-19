// Deep link del QR de retiro: .../condominios/paqueteria#retiro=<código>.
//
// Es el camino que reemplaza al QR de texto plano `PAQUETE:<código>`, que la
// cámara del teléfono rechazaba con "No se encontraron datos utilizables". El
// guardia escanea, el enlace abre este tab y aquí verificamos que el código se
// consuma: filtra la lista, describe el estado del paquete y deja la entrega
// lista para firmar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { PaqueteRecibido } from '../../../../types'

vi.mock('../../../shared/Dialog', () => ({
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: false })),
}))

vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRowReturning: vi.fn(),
  updateCondominioRow: vi.fn(),
  deleteCondominioRow: vi.fn(),
}))

vi.mock('../../../../domain/shared/storage', () => ({
  uploadCondominiosMedia: vi.fn(),
}))

vi.mock('../../../shared/ImageUploader', () => ({
  MultiImageUploader: () => null,
}))

vi.mock('../../../shared/SecureImage', () => ({
  SecureImage: () => null,
}))

vi.mock('../../../shared/SignaturePad', () => ({
  SignaturePad: () => null,
}))

vi.mock('../../../shared/EditModal', () => ({
  EditModal: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="modal" aria-label={title}>{children}</div>
  ),
}))

import { PaqueteriaSalientesTab } from '../PaqueteriaSalientesTab'

const CODIGO = 'RUKJ2BW7'

function paquete(over: Partial<PaqueteRecibido> = {}): PaqueteRecibido {
  return {
    id: 'p1', company_id: 'c1', project_id: 'pr1', unidad_id: 'u1',
    clase: 'paquete', destinatario_tipo: 'unidad', prioridad: 'normal',
    descripcion: 'Sobre con documentos', tipo: 'sobre', estado: 'pendiente',
    direccion: 'saliente_tercero', autorizado_nombre: 'Carlos García',
    codigo_retiro: CODIGO, recibido_por: 'guardia-1',
    hora_recepcion: '2026-08-18T10:00:00Z', created_at: '2026-08-18T10:00:00Z',
    unidad_nombre: 'Apto 1D', ...over,
  }
}

function renderTab(paquetes: PaqueteRecibido[], props: { canEdit?: boolean } = {}) {
  return render(
    <PaqueteriaSalientesTab
      paquetes={paquetes} unidades={[]} proyectoId="pr1" companyId="c1" userId="guardia-1"
      canCreate canEdit={props.canEdit ?? true} onRefresh={() => {}}
    />,
  )
}

function conHash(hash: string) {
  window.history.replaceState({}, '', `/condominios/paqueteria${hash}`)
}

beforeEach(() => {
  cleanup()
  conHash('')
})

afterEach(() => {
  cleanup()
})

describe('PaqueteriaSalientesTab — código escaneado en el fragmento', () => {
  it('abre la entrega con el código ya cargado', () => {
    conHash(`#retiro=${CODIGO}`)
    renderTab([paquete()])

    expect(screen.getByTestId('modal').getAttribute('aria-label')).toContain('Entregar a tercero')
    const campo = screen.getByPlaceholderText('Código que muestra quien recoge') as HTMLInputElement
    expect(campo.value).toBe(CODIGO)
  })

  it('acepta el fragmento en minúsculas (algunos navegadores normalizan la URL)', () => {
    conHash(`#retiro=${CODIGO.toLowerCase()}`)
    renderTab([paquete()])

    const campo = screen.getByPlaceholderText('Código que muestra quien recoge') as HTMLInputElement
    expect(campo.value).toBe(CODIGO)
  })

  it('borra el código de la barra de direcciones en cuanto lo lee', () => {
    conHash(`#retiro=${CODIGO}`)
    renderTab([paquete()])

    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/condominios/paqueteria')
  })

  it('anuncia el código escaneado y el paquete localizado', () => {
    conHash(`#retiro=${CODIGO}`)
    renderTab([paquete()])

    const aviso = screen.getByRole('status')
    expect(aviso.textContent).toContain(CODIGO)
    expect(aviso.textContent).toContain('Sobre con documentos')
    expect(aviso.textContent).toContain('Carlos García')
  })

  it('no abre la entrega si el residente aún no dejó el paquete en portería', () => {
    conHash(`#retiro=${CODIGO}`)
    renderTab([paquete({ recibido_por: null })])

    expect(screen.queryByTestId('modal')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Confirme la custodia')
  })

  it('avisa que el código es de un solo uso si el paquete ya se retiró', () => {
    conHash(`#retiro=${CODIGO}`)
    renderTab([paquete({ estado: 'entregado', entregado_a_nombre: 'Carlos García' })])

    expect(screen.queryByTestId('modal')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('ya fue retirado')
  })

  it('no abre la entrega sin permiso de edición', () => {
    conHash(`#retiro=${CODIGO}`)
    renderTab([paquete()], { canEdit: false })

    expect(screen.queryByTestId('modal')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('no tiene permiso')
  })

  it('señala el condominio equivocado cuando el código no está en la lista', () => {
    conHash('#retiro=ZZZZZZZZ')
    renderTab([paquete()])

    expect(screen.queryByTestId('modal')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Verifique el condominio seleccionado')
  })

  it('dice "buscando" mientras la lista aún no llega, sin afirmar que no existe', () => {
    conHash(`#retiro=${CODIGO}`)
    renderTab([])

    expect(screen.getByRole('status').textContent).toContain('Buscando el paquete')
  })

  it('sin fragmento no hay aviso ni filtro', () => {
    renderTab([paquete()])

    expect(screen.queryByRole('status')).toBeNull()
    const buscador = screen.getByPlaceholderText(/Buscar por descripción/) as HTMLInputElement
    expect(buscador.value).toBe('')
  })

  it('filtra la lista al paquete escaneado', () => {
    conHash(`#retiro=${CODIGO}`)
    renderTab([paquete(), paquete({ id: 'p2', descripcion: 'Caja grande', codigo_retiro: 'OTRO2345' })])

    const buscador = screen.getByPlaceholderText(/Buscar por descripción/) as HTMLInputElement
    expect(buscador.value).toBe(CODIGO)
    expect(screen.queryByText('Caja grande')).toBeNull()
  })
})
