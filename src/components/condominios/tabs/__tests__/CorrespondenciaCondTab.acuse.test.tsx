// Acuse de recibo de correspondencia (Fase 0 de la convergencia con
// Paquetería). El agujero que cierra: hasta ahora "atender" una notificación
// legal solo cambiaba `estado`, sin dejar quién la entregó, cuándo, ni a quién
// — es decir, sin prueba de entrega. Estas pruebas fijan que toda salida de
// custodia deje esa marca.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { CorrespondenciaCondominio } from '../../../../types'

vi.mock('../../../shared/Dialog', () => ({
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: false })),
}))

const createCondominioRow = vi.fn(async () => ({ error: null }))
const updateCondominioRow = vi.fn(async () => ({ error: null }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: (...args: unknown[]) => createCondominioRow(...(args as [])),
  updateCondominioRow: (...args: unknown[]) => updateCondominioRow(...(args as [])),
}))

vi.mock('../../../../domain/shared/storage', () => ({ uploadCondominiosMedia: vi.fn(async () => ({ error: null })) }))
vi.mock('../../../shared/ImageUploader', () => ({ MultiImageUploader: () => null }))
vi.mock('../../../shared/SecureImage', () => ({ SecureImage: () => null }))
vi.mock('../../../shared/SignaturePad', () => ({ SignaturePad: () => <div data-testid="firma-pad" /> }))
vi.mock('../../../shared/EditModal', () => ({
  EditModal: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="modal" aria-label={title}>{children}</div>
  ),
}))

import { CorrespondenciaCondTab } from '../CorrespondenciaCondTab'

const PIEZA: CorrespondenciaCondominio = {
  id: 'c1', company_id: 'comp', project_id: 'proj',
  tipo: 'entrada', categoria: 'notificacion_legal', asunto: 'Citación municipal',
  fecha: '2026-08-12', prioridad: 'urgente', estado: 'pendiente',
  created_at: '2026-08-12T09:00:00Z', destinatario: 'Junta Directiva',
}

function renderTab(over: Partial<CorrespondenciaCondominio> = {}) {
  return render(
    <CorrespondenciaCondTab
      correspondencia={[{ ...PIEZA, ...over }]}
      paquetes={[]}
      unidades={[]}
      proyectoId="proj"
      companyId="comp"
      userId="user-1"
      canCreate
      canEdit
      puedeVerPaqueteria
      onRefresh={() => {}}
    />,
  )
}

beforeEach(() => { createCondominioRow.mockClear(); updateCondominioRow.mockClear() })
afterEach(cleanup)

describe('CorrespondenciaCondTab — cierre de la pieza', () => {
  it('al atender deja quién la entregó, cuándo y por qué vía', () => {
    renderTab()
    fireEvent.click(screen.getByText('Atender'))
    const [tabla, id, patch] = updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(tabla).toBe('correspondencia_condominio')
    expect(id).toBe('c1')
    expect(patch.estado).toBe('atendido')
    expect(patch.entregado_por).toBe('user-1')
    expect(patch.entregado_via).toBe('porteria')
    expect(typeof patch.hora_entrega).toBe('string')
  })

  it('archivar NO inventa una entrega: archivar no es entregar', () => {
    renderTab()
    fireEvent.click(screen.getByText('Archivar'))
    const [, , patch] = updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(patch).toEqual({ estado: 'archivado' })
  })

  it('abre el acuse con firma precargando a quien iba dirigida la pieza', () => {
    renderTab()
    fireEvent.click(screen.getByText('✍ Entregar c/ firma'))
    expect(screen.getByTestId('firma-pad')).toBeTruthy()
    expect(screen.getByPlaceholderText('Nombre y apellido').getAttribute('value')).toBe('Junta Directiva')
    // El acuse aún no se guarda: la escritura ocurre al confirmar la firma.
    expect(updateCondominioRow).not.toHaveBeenCalled()
  })

  it('marca el plazo vencido de una pieza pendiente', () => {
    renderTab({ fecha_limite: '2020-01-01' })
    expect(screen.getByText(/^Vencido/)).toBeTruthy()
  })
})

describe('CorrespondenciaCondTab — registro', () => {
  it('guarda quién recibió la pieza en recepción', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Registrar'))
    fireEvent.change(screen.getByPlaceholderText('Descripción del documento'), { target: { value: 'Sobre judicial' } })
    fireEvent.click(screen.getByText('Guardar'))
    await vi.waitFor(() => expect(createCondominioRow).toHaveBeenCalled())
    const [tabla, payload] = createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('correspondencia_condominio')
    expect(payload.recibido_por).toBe('user-1')
    expect(payload.asunto).toBe('Sobre judicial')
  })
})
