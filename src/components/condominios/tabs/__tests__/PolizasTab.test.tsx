// Seguros: el resumen y la lista muestran la situación de hoy —una póliza
// marcada «vigente» cuya fecha ya pasó cuenta como vencida, no suma a la
// prima y se avisa—; la lista se lee como tarjetas en el teléfono; nueva,
// editar y el detalle (con agente, documento, estado y acciones) van en
// ventana, sin cerrarse a mitad del guardado y conservando lo escrito.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { PolizaSeguro } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  deleteCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify, confirm: mocks.confirm }))
vi.mock('../../../shared/FileUploader', () => ({ FileUploader: () => null }))
vi.mock('../../../shared/SecureFileLink', () => ({
  SecureFileLink: ({ children }: { children: React.ReactNode }) => <a href="#doc">{children}</a>,
}))
vi.mock('../../exportUtils', () => ({ exportarPDFTabla: vi.fn(), exportarExcel: vi.fn() }))

const { PolizasTab } = await import('../PolizasTab')

function poliza(over: Partial<PolizaSeguro>): PolizaSeguro {
  return {
    id: 'x', company_id: 'co1', project_id: 'pr1', numero_poliza: 'POL', aseguradora: 'Seguros GT', tipo: 'incendio',
    descripcion: null, suma_asegurada: null, prima_anual: null, fecha_inicio: '2026-01-01', fecha_vencimiento: '2027-01-01',
    estado: 'vigente', agente_nombre: null, agente_telefono: null, agente_email: null, documento_url: null, notas: null,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  } as PolizaSeguro
}

const polizas = [
  poliza({ id: 'p1', numero_poliza: 'POL-1', aseguradora: 'Aseguradora Rural', prima_anual: 1000, suma_asegurada: 500000, fecha_vencimiento: '2027-06-30',
    agente_nombre: 'Luis Pérez', agente_telefono: '5555-1234', agente_email: 'luis@seguros.gt', documento_url: 'polizas/pol1.pdf', descripcion: 'Cubre áreas comunes' }),
  poliza({ id: 'p2', numero_poliza: 'POL-2', tipo: 'responsabilidad_civil', prima_anual: 500, fecha_vencimiento: '2026-11-10' }),
  // Marcada vigente pero ya venció: no debe contar como vigente ni sumar.
  poliza({ id: 'p3', numero_poliza: 'POL-3', tipo: 'robo', prima_anual: 300, fecha_vencimiento: '2026-10-01' }),
  poliza({ id: 'p4', numero_poliza: 'POL-4', estado: 'cancelada', prima_anual: 200, fecha_vencimiento: '2027-01-01' }),
  poliza({ id: 'p5', numero_poliza: 'POL-5', estado: 'vencida', fecha_vencimiento: '2026-08-01' }),
]

function props(over: Partial<Parameters<typeof PolizasTab>[0]> = {}): Parameters<typeof PolizasTab>[0] {
  return { polizas, proyectoId: 'pr1', companyId: 'co1', moneda: 'Q', canCreate: true, canEdit: true, canDelete: true, onRefresh: vi.fn(), ...over }
}

function esperar<T>() {
  let resolver!: (v: T) => void
  const promesa = new Promise<T>(res => { resolver = res })
  return { promesa, resolver }
}

