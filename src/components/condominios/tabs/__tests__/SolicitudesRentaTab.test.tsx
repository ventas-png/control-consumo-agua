// La administración evalúa la solicitud con los datos y adjuntos que mandó el
// propietario, y al aprobar puede generar el contrato de una vez.
//
// Aprobar va por el RPC `aprobar_solicitud_renta` (20260828000200) y NO por un
// update de tabla: crear el contrato cruza dos permisos RBAC distintos y debe
// ser atómico. El rechazo sigue siendo un update normal.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import type { SolicitudRentaUnidad, Unidad } from '../../../../types'

const h = vi.hoisted(() => ({
  aprobarSolicitudRenta: vi.fn<(input: Record<string, unknown>) => Promise<{
    contratoCreado: boolean
    contratoId: string | null
    contratoAnteriorTerminado: string | null
    error: string | null
  }>>(async () => ({ contratoCreado: true, contratoId: 'k1', contratoAnteriorTerminado: null, error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  openPromptDialog: vi.fn<(opts: unknown) => Promise<Record<string, string> | null>>(async () => ({ comentario: 'ok' })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../lib/storageUrls', () => ({
  useSignedUrl: (src: string | null) => (src ? `https://firmado.test/${src}` : null),
}))
vi.mock('../../../shared/Dialog', () => ({ notify: h.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: h.openPromptDialog }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({ updateCondominioRow: h.updateCondominioRow }))
vi.mock('../../../../domain/condominios/solicitudRenta', () => ({ aprobarSolicitudRenta: h.aprobarSolicitudRenta }))

const { SolicitudesRentaTab } = await import('../SolicitudesRentaTab')

const UNIDADES = [{ id: 'u1', nombre: 'Apto. 1D' }] as unknown as Unidad[]

/** Nombres de los campos con que se abrió el diálogo de resolución. */
function camposDelDialogo(): string[] {
  const [opts] = h.openPromptDialog.mock.calls[0] as [{ fields: Array<{ name: string }> }]
  return opts.fields.map(f => f.name)
}

function solicitud(over: Partial<SolicitudRentaUnidad> = {}): SolicitudRentaUnidad {
  return {
    id: 's1', company_id: 'c1', project_id: 'p1', unidad_id: 'u1',
    tipo_renta: 'arrendamiento', estado: 'pendiente',
    created_at: '2026-08-20T12:00:00Z',
    arrendatario_nombre: 'Luis de la Roca',
    monto_renta: 5000,
    fecha_inicio: '2026-09-01',
    documentos: [{ path: 'u1/s1/1700-abc-contrato.pdf', nombre: 'contrato.pdf', etiqueta: 'Contrato firmado' }],
    resp_mantenimiento: 'propietario', resp_agua: 'inquilino', resp_electricidad: 'inquilino',
    resp_basura: 'propietario', resp_telefonia: 'propietario', resp_internet: 'inquilino',
    ...over,
  } as SolicitudRentaUnidad
}

function renderTab(s: SolicitudRentaUnidad) {
  render(
    <SolicitudesRentaTab
      solicitudes={[s]} unidades={UNIDADES} proyectoId="p1" companyId="c1"
      autorNombre="Admin Uno" canEdit onRefresh={() => {}}
    />,
  )
  // La tarjeta arranca colapsada; el detalle y las acciones están al expandir.
  fireEvent.click(screen.getByText('🏠 Apto. 1D'))
}

beforeEach(() => {
  Object.values(h).forEach(m => m.mockClear())
  h.openPromptDialog.mockResolvedValue({ comentario: 'ok' })
})
afterEach(cleanup)

describe('SolicitudesRentaTab — datos, responsables y aprobación', () => {
  it('muestra los datos propuestos, los responsables y el documento anexo', async () => {
    renderTab(solicitud())
    await act(async () => {})

    expect(screen.getByText('Luis de la Roca')).toBeTruthy()
    expect(screen.getByText('Contrato firmado')).toBeTruthy()
    expect(screen.getByText('contrato.pdf')).toBeTruthy()
    expect(screen.getByText('🧾 Responsable del pago de servicios')).toBeTruthy()
    // Tres a cargo del inquilino (agua, electricidad, internet) y tres del propietario.
    expect(screen.getAllByText('Inquilino')).toHaveLength(3)
    expect(screen.getAllByText('Propietario')).toHaveLength(3)
  })

  it('con datos completos el contrato es obligatorio: ni se ofrece omitirlo', async () => {
    renderTab(solicitud())
    fireEvent.click(screen.getByText('✅ Aprobar'))
    await act(async () => {})

    // No hay casilla que desmarcar ni justificación que pedir.
    expect(camposDelDialogo()).toEqual(['comentario'])
    expect(h.aprobarSolicitudRenta).toHaveBeenCalledWith({
      solicitudId: 's1',
      tipoAprobado: 'arrendamiento',
      comentario: 'ok',
      crearContrato: true,
      motivoSinContrato: null,
    })
    // La identidad de auditoría la pone el servidor, no este cliente.
    expect(h.aprobarSolicitudRenta.mock.calls[0][0]).not.toHaveProperty('aprobadoPor')
    expect(h.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('avisa cuando además se cerró el contrato anterior de la unidad', async () => {
    h.aprobarSolicitudRenta.mockResolvedValueOnce({
      contratoCreado: true, contratoId: 'k2', contratoAnteriorTerminado: 'k1', error: null,
    })
    renderTab(solicitud())
    fireEvent.click(screen.getByText('✅ Aprobar'))
    await act(async () => {})

    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Se creó el contrato y se dio por terminado el anterior de la unidad.',
    }))
  })

  it('una solicitud heredada sin datos exige justificación para aprobarse sin contrato', async () => {
    h.openPromptDialog.mockResolvedValue({ comentario: 'ok', motivo_sin_contrato: 'Solicitud antigua' })
    renderTab(solicitud({ arrendatario_nombre: null, monto_renta: null, fecha_inicio: null, documentos: [] }))
    fireEvent.click(screen.getByText('✅ Aprobar'))
    await act(async () => {})

    expect(camposDelDialogo()).toContain('motivo_sin_contrato')
    expect(h.aprobarSolicitudRenta).toHaveBeenCalledWith(expect.objectContaining({
      crearContrato: false,
      motivoSinContrato: 'Solicitud antigua',
    }))
  })

  it('si el RPC falla, no se anuncia una aprobación que no ocurrió', async () => {
    h.aprobarSolicitudRenta.mockResolvedValueOnce({
      contratoCreado: false, contratoId: null, contratoAnteriorTerminado: null,
      error: 'La solicitud no trae los datos del contrato',
    })
    renderTab(solicitud())
    fireEvent.click(screen.getByText('✅ Aprobar'))
    await act(async () => {})

    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
    expect(h.notify).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Solicitud aprobada' }))
  })

  it('rechazar sigue siendo un update de tabla', async () => {
    h.openPromptDialog.mockResolvedValue({ comentario: 'Falta el DPI' })
    renderTab(solicitud())
    fireEvent.click(screen.getByText('❌ Rechazar'))
    await act(async () => {})

    expect(h.aprobarSolicitudRenta).not.toHaveBeenCalled()
    expect(h.updateCondominioRow).toHaveBeenCalledWith('solicitud_renta_unidad', 's1', expect.objectContaining({
      estado: 'rechazada',
      comentario_admin: 'Falta el DPI',
    }))
  })
})
