import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { LlamadaAtencionPersonal, PersonalCondominio } from '../../../../types'
import { eliminarExigeSuPermiso } from '../../../../test/eliminarExigeSuPermiso'

const mocks = vi.hoisted(() => ({
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
  subirFirmaLlamada: vi.fn<() => Promise<{ path: string | null; error: string | null }>>(async () => ({ path: 'p1/ID/firma.png', error: null })),
  emitirLlamadaAtencion: vi.fn(async () => ({ error: null })),
  acusarLlamadaAtencion: vi.fn(async () => ({ data: null, error: null })),
  anularLlamadaAtencion: vi.fn(async () => ({ error: null })),
  generarCartaLlamadaPdf: vi.fn(async () => new Blob(['pdf'])),
  compartirOdescargarPdf: vi.fn(async () => true),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({ deleteCondominioRow: mocks.deleteCondominioRow }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../../shared/SecureImage', () => ({ SecureImage: () => null }))
// SignaturePad pinta en <canvas>, que jsdom no implementa: se reduce a un botón
// que entrega el PNG.
vi.mock('../../../shared/SignaturePad', () => ({
  SignaturePad: ({ onSave, saveLabel }: { onSave: (f: File) => void; saveLabel?: string }) => (
    <button data-testid="firma-pad" onClick={() => onSave(new File(['x'], 'firma.png', { type: 'image/png' }))}>
      {saveLabel ?? 'Guardar firma'}
    </button>
  ),
}))
vi.mock('../../../../domain/condominios/llamadasAtencion', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../domain/condominios/llamadasAtencion')>()),
  subirFirmaLlamada: mocks.subirFirmaLlamada,
  emitirLlamadaAtencion: mocks.emitirLlamadaAtencion,
  acusarLlamadaAtencion: mocks.acusarLlamadaAtencion,
  anularLlamadaAtencion: mocks.anularLlamadaAtencion,
}))
vi.mock('../llamadasAtencion/llamadasAtencionPdf', () => ({ generarCartaLlamadaPdf: mocks.generarCartaLlamadaPdf }))
vi.mock('../housekeepingPdf', () => ({ compartirOdescargarPdf: mocks.compartirOdescargarPdf }))

const { default: LlamadasAtencionTab } = await import('../LlamadasAtencionTab')

function emp(id: string, nombre: string, estado: PersonalCondominio['estado'], extra: Partial<PersonalCondominio> = {}): PersonalCondominio {
  return { id, company_id: 'co1', project_id: 'p1', nombre, cargo: 'guardia', turno: 'diurno', estado, ...extra } as PersonalCondominio
}
const personal = [
  emp('e1', 'Elena Empleada', 'activo', { user_id: 'u-elena' }),
  emp('e2', 'Pedro Sin Cuenta', 'activo'),
  emp('e3', 'Beto Inactivo', 'inactivo'),
]

const pendiente: LlamadaAtencionPersonal = {
  id: 'll1', company_id: 'co1', project_id: 'p1', personal_id: 'e1', empleado_nombre: 'Elena Empleada', empleado_cargo: 'Guardia',
  tipo: 'llamada_atencion', fecha_hechos: '2026-10-20', motivo: 'Llegada tarde', descripcion: 'Tres ingresos después de las 07:15.',
  estado: 'pendiente', emitido_por: 'u-rrhh', emitido_por_nombre: 'Rosa RRHH', emitido_en: '2026-10-21T14:00:00Z',
  firma_emisor_path: 'p1/ll1/emisor.png', notificado_en: '2026-10-21T14:00:01Z', created_at: '2026-10-21T14:00:00Z', updated_at: '2026-10-21T14:00:00Z',
}
const acusada: LlamadaAtencionPersonal = {
  ...pendiente, id: 'll2', personal_id: 'e2', empleado_nombre: 'Pedro Sin Cuenta', tipo: 'suspension', dias_suspension: 2,
  motivo: 'Abandono de puesto', estado: 'acusada', notificado_en: null,
  acuse_en: '2026-10-22T09:00:00Z', acuse_por: 'u-rrhh', acuse_nombre: 'Pedro Sin Cuenta', acuse_modo: 'presencial', firma_acuse_path: 'p1/ll2/acuse.png',
}

function renderTab(props: Partial<Parameters<typeof LlamadasAtencionTab>[0]> = {}) {
  return render(
    <LlamadasAtencionTab llamadas={[pendiente, acusada]} personal={personal} proyectoId="p1" companyId="co1" proyectoNombre="Condominio 1"
      canCreate canEdit canChangeStatus canDelete onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('LlamadasAtencionTab — emitir', () => {
  it('ofrece sólo el personal que no está inactivo y marca quién no tiene cuenta', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva llamada de atención' }))
    const sel = within(screen.getByRole('dialog')).getByLabelText('Empleado *') as HTMLSelectElement
    expect([...sel.options].filter(o => o.value).map(o => o.value)).toEqual(['e1', 'e2'])
    expect([...sel.options].find(o => o.value === 'e2')!.text).toMatch(/sin cuenta/)
  })

  it('sin empleado o sin asunto no pasa a la firma', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva llamada de atención' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Continuar a la firma' }))
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' }))
    expect(screen.queryByTestId('firma-pad')).toBeNull()
  })

  it('una suspensión exige los días', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva llamada de atención' }))
    const d = screen.getByRole('dialog')
    fireEvent.change(within(d).getByLabelText('Empleado *'), { target: { value: 'e1' } })
    fireEvent.change(within(d).getByLabelText('Tipo *'), { target: { value: 'suspension' } })
    fireEvent.change(within(d).getByLabelText('Asunto *'), { target: { value: 'Abandono' } })
    fireEvent.change(within(d).getByLabelText('Detalle de la carta *'), { target: { value: 'Dejó la garita.' } })
    fireEvent.click(within(d).getByRole('button', { name: 'Continuar a la firma' }))
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Faltan datos' }))
    fireEvent.change(within(d).getByLabelText('Días sin goce de salario *'), { target: { value: '2' } })
    fireEvent.click(within(d).getByRole('button', { name: 'Continuar a la firma' }))
    expect(screen.getByTestId('firma-pad')).toBeTruthy()
  })

  it('sube la firma del emisor bajo <proyecto>/<carta>/ y emite con el empleado, el cargo y la firma', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva llamada de atención' }))
    const d = screen.getByRole('dialog')
    fireEvent.change(within(d).getByLabelText('Empleado *'), { target: { value: 'e1' } })
    fireEvent.change(within(d).getByLabelText('Asunto *'), { target: { value: ' Llegada tarde ' } })
    fireEvent.change(within(d).getByLabelText('Detalle de la carta *'), { target: { value: 'Tres ingresos tarde.' } })
    fireEvent.click(within(d).getByRole('button', { name: 'Continuar a la firma' }))
    // La vista previa muestra la carta antes de firmar.
    expect(within(screen.getByRole('dialog')).getByText('Tres ingresos tarde.')).toBeTruthy()
    fireEvent.click(screen.getByTestId('firma-pad'))

    await waitFor(() => expect(mocks.emitirLlamadaAtencion).toHaveBeenCalledTimes(1))
    const [projectId, llamadaId, file, cual] = mocks.subirFirmaLlamada.mock.calls[0] as unknown as [string, string, File, string]
    expect(projectId).toBe('p1'); expect(llamadaId).toMatch(/^[0-9a-f-]{36}$/); expect(file.name).toBe('firma.png'); expect(cual).toBe('emisor')
    expect(mocks.emitirLlamadaAtencion).toHaveBeenCalledWith(expect.objectContaining({
      id: llamadaId, companyId: 'co1', projectId: 'p1', personalId: 'e1', empleadoCargo: 'Guardia',
      tipo: 'llamada_atencion', motivo: ' Llegada tarde ', descripcion: 'Tres ingresos tarde.', diasSuspension: null,
      firmaEmisorPath: 'p1/ID/firma.png',
    }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', text: expect.stringMatching(/recibe el aviso/) }))
  })

  it('si la firma no sube, no emite', async () => {
    mocks.subirFirmaLlamada.mockResolvedValueOnce({ path: null, error: 'bucket' })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva llamada de atención' }))
    const d = screen.getByRole('dialog')
    fireEvent.change(within(d).getByLabelText('Empleado *'), { target: { value: 'e2' } })
    fireEvent.change(within(d).getByLabelText('Asunto *'), { target: { value: 'x' } })
    fireEvent.change(within(d).getByLabelText('Detalle de la carta *'), { target: { value: 'y' } })
    fireEvent.click(within(d).getByRole('button', { name: 'Continuar a la firma' }))
    fireEvent.click(screen.getByTestId('firma-pad'))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'No se subió la firma' })))
    expect(mocks.emitirLlamadaAtencion).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('LlamadasAtencionTab — acuse en persona, anular, PDF', () => {
  it('el acuse en persona sólo se ofrece pendiente y con canEdit, y llama a la RPC con la firma subida bajo la carta', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    expect(screen.getAllByRole('button', { name: /Registrar acuse en persona de/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Registrar acuse en persona de Elena Empleada' }))
    const d = screen.getByRole('dialog', { name: 'Registrar acuse en persona' })
    expect((within(d).getByLabelText('Recibí: nombre completo *') as HTMLInputElement).value).toBe('Elena Empleada')
    fireEvent.change(within(d).getByLabelText('Recibí: nombre completo *'), { target: { value: 'Elena' } })
    fireEvent.click(within(d).getByTestId('firma-pad'))
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Falta el nombre' }))
    expect(mocks.subirFirmaLlamada).not.toHaveBeenCalled()

    fireEvent.change(within(d).getByLabelText('Recibí: nombre completo *'), { target: { value: 'Elena Empleada' } })
    fireEvent.click(within(d).getByTestId('firma-pad'))
    await waitFor(() => expect(mocks.acusarLlamadaAtencion).toHaveBeenCalledWith('ll1', 'Elena Empleada', 'p1/ID/firma.png'))
    expect(mocks.subirFirmaLlamada).toHaveBeenCalledWith('p1', 'll1', expect.any(File), 'acuse')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('sin canEdit no hay acuse en persona', () => {
    renderTab({ canEdit: false })
    expect(screen.queryByRole('button', { name: /Registrar acuse en persona de/ })).toBeNull()
  })

  it('anular pide motivo y exige canChangeStatus', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: /^Ver carta de .*Abandono de puesto/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Anular' }))
    const d = screen.getByRole('dialog', { name: 'Anular la carta' })
    fireEvent.click(within(d).getByRole('button', { name: 'Anular' }))
    expect(mocks.anularLlamadaAtencion).not.toHaveBeenCalled()
    fireEvent.change(within(d).getByLabelText('Motivo de la anulación *'), { target: { value: 'Emitida por error' } })
    fireEvent.click(within(d).getByRole('button', { name: 'Anular' }))
    await waitFor(() => expect(mocks.anularLlamadaAtencion).toHaveBeenCalledWith('ll2', 'Emitida por error'))
    expect(onRefresh).toHaveBeenCalled()

    cleanup()
    renderTab({ canChangeStatus: false })
    fireEvent.click(screen.getByRole('button', { name: /^Ver carta de .*Abandono de puesto/ }))
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Anular' })).toBeNull()
  })

  it('el PDF se genera con la carta y el condominio y se comparte o descarga', async () => {
    renderTab({ canCreate: false, canEdit: false, canChangeStatus: false, canDelete: false })
    fireEvent.click(screen.getByRole('button', { name: 'PDF de Abandono de puesto' }))
    await waitFor(() => expect(mocks.generarCartaLlamadaPdf).toHaveBeenCalledWith({ carta: acusada, proyectoNombre: 'Condominio 1' }))
    expect(mocks.compartirOdescargarPdf).toHaveBeenCalledWith(expect.any(Blob), 'Suspension-Pedro_Sin_Cuenta-2026-10-20.pdf')
  })

  it('sin permisos: ni emitir, ni acuse, ni eliminar; la carta se puede ver', () => {
    renderTab({ canCreate: false, canEdit: false, canChangeStatus: false, canDelete: false })
    expect(screen.queryByRole('button', { name: '+ Nueva llamada de atención' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Registrar acuse/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Eliminar/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Ver carta de .*Llegada tarde/ }))
    const d = screen.getByRole('dialog', { name: 'Llamada de atención — Elena Empleada' })
    expect(within(d).getByText(/puede firmar desde Mi perfil/)).toBeTruthy()
  })
})

eliminarExigeSuPermiso('Llamadas de atención', p => render(
  <LlamadasAtencionTab llamadas={[pendiente]} personal={personal} proyectoId="p1" companyId="co1" canCreate canChangeStatus {...p} onRefresh={() => {}} />,
), /^Eliminar Llegada tarde$/, mocks.deleteCondominioRow, 'llamadas_atencion_personal', 'll1')