const filas = (container: HTMLElement) => Array.from(container.querySelectorAll('tbody tr')).map(tr => tr.textContent ?? '')

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 24, 12, 0, 0)) // 24 oct 2026
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.deleteCondominioRow.mockResolvedValue({ error: null })
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Seguros — resumen y lista', () => {
  it('el resumen cuenta por la fecha: la vigente vencida no suma a la prima y se avisa', () => {
    render(<PolizasTab {...props()} />)
    expect(screen.getByRole('button', { name: 'Vigentes: 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Por vencer: 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Vencidas: 2' })).toBeTruthy()
    // 1,000 + 500 (antes sumaba también los 300 de POL-3).
    expect(screen.getByText('Q 1,500.00').textContent).toBe('Q\u00a01,500.00')
    expect(screen.getByRole('status').textContent).toContain('1 póliza ya venció y sigue marcada como vigente')
  })

  it('por defecto muestra las vigentes, lo que vence primero arriba; cada cifra filtra', () => {
    const { container } = render(<PolizasTab {...props()} />)
    expect(filas(container).map(t => t.match(/POL-\d/)?.[0])).toEqual(['POL-2', 'POL-1'])
    expect(filas(container)[0]).toContain('vence en 17 días')
    expect(filas(container)[0]).toContain('Por vencer')

    fireEvent.click(screen.getByRole('button', { name: 'Vencidas: 2' }))
    expect(screen.getByRole('button', { name: 'Vencidas: 2' }).getAttribute('aria-pressed')).toBe('true')
    expect(filas(container).map(t => t.match(/POL-\d/)?.[0])).toEqual(['POL-5', 'POL-3'])
    expect(filas(container)[1]).toContain('venció hace 23 días')

    fireEvent.click(screen.getByRole('button', { name: 'Por vencer: 1' }))
    expect(filas(container).map(t => t.match(/POL-\d/)?.[0])).toEqual(['POL-2'])

    fireEvent.click(screen.getByRole('button', { name: 'Canceladas (1)' }))
    expect(filas(container).map(t => t.match(/POL-\d/)?.[0])).toEqual(['POL-4'])
    expect(screen.getByRole('button', { name: 'Todas (5)' })).toBeTruthy()
  })

  it('«Ver vencidas» del aviso lleva a las vencidas', () => {
    const { container } = render(<PolizasTab {...props()} />)
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Ver vencidas' }))
    expect(filas(container).map(t => t.match(/POL-\d/)?.[0])).toEqual(['POL-5', 'POL-3'])
  })

  it('la lista se lee como tarjetas con rótulos; sin selectores ni íconos sueltos en la fila', () => {
    const { container } = render(<PolizasTab {...props()} />)
    const tabla = container.querySelector('table')!
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    expect(Array.from(tabla.querySelectorAll('tbody tr:first-child td')).map(td => td.getAttribute('data-label')))
      .toEqual(['Póliza', 'Tipo', 'Suma asegurada', 'Prima anual', 'Vence', 'Estado', null])
    expect(within(tabla).queryByRole('combobox')).toBeNull()
    expect(within(tabla).queryByRole('button', { name: /Eliminar|Editar|WhatsApp/ })).toBeNull()
  })
})

