// Acuse de recibo de correspondencia (Fase 0 de la convergencia con
// Paquetería). El agujero que cierra: hasta ahora "atender" una notificación
// legal solo cambiaba `estado`, sin dejar quién la entregó, cuándo, ni a quién
// — es decir, sin prueba de entrega. Estas pruebas fijan que toda salida de
// custodia deje esa marca.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { PiezaRecepcion } from '../../../../types'

vi.mock('../../../shared/Dialog', () => ({
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: false })),
}))

const createCondominioRow = vi.fn(async () => ({ data: { id: 'nueva-1' }, error: null }))
const updateCondominioRow = vi.fn(async () => ({ error: null }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRowReturning: (...args: unknown[]) => createCondominioRow(...(args as [])),
  updateCondominioRow: (...args: unknown[]) => updateCondominioRow(...(args as [])),
}))

// `avisarConReintento` decide el toast según el resultado real del aviso y
// ofrece reintentar; su lógica se prueba en condominios/__tests__/avisoRecepcion.
const avisarConReintento = vi.fn(async () => ({ estado: 'entregado' as const, detalle: {} }))
vi.mock('../../avisoRecepcion', () => ({
  avisarConReintento: (...args: unknown[]) => avisarConReintento(...(args as [])),
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

const PIEZA: PiezaRecepcion = {
  id: 'c1', company_id: 'comp', project_id: 'proj', unidad_id: null,
  clase: 'correspondencia', destinatario_tipo: 'administracion',
  direccion: 'entrante', tipo: 'notificacion_legal', descripcion: 'Citación municipal',
  fecha_pieza: '2026-08-12', prioridad: 'urgente', estado: 'pendiente',
  hora_recepcion: '2026-08-12T09:00:00Z', created_at: '2026-08-12T09:00:00Z',
  destinatario: 'Junta Directiva',
}

const UNIDAD = { id: 'u1', nombre: 'Apto 2A', activo: true } as never

function renderTab(over: Partial<PiezaRecepcion> = {}) {
  return render(
    <CorrespondenciaCondTab
      correspondencia={[{ ...PIEZA, ...over }]}
      paquetes={[]}
      unidades={[UNIDAD]}
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

beforeEach(() => {
  createCondominioRow.mockClear(); updateCondominioRow.mockClear(); avisarConReintento.mockClear()
})
afterEach(cleanup)

describe('CorrespondenciaCondTab — cierre de la pieza', () => {
  it('al atender deja quién la entregó, cuándo y por qué vía', () => {
    renderTab()
    fireEvent.click(screen.getByText('Atender'))
    const [tabla, id, patch] = updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(tabla).toBe('paquetes_recibidos')
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

  it('devolver sella quién y cuándo la sacó de custodia', () => {
    // La devolución al remitente es una salida de custodia y, en una
    // notificación legal, parte del acto: tiene que quedar sellada.
    renderTab()
    fireEvent.click(screen.getByText('↩ Devolver'))
    const [, , patch] = updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(patch.estado).toBe('devuelto')
    expect(patch.entregado_por).toBe('user-1')
    expect(typeof patch.hora_entrega).toBe('string')
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
  it('escribe en el motor único marcando la clase y quién recibió la pieza', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Registrar'))
    fireEvent.change(screen.getByPlaceholderText('Descripción del documento'), { target: { value: 'Sobre judicial' } })
    fireEvent.click(screen.getByText('Guardar'))
    await vi.waitFor(() => expect(createCondominioRow).toHaveBeenCalled())
    const [tabla, payload] = createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('paquetes_recibidos')
    // La clase es lo que separa esta fila de un paquete, en la RLS y en la UI.
    expect(payload.clase).toBe('correspondencia')
    expect(payload.recibido_por).toBe('user-1')
    expect(payload.descripcion).toBe('Sobre judicial')
  })

  it('sin unidad, la pieza queda dirigida a la administración y no se avisa a nadie', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Registrar'))
    fireEvent.change(screen.getByPlaceholderText('Descripción del documento'), { target: { value: 'Citación' } })
    fireEvent.click(screen.getByText('Guardar'))
    await vi.waitFor(() => expect(createCondominioRow).toHaveBeenCalled())
    const [, payload] = createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(payload.unidad_id).toBeNull()
    expect(payload.destinatario_tipo).toBe('administracion')
    // No hay residente destinatario: mandar un aviso sería spam a nadie.
    expect(avisarConReintento).not.toHaveBeenCalled()
  })

  it('con unidad, avisa al residente igual que paquetería', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Registrar'))
    fireEvent.change(screen.getByPlaceholderText('Descripción del documento'), { target: { value: 'Carta certificada' } })
    fireEvent.change(screen.getByDisplayValue('— Administración —'), { target: { value: 'u1' } })
    fireEvent.click(screen.getByText('Guardar'))
    await vi.waitFor(() => expect(avisarConReintento).toHaveBeenCalledWith('nueva-1'))
    const [, payload] = createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(payload.unidad_id).toBe('u1')
    expect(payload.destinatario_tipo).toBe('unidad')
  })
})
