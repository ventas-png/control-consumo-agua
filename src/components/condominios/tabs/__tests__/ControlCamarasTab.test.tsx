// Cámaras: deja la vista dividida (lista de 300px + panel) por una tabla que
// en el teléfono se lee como tarjetas; alta, edición y detalle van en ventana
// (pantalla completa en el teléfono). Los contadores son de las cámaras en uso,
// tras editar el detalle muestra los datos nuevos, y los cambios de estado o
// de uso avisan si fallan (antes no hacían nada).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { ControlCamaraSeguridad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: vi.fn(),
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: vi.fn(), notify: mocks.notify }))

const { default: ControlCamarasTab } = await import('../ControlCamarasTab')

function camara(over: Partial<ControlCamaraSeguridad>): ControlCamaraSeguridad {
  return {
    id: 'c1', company_id: 'co1', project_id: 'p1', codigo: 'CAM-001', nombre: 'Entrada principal', ubicacion: 'Lobby',
    tipo: 'domo', resolucion: '1080p', ip_address: '192.168.1.10', grabacion: true, dias_retencion: 30, estado: 'activa',
    ultimo_mantenimiento: null, proximo_mantenimiento: null, observaciones: null, activo: true, created_at: '2026-01-01T10:00:00Z',
    ...over,
  }
}

const camaras = [
  camara({ id: 'c1' }),
  camara({ id: 'c2', codigo: 'CAM-002', nombre: 'Parqueo', ubicacion: 'Sótano 1', estado: 'falla', observaciones: 'Lente empañado.' }),
  // Fuera de uso con falla: no cuenta en «Con fallas».
  camara({ id: 'c3', codigo: 'CAM-003', nombre: 'Bodega vieja', ubicacion: 'Bodega', estado: 'falla', activo: false }),
  camara({ id: 'c4', codigo: 'CAM-004', nombre: 'Piscina', ubicacion: 'Área de piscina', tipo: 'ptz', proximo_mantenimiento: '2025-01-01' }),
]

function props(over: Partial<Parameters<typeof ControlCamarasTab>[0]> = {}): Parameters<typeof ControlCamarasTab>[0] {
  return { camaras, proyectoId: 'p1', companyId: 'co1', canCreate: true, canEdit: true, onRefresh: vi.fn(), ...over }
}

function esperar() {
  let resolver!: (v: { error: null }) => void
  const promesa = new Promise<{ error: null }>(res => { resolver = res })
  return { promesa, resolver }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
})
afterEach(cleanup)