describe('Seguros — detalle en ventana', () => {
  it('«Ver» abre a pantalla completa con montos, agente para llamar y el documento', () => {
    render(<PolizasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver póliza POL-1' }))
    const detalle = screen.getByRole('dialog', { name: '🔥 Póliza POL-1' })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(detalle).getByText('Q 500,000.00')).toBeTruthy()
    expect(within(detalle).getByRole('link', { name: '5555-1234' }).getAttribute('href')).toBe('tel:5555-1234')
    expect(within(detalle).getByRole('link', { name: 'luis@seguros.gt' }).getAttribute('href')).toBe('mailto:luis@seguros.gt')
    expect(within(detalle).getByRole('link', { name: '📄 Ver póliza' })).toBeTruthy()
    expect(within(detalle).getByText('Cubre áreas comunes')).toBeTruthy()
  })

  it('tocar la fila abre el detalle; la vigente vencida lo dice y se marca vencida con un toque', async () => {
    const onRefresh = vi.fn()
    const { container } = render(<PolizasTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Vencidas: 2' }))
    fireEvent.click(within(container.querySelector('tbody')!).getByText(/POL-3/))
    const detalle = screen.getByRole('dialog', { name: '🔒 Póliza POL-3' })
    expect(within(detalle).getByText(/Venció el 2026-10-01 y sigue marcada como vigente/)).toBeTruthy()
    expect(within(detalle).getByRole('button', { name: '✓ Vigente' }).getAttribute('aria-pressed')).toBe('true')

    const cambio = esperar<{ error: null }>()
    mocks.updateCondominioRow.mockReturnValueOnce(cambio.promesa)
    fireEvent.click(within(detalle).getByRole('button', { name: 'Vencida' }))
    fireEvent.click(within(detalle).getByRole('button', { name: 'Cancelada' }))
    expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1)
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('polizas_seguro', 'p3', { estado: 'vencida' })
    cambio.resolver({ error: null })
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it('si cambiar el estado falla, avisa', async () => {
    render(<PolizasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver póliza POL-2' }))
    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'Permiso denegado' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelada' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Permiso denegado' })))
  })

  it('eliminar pide confirmación, borra y cierra la ventana', async () => {
    render(<PolizasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver póliza POL-2' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar POL-2' }))
    await waitFor(() => expect(mocks.deleteCondominioRow).toHaveBeenCalledWith('polizas_seguro', 'p2'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('sin permiso de editar no hay Editar ni cambio de estado', () => {
    render(<PolizasTab {...props({ canEdit: false, canDelete: false, canCreate: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nueva póliza' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver póliza POL-1' }))
    const detalle = screen.getByRole('dialog')
    expect(within(detalle).queryByRole('button', { name: /Editar/ })).toBeNull()
    expect(within(detalle).queryByText('Estado guardado')).toBeNull()
    expect(within(detalle).queryByRole('button', { name: /Eliminar/ })).toBeNull()
  })
})

describe('Seguros — nueva y editar en ventana', () => {
  it('editar desde el detalle: la ventana trae los datos y no se cierra mientras guarda', async () => {
    const onRefresh = vi.fn()
    render(<PolizasTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver póliza POL-1' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '✏️ Editar' }))
    const ventana = screen.getByRole('dialog', { name: '✏️ Editar póliza POL-1' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect((screen.getByLabelText('Aseguradora *') as HTMLInputElement).value).toBe('Aseguradora Rural')
    fireEvent.change(screen.getByLabelText('Prima anual (Q)'), { target: { value: '1200' } })

    const guardado = esperar<{ error: null }>()
    mocks.updateCondominioRow.mockReturnValueOnce(guardado.promesa)
    fireEvent.click(within(ventana).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('polizas_seguro', 'p1', expect.objectContaining({ prima_anual: 1200, numero_poliza: 'POL-1' })))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: '✏️ Editar póliza POL-1' })).toBeTruthy()

    guardado.resolver({ error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('nueva: valida las fechas; si falla, conserva lo escrito; tras cancelar una edición empieza en blanco', async () => {
    render(<PolizasTab {...props()} />)
    // Una edición cancelada…
    fireEvent.click(screen.getByRole('button', { name: 'Ver póliza POL-1' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '✏️ Editar' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
    // …no se cuela en la nueva.
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva póliza' }))
    const ventana = screen.getByRole('dialog', { name: '🛡️ Nueva póliza' })
    expect((screen.getByLabelText('No. de póliza *') as HTMLInputElement).value).toBe('')

    fireEvent.change(screen.getByLabelText('No. de póliza *'), { target: { value: 'POL-9' } })
    fireEvent.change(screen.getByLabelText('Aseguradora *'), { target: { value: 'Mapfre' } })
    fireEvent.change(screen.getByLabelText('Fecha inicio *'), { target: { value: '2026-10-24' } })
    // Un vencimiento anterior al inicio no deja enviar: el campo lo marca.
    fireEvent.change(screen.getByLabelText('Fecha vencimiento *'), { target: { value: '2026-10-01' } })
    expect((screen.getByLabelText('Fecha vencimiento *') as HTMLInputElement).validity.rangeUnderflow).toBe(true)
    fireEvent.click(within(ventana).getByRole('button', { name: 'Crear póliza' }))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '🛡️ Nueva póliza' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Fecha vencimiento *'), { target: { value: '2027-10-24' } })
    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'Sin conexión' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Crear póliza' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect(mocks.createCondominioRow).toHaveBeenCalledWith('polizas_seguro', expect.objectContaining({
      numero_poliza: 'POL-9', aseguradora: 'Mapfre', fecha_inicio: '2026-10-24', fecha_vencimiento: '2027-10-24', estado: 'vigente',
    }))
    expect((screen.getByLabelText('No. de póliza *') as HTMLInputElement).value).toBe('POL-9')

    // Cancelar tampoco borra lo escrito.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva póliza' }))
    expect((screen.getByLabelText('Aseguradora *') as HTMLInputElement).value).toBe('Mapfre')
  })

  it('sin fecha de inicio avisa en vez de mandar un error de la base', async () => {
    render(<PolizasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva póliza' }))
    fireEvent.change(screen.getByLabelText('No. de póliza *'), { target: { value: 'POL-9' } })
    fireEvent.change(screen.getByLabelText('Aseguradora *'), { target: { value: 'Mapfre' } })
    fireEvent.change(screen.getByLabelText('Fecha inicio *'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Fecha vencimiento *'), { target: { value: '2027-10-24' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Crear póliza' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ text: 'Ingresa la fecha de inicio.' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })
})
