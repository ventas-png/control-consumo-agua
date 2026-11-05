// Suministros: la ficha del insumo abre en ventana emergente (EditModal real,
// pantalla completa en el teléfono) al pulsar su tarjeta en la lista. Antes
// vivía en un panel fijo al lado de la lista, que en el teléfono se repartían
// 300px + lo que sobrara. Los formularios y la foto se apilan encima de la
// ficha y Escape cierra sólo la de arriba.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { MovimientoSuministro, SuministroCondominio } from '../../../../types'
import { hoyLocalISO } from '../../../../lib/format'
import { restarDiasISO } from '../../../../lib/suministros'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  notify: vi.fn(),
  onRefresh: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) }, warmUpSupabase: vi.fn() }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: vi.fn(), notify: mocks.notify }))
vi.mock('../../../../domain/cxp/queries', () => ({ useProveedoresQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/proveedores/queries', () => ({
  useOperacionesLegadoQuery: () => ({ data: [], isLoading: false }),
  useAsignacionesQuery: () => ({ data: [], isLoading: false }),
}))
vi.mock('../../../../domain/proveedores/mutations', () => ({
  useVincularOperacionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const SuministrosTab = (await import('../SuministrosTab')).default

const hoy = hoyLocalISO()

function alcohol(over: Partial<SuministroCondominio> = {}): SuministroCondominio {
  return {
    id: 's1', company_id: 'co1', project_id: 'p1', nombre: 'Alcohol Etílico al 70%', categoria: 'limpieza',
    unidad_medida: 'litro', stock_actual: 1, stock_minimo: 1, ubicacion: 'Bodega', proveedor: 'Pricesmart',
    proveedor_id: null, costo_unitario: 6, rendimiento: 10, rendimiento_unidad: 'usos', notas: null,
    activo: true, created_at: '2026-10-01T00:00:00Z', ...over,
  }
}
const ESCOBA = alcohol({ id: 's2', nombre: 'Escoba', unidad_medida: 'unidad', stock_actual: 5, stock_minimo: 2, ubicacion: 'Oficinas', proveedor: null, rendimiento: null, rendimiento_unidad: null })

function movimiento(over: Partial<MovimientoSuministro> = {}): MovimientoSuministro {
  return {
    id: 'm1', company_id: 'co1', suministro_id: 's1', tipo: 'salida', cantidad: 1, motivo: 'Barrido de piso',
    area_destino: 'Pasillo', realizado_por: null, fecha: restarDiasISO(hoy, 3), notas: null,
    created_at: '2026-10-20T00:00:00Z', ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof SuministrosTab>[0]> = {}) {
  return render(
    <SuministrosTab suministros={[alcohol(), ESCOBA]} movimientos={[movimiento()]} proveedores={[]}
      proyectoId="p1" companyId="co1" moneda="Q" canCreate canEdit onRefresh={mocks.onRefresh} {...props} />,
  )
}

const abrirDetalle = (nombre = 'Alcohol Etílico al 70%') => fireEvent.click(screen.getByRole('button', { name: nombre }))
const ficha = () => screen.getByRole('dialog', { name: /Alcohol Etílico al 70%/ })

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('SuministrosTab — la ficha abre en ventana', () => {
  it('sin pulsar nada no hay ventana ni ficha: sólo la lista', () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/Stock actual \(/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Alcohol Etílico al 70%' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Escoba' })).toBeTruthy()
  })

  it('pulsar la tarjeta abre la ficha en ventana a pantalla completa en el teléfono, con KPIs, consumo y movimientos', () => {
    renderTab()
    abrirDetalle()
    const ventana = ficha()
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(ventana).getByText('🧹 Alcohol Etílico al 70%')).toBeTruthy()
    expect(within(ventana).getByText(/📍 Bodega/)).toBeTruthy()
    expect(within(ventana).getByText(/Proveedor: Pricesmart/)).toBeTruthy()
    expect(within(ventana).getByText('Stock actual (litro)')).toBeTruthy()
    expect(within(ventana).getByText('Usos disponibles (usos)')).toBeTruthy()
    expect(within(ventana).getByText(/Stock bajo mínimo/)).toBeTruthy()
    expect(within(ventana).getByText(/Salidas en los últimos 30 días/)).toBeTruthy()
    expect(within(ventana).getByText('Barrido de piso')).toBeTruthy()
    // Las acciones de la ficha viven en el pie de la ventana.
    expect(within(ventana).getByRole('button', { name: '✏️ Editar' })).toBeTruthy()
    expect(within(ventana).getByRole('button', { name: '+ Movimiento' })).toBeTruthy()
    expect(within(ventana).getByRole('button', { name: 'Desactivar' })).toBeTruthy()
    expect(within(ventana).getByRole('button', { name: 'Cerrar' })).toBeTruthy()
  })

  it('Cerrar y Escape cierran la ficha; pulsar otra tarjeta abre la suya', () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(within(ficha()).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    abrirDetalle()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    abrirDetalle('Escoba')
    const ventana = screen.getByRole('dialog', { name: /Escoba/ })
    expect(within(ventana).getByText('Stock actual (unidad)')).toBeTruthy()
    expect(within(ventana).queryByText(/Stock bajo mínimo/)).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('el formulario se apila encima de la ficha y Escape cierra sólo el de arriba', () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(within(ficha()).getByRole('button', { name: '✏️ Editar' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    expect(screen.getByRole('dialog', { name: 'Editar suministro' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Editar suministro' })).toBeNull()
    expect(ficha()).toBeTruthy()

    fireEvent.click(within(ficha()).getByRole('button', { name: '+ Movimiento' }))
    expect(screen.getByRole('dialog', { name: 'Registrar movimiento' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Registrar movimiento' })).toBeNull()
    expect(ficha()).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Desactivar desde el pie cambia «activo» y refresca; sin permiso sólo queda Cerrar', async () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(within(ficha()).getByRole('button', { name: 'Desactivar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('suministros_condominio', 's1', { activo: false }))
    expect(mocks.onRefresh).toHaveBeenCalled()
    cleanup()

    renderTab({ canEdit: false })
    abrirDetalle()
    const pie = ficha().querySelector('.at-modal-footer') as HTMLElement
    expect(within(pie).getByRole('button', { name: 'Cerrar' })).toBeTruthy()
    expect(within(pie).queryByRole('button', { name: /Editar|Movimiento|Desactivar/ })).toBeNull()
  })

  it('la ficha sigue a la fila recargada y se cierra sola si el insumo desaparece', () => {
    const { rerender } = renderTab()
    abrirDetalle()
    rerender(
      <SuministrosTab suministros={[alcohol({ nombre: 'Alcohol etílico 70 %', activo: false }), ESCOBA]} movimientos={[movimiento()]} proveedores={[]}
        proyectoId="p1" companyId="co1" moneda="Q" canCreate canEdit onRefresh={mocks.onRefresh} />,
    )
    const ventana = screen.getByRole('dialog', { name: /Alcohol etílico 70 %/ })
    expect(within(ventana).getByRole('button', { name: 'Activar' })).toBeTruthy()
    expect(within(ventana).getByText('Inactivo')).toBeTruthy()

    rerender(
      <SuministrosTab suministros={[ESCOBA]} movimientos={[]} proveedores={[]}
        proyectoId="p1" companyId="co1" moneda="Q" canCreate canEdit onRefresh={mocks.onRefresh} />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
