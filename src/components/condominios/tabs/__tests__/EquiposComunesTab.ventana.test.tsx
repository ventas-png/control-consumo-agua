// Equipos: el alta y la edición de la ficha abren en ventana emergente (antes
// el alta ocupaba el panel de la ficha y la ficha no se podía editar: sólo
// cambiar de estado o registrar mantenimiento, que siguen igual).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { EquipoComun } from '../../../../types'
import { hoyLocalISO } from '../../../../lib/format'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async () => ({ error: null as { message: string } | null })),
  openPromptDialog: vi.fn(async (): Promise<Record<string, string> | null> => null),
  notify: vi.fn(),
  onRefresh: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) }, warmUpSupabase: vi.fn() }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: vi.fn(), notify: mocks.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))

const EquiposComunesTab = (await import('../EquiposComunesTab')).default

function bomba(over: Partial<EquipoComun> = {}): EquipoComun {
  return {
    id: 'e1', company_id: 'co1', project_id: 'p1', nombre: 'Bomba principal', categoria: 'bomba',
    marca: 'Pedrollo', modelo: 'CP 200', serial: 'SN-001', ubicacion: 'Cuarto de máquinas',
    fecha_compra: '2025-01-15', valor_compra: 12000, vida_util_anios: 10, estado: 'operativo',
    ultimo_mantenimiento: null, proximo_mantenimiento: null, notas: null, created_at: '2026-10-01T00:00:00Z', ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof EquiposComunesTab>[0]> = {}) {
  return render(
    <EquiposComunesTab equipos={[bomba()]} proyectoId="p1" companyId="co1" moneda="Q" canCreate canEdit onRefresh={mocks.onRefresh} {...props} />,
  )
}

const abrirDetalle = () => fireEvent.click(screen.getByRole('button', { name: 'Bomba principal' }))
const ventana = (nombre: string) => screen.getByRole('dialog', { name: nombre })
type Patch = [string, string, Record<string, unknown>]
type Alta = [string, Record<string, unknown>]

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.createCondominioRow.mockImplementation(async () => ({ error: null }))
  mocks.updateCondominioRow.mockImplementation(async () => ({ error: null }))
  mocks.openPromptDialog.mockImplementation(async () => null)
})
afterEach(cleanup)