describe('Cámaras — alta y edición en ventana', () => {
  it('alta a pantalla completa; avisa si el código ya existe; no se cierra mientras guarda', async () => {
    const onRefresh = vi.fn()
    render(<ControlCamarasTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva cámara' }))
    const ventana = screen.getByRole('dialog', { name: '📷 Nueva cámara' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(screen.getByLabelText('Código *'), { target: { value: 'cam-002' } })
    expect(screen.getByRole('alert').textContent).toMatch(/Ya hay otra cámara con este código/)
    fireEvent.change(screen.getByLabelText('Código *'), { target: { value: 'CAM-010' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Garita' } })
    fireEvent.change(screen.getByLabelText('Ubicación *'), { target: { value: 'Acceso vehicular' } })

    const guardado = esperar()
    mocks.createCondominioRow.mockReturnValueOnce(guardado.promesa)
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow).toHaveBeenCalledWith('control_camaras_seguridad', expect.objectContaining({
      company_id: 'co1', project_id: 'p1', codigo: 'CAM-010', nombre: 'Garita', ubicacion: 'Acceso vehicular',
    }))

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: '📷 Nueva cámara' })).toBeTruthy()

    guardado.resolver({ error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('editar actualiza esa cámara y vuelve a su detalle con los datos vigentes', async () => {
    const { rerender } = render(<ControlCamarasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver cámara CAM-001' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '✏️ Editar' }))
    const ventana = screen.getByRole('dialog', { name: '✏️ Editar cámara' })
    expect((screen.getByLabelText('Nombre *') as HTMLInputElement).value).toBe('Entrada principal')
    // Su propio código no cuenta como repetido.
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Entrada peatonal' } })
    fireEvent.click(within(ventana).getByRole('button', { name: /Actualizar/ }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('control_camaras_seguridad', 'c1', expect.objectContaining({ nombre: 'Entrada peatonal' })))

    // Llega la lista refrescada: el detalle muestra el nombre nuevo, no una copia vieja.
    rerender(<ControlCamarasTab {...props({ camaras: [camara({ id: 'c1', nombre: 'Entrada peatonal' }), ...camaras.slice(1)] })} />)
    await waitFor(() => expect(screen.getByRole('dialog', { name: '📷 Entrada peatonal' })).toBeTruthy())
  })

  it('sin datos obligatorios avisa; si falla el guardado, la ventana conserva lo escrito', async () => {
    render(<ControlCamarasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva cámara' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'Sin conexión' } })
    fireEvent.change(screen.getByLabelText('Código *'), { target: { value: 'CAM-020' } })
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Terraza' } })
    fireEvent.change(screen.getByLabelText('Ubicación *'), { target: { value: 'Azotea' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect((screen.getByLabelText('Nombre *') as HTMLInputElement).value).toBe('Terraza')
  })
})

describe('Cámaras — contadores, lista y detalle', () => {
  it('los contadores son de las cámaras en uso; la lista se lee como tarjetas', () => {
    const { container } = render(<ControlCamarasTab {...props()} />)
    const kpi = (texto: string) => screen.getByText(texto).previousElementSibling?.textContent
    expect(kpi('Activas')).toBe('2')
    expect(kpi('Con fallas')).toBe('1') // CAM-003 está fuera de uso
    expect(kpi('Total registradas')).toBe('4')

    const tabla = container.querySelector('table')!
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    const celdas = Array.from(tabla.querySelectorAll('tbody tr:first-child td'))
    expect(celdas.map(td => td.getAttribute('data-label'))).toEqual(
      ['Cámara', 'Ubicación', 'Grabación', 'Próx. manto.', 'Estado', null])
    // «Solo en uso» oculta CAM-003; al quitarlo aparece.
    expect(within(tabla).queryByText('CAM-003', { exact: false })).toBeNull()
    fireEvent.click(screen.getByLabelText('Solo en uso'))
    expect(within(container.querySelector('table')!).getByText(/CAM-003/)).toBeTruthy()
  })

  it('«Ver» abre el detalle; el mantenimiento vencido se marca', () => {
    render(<ControlCamarasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver cámara CAM-004' }))
    const detalle = screen.getByRole('dialog', { name: '📷 Piscina' })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(detalle).getByText('2025-01-01 · vencido')).toBeTruthy()
    expect(within(detalle).getByText('192.168.1.10')).toBeTruthy()
  })

  it('reportar falla y poner fuera de uso avisan si fallan', async () => {
    const onRefresh = vi.fn()
    render(<ControlCamarasTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver cámara CAM-001' }))
    const detalle = screen.getByRole('dialog')

    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'Permiso denegado' } })
    fireEvent.click(within(detalle).getByRole('button', { name: '⚠️ Reportar falla' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Permiso denegado' })))
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('control_camaras_seguridad', 'c1', { estado: 'falla' })
    expect(onRefresh).not.toHaveBeenCalled()

    fireEvent.click(within(detalle).getByRole('button', { name: 'Poner fuera de uso' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('control_camaras_seguridad', 'c1', { activo: false }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it('tocar la fila abre el detalle con las observaciones; sin editar no hay acciones', () => {
    const { container } = render(<ControlCamarasTab {...props({ canEdit: false, canCreate: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nueva cámara' })).toBeNull()
    fireEvent.click(within(container.querySelector('tbody')!).getByText('Sótano 1'))
    const detalle = screen.getByRole('dialog', { name: '📷 Parqueo' })
    expect(within(detalle).getByText('Lente empañado.')).toBeTruthy()
    expect(within(detalle).queryByRole('button', { name: '✏️ Editar' })).toBeNull()
    expect(within(detalle).queryByRole('button', { name: /Marcar activa|Reportar falla|fuera de uso/ })).toBeNull()
  })
})