describe('EquiposComunesTab — nuevo equipo en ventana emergente', () => {
  it('+ Nuevo abre un diálogo, guarda con tenant y lo cierra', async () => {
    renderTab({ equipos: [] })
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo' }))
    const v = ventana('Nuevo equipo')
    fireEvent.change(within(v).getByLabelText('Nombre *'), { target: { value: 'Generador diésel' } })
    fireEvent.change(within(v).getByLabelText('Categoría'), { target: { value: 'generador' } })
    fireEvent.change(within(v).getByLabelText('Valor compra (Q)'), { target: { value: '45000' } })
    fireEvent.change(within(v).getByLabelText('Vida útil (años)'), { target: { value: '15' } })
    fireEvent.click(within(v).getByRole('button', { name: /Guardar equipo/ }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, fila] = mocks.createCondominioRow.mock.calls[0] as unknown as Alta
    expect(tabla).toBe('equipos_comunes')
    expect(fila).toMatchObject({
      company_id: 'co1', project_id: 'p1', nombre: 'Generador diésel', categoria: 'generador',
      valor_compra: 45000, vida_util_anios: 15, estado: 'operativo', marca: null, serial: null,
    })
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
    expect(mocks.onRefresh).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('sin nombre avisa y la ventana sigue abierta', async () => {
    renderTab({ equipos: [] })
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo' }))
    fireEvent.click(within(ventana('Nuevo equipo')).getByRole('button', { name: /Guardar equipo/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(ventana('Nuevo equipo')).toBeTruthy()
  })

  it('+ Nuevo no pierde el equipo seleccionado: la ficha sigue detrás y al cancelar', () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo' }))
    const v = ventana('Nuevo equipo')
    expect((within(v).getByLabelText('Nombre *') as HTMLInputElement).value).toBe('')
    expect(screen.getByText('SN-001')).toBeTruthy()
    fireEvent.click(within(v).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('SN-001')).toBeTruthy()
  })

  it('sin permiso de alta no hay botón + Nuevo', () => {
    renderTab({ canCreate: false })
    expect(screen.queryByRole('button', { name: '+ Nuevo' })).toBeNull()
  })
})

describe('EquiposComunesTab — editar la ficha en ventana emergente', () => {
  it('sin permiso de edición no hay botón Editar', () => {
    renderTab({ canEdit: false })
    abrirDetalle()
    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull()
  })

  it('Editar abre la ficha con sus valores y el nombre de subtítulo', () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    const v = ventana('Editar equipo')
    expect(within(v).getByText('Bomba principal')).toBeTruthy()
    expect((within(v).getByLabelText('Nombre *') as HTMLInputElement).value).toBe('Bomba principal')
    expect((within(v).getByLabelText('Categoría') as HTMLSelectElement).value).toBe('bomba')
    expect((within(v).getByLabelText('Marca') as HTMLInputElement).value).toBe('Pedrollo')
    expect((within(v).getByLabelText('Serial') as HTMLInputElement).value).toBe('SN-001')
    expect((within(v).getByLabelText('Fecha de compra') as HTMLInputElement).value).toBe('2025-01-15')
    expect((within(v).getByLabelText('Valor compra (Q)') as HTMLInputElement).value).toBe('12000')
    expect((within(v).getByLabelText('Vida útil (años)') as HTMLInputElement).value).toBe('10')
    expect((within(v).getByLabelText('Estado') as HTMLSelectElement).value).toBe('operativo')
    expect((within(v).getByLabelText('Próximo mantenimiento') as HTMLInputElement).value).toBe('')
  })

  it('guardar cambios actualiza la fila sin tocar el tenant, avisa y refresca', async () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    const v = ventana('Editar equipo')
    fireEvent.change(within(v).getByLabelText('Nombre *'), { target: { value: 'Bomba principal (reemplazo)' } })
    fireEvent.change(within(v).getByLabelText('Serial'), { target: { value: 'SN-002' } })
    fireEvent.change(within(v).getByLabelText('Marca'), { target: { value: '' } })
    fireEvent.change(within(v).getByLabelText('Próximo mantenimiento'), { target: { value: '2026-12-01' } })
    fireEvent.click(within(v).getByRole('button', { name: /Guardar cambios/ }))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as Patch
    expect(tabla).toBe('equipos_comunes')
    expect(id).toBe('e1')
    expect(patch).toMatchObject({ nombre: 'Bomba principal (reemplazo)', serial: 'SN-002', marca: null, proximo_mantenimiento: '2026-12-01', valor_compra: 12000 })
    expect(patch).not.toHaveProperty('company_id')
    expect(patch).not.toHaveProperty('project_id')
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Equipo actualizado' }))
    expect(mocks.onRefresh).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('si la fila no se actualiza, avisa y la ventana sigue abierta', async () => {
    mocks.updateCondominioRow.mockImplementation(async () => ({ error: { message: 'sin permiso' } }))
    renderTab()
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    fireEvent.click(within(ventana('Editar equipo')).getByRole('button', { name: /Guardar cambios/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' })))
    expect(ventana('Editar equipo')).toBeTruthy()
    expect(mocks.onRefresh).not.toHaveBeenCalled()
  })

  it('Cancelar y Escape cierran sin guardar; la ficha sigue a la vista', () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    fireEvent.change(within(ventana('Editar equipo')).getByLabelText('Nombre *'), { target: { value: 'Otro' } })
    fireEvent.click(within(ventana('Editar equipo')).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('SN-001')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    // Cancelar descartó lo tecleado: la ventana reabre con la ficha, no con «Otro».
    expect((within(ventana('Editar equipo')).getByLabelText('Nombre *') as HTMLInputElement).value).toBe('Bomba principal')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('el detalle sigue a la fila recargada tras refrescar', () => {
    const { rerender } = renderTab()
    abrirDetalle()
    rerender(<EquiposComunesTab equipos={[bomba({ serial: 'SN-002', estado: 'mantenimiento' })]} proyectoId="p1" companyId="co1" moneda="Q" canCreate canEdit onRefresh={mocks.onRefresh} />)
    expect(screen.getByText('SN-002')).toBeTruthy()
    expect(screen.queryByText('SN-001')).toBeNull()
  })
})

describe('EquiposComunesTab — lo que ya existía sigue igual', () => {
  it('cambiar el estado actualiza sólo ese campo', async () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: '→ Fuera de servicio' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('equipos_comunes', 'e1', { estado: 'fuera_servicio' }))
    expect(mocks.onRefresh).toHaveBeenCalled()
  })

  it('registrar mantenimiento pide la próxima fecha en su ventana y deja el equipo operativo', async () => {
    mocks.openPromptDialog.mockImplementation(async () => ({ proxima: '2027-01-10' }))
    renderTab({ equipos: [bomba({ estado: 'mantenimiento' })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Registrar mantenimiento/ }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('equipos_comunes', 'e1', {
      ultimo_mantenimiento: hoyLocalISO(), proximo_mantenimiento: '2027-01-10', estado: 'operativo',
    }))
    expect(mocks.openPromptDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Registrar mantenimiento' }))
  })

  it('cancelar la ventana de mantenimiento no toca la fila', async () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Registrar mantenimiento/ }))
    await waitFor(() => expect(mocks.openPromptDialog).toHaveBeenCalledTimes(1))
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })
})
