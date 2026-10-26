// Suministros: la ficha se EDITA (antes sólo se creaba, se movía stock y se
// desactivaba) y declara un RENDIMIENTO —cuántos usos da una unidad— que el
// detalle traduce a usos disponibles y costo por uso.
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
    proveedor_id: null, costo_unitario: 6, rendimiento: 40, rendimiento_unidad: 'aplicaciones', notas: null,
    activo: true, created_at: '2026-10-01T00:00:00Z', ...over,
  }
}

function movimiento(over: Partial<MovimientoSuministro> = {}): MovimientoSuministro {
  return {
    id: 'm1', company_id: 'co1', suministro_id: 's1', tipo: 'salida', cantidad: 1, motivo: 'Limpieza',
    area_destino: null, realizado_por: null, fecha: restarDiasISO(hoy, 3), notas: null,
    created_at: '2026-10-20T00:00:00Z', ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof SuministrosTab>[0]> = {}) {
  return render(
    <SuministrosTab suministros={[alcohol()]} movimientos={[movimiento()]} proveedores={[]}
      proyectoId="p1" companyId="co1" moneda="Q" canCreate canEdit onRefresh={mocks.onRefresh} {...props} />,
  )
}

const abrirDetalle = () => fireEvent.click(screen.getByRole('button', { name: 'Alcohol Etílico al 70%' }))

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('SuministrosTab — rendimiento en el detalle', () => {
  it('traduce el stock a usos disponibles y el costo a costo por uso', () => {
    renderTab()
    abrirDetalle()
    expect(screen.getByText(/1 litro rinde 40 aplicaciones/)).toBeTruthy()
    expect(screen.getByText(/Q 0.15 por aplicaciones/)).toBeTruthy()
    expect(screen.getByText('Usos disponibles (aplicaciones)')).toBeTruthy()
    expect(screen.getByText('Costo por aplicaciones (Q)')).toBeTruthy()
    expect(screen.getByText('0.15')).toBeTruthy()
    // La lista también lo dice, al lado de la ubicación.
    expect(screen.getByText(/Bodega · ≈ 40 aplicaciones/)).toBeTruthy()
  })

  it('sin rendimiento declarado invita a editar la ficha y no inventa derivados', () => {
    renderTab({ suministros: [alcohol({ rendimiento: null, rendimiento_unidad: null })] })
    abrirDetalle()
    expect(screen.getByText(/Sin rendimiento declarado/)).toBeTruthy()
    expect(screen.queryByText(/Usos disponibles/)).toBeNull()
  })

  it('muestra el consumo observado en los últimos 30 días y la cobertura a ese ritmo', () => {
    renderTab({ suministros: [alcohol({ stock_actual: 3 })], movimientos: [
      movimiento(),
      movimiento({ id: 'm2', cantidad: 2, fecha: restarDiasISO(hoy, 10) }),
      movimiento({ id: 'm3', tipo: 'entrada', cantidad: 5, fecha: restarDiasISO(hoy, 1) }), // no es consumo
      movimiento({ id: 'm4', cantidad: 9, fecha: restarDiasISO(hoy, 45) }),              // fuera de la ventana
    ] })
    abrirDetalle()
    const linea = screen.getByText(/Salidas en los últimos 30 días/)
    expect(linea.textContent).toMatch(/3 litro/)
    expect(linea.textContent).toMatch(/2 movimientos/)
    expect(linea.textContent).toMatch(/≈ 0.1 litro por día/)
    expect(linea.textContent).toMatch(/alcanza ≈ 30 días/)
  })
})

describe('SuministrosTab — editar la ficha', () => {
  it('sin permiso de edición no hay botón Editar', () => {
    renderTab({ canEdit: false })
    abrirDetalle()
    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull()
  })

  it('Editar abre la ficha con sus valores; el stock no se edita (lo mueven los movimientos)', () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))

    expect(screen.getByText('Editar suministro')).toBeTruthy()
    expect((screen.getByLabelText('Nombre *') as HTMLInputElement).value).toBe('Alcohol Etílico al 70%')
    expect((screen.getByLabelText('Rendimiento por litro') as HTMLInputElement).value).toBe('40')
    expect((screen.getByLabelText('Se mide en') as HTMLInputElement).value).toBe('aplicaciones')
    expect((screen.getByLabelText('Costo unitario (Q)') as HTMLInputElement).value).toBe('6')
    const stock = screen.getByLabelText('Stock actual')
    expect(stock.tagName).not.toBe('INPUT')
    expect(stock.textContent).toMatch(/1 litro/)
    expect(stock.textContent).toMatch(/movimiento de ajuste/)
  })

  it('guardar cambios actualiza la fila sin tocar stock ni tenant y refresca', async () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))

    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Alcohol etílico 70 %' } })
    fireEvent.change(screen.getByLabelText('Stock mínimo'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Rendimiento por litro'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('Se mide en'), { target: { value: 'usos' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(tabla).toBe('suministros_condominio')
    expect(id).toBe('s1')
    expect(patch).toMatchObject({ nombre: 'Alcohol etílico 70 %', stock_minimo: 2, rendimiento: 50, rendimiento_unidad: 'usos', costo_unitario: 6 })
    expect(patch).not.toHaveProperty('stock_actual')
    expect(patch).not.toHaveProperty('company_id')
    expect(patch).not.toHaveProperty('project_id')
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(mocks.onRefresh).toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }))
    // Vuelve al detalle.
    expect(screen.queryByText('Editar suministro')).toBeNull()
  })

  it('borrar el rendimiento lo deja en null y limpia su unidad', async () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    fireEvent.change(screen.getByLabelText('Rendimiento por litro'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const patch = (mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2]
    expect(patch).toMatchObject({ rendimiento: null, rendimiento_unidad: null })
  })

  it('un rendimiento de 0 o negativo no se guarda', async () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    fireEvent.change(screen.getByLabelText('Rendimiento por litro'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })))
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
    expect(screen.getByText('Editar suministro')).toBeTruthy()
  })

  it('Cancelar vuelve al detalle sin guardar', () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Otro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
    expect(screen.getByText(/1 litro rinde 40 aplicaciones/)).toBeTruthy()
  })

  it('el detalle sigue a la fila recargada: tras refrescar muestra la ficha nueva, no la copia vieja', () => {
    const { rerender } = renderTab()
    abrirDetalle()
    rerender(
      <SuministrosTab suministros={[alcohol({ nombre: 'Alcohol etílico 70 %', rendimiento: 50, rendimiento_unidad: 'usos' })]}
        movimientos={[movimiento()]} proveedores={[]} proyectoId="p1" companyId="co1" moneda="Q" canCreate canEdit onRefresh={mocks.onRefresh} />,
    )
    const panel = screen.getByText(/1 litro rinde 50 usos/)
    expect(panel).toBeTruthy()
    expect(screen.queryByText(/rinde 40 aplicaciones/)).toBeNull()
  })
})

describe('SuministrosTab — nuevo suministro con rendimiento', () => {
  it('crea la fila con tenant, stock inicial y rendimiento', async () => {
    renderTab({ suministros: [] })
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo' }))
    expect(screen.getByText('Nuevo suministro')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Cloro' } })
    fireEvent.change(screen.getByLabelText('Stock actual'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Rendimiento por unidad'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('Se mide en'), { target: { value: 'limpiezas' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, fila] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('suministros_condominio')
    expect(fila).toMatchObject({
      company_id: 'co1', project_id: 'p1', nombre: 'Cloro', stock_actual: 5, stock_minimo: 0,
      rendimiento: 20, rendimiento_unidad: 'limpiezas',
    })
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('la unidad del rendimiento sin número no viaja', async () => {
    renderTab({ suministros: [] })
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo' }))
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Cloro' } })
    fireEvent.change(screen.getByLabelText('Se mide en'), { target: { value: 'limpiezas' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const fila = (mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]
    expect(fila).toMatchObject({ rendimiento: null, rendimiento_unidad: null })
  })
})

describe('carga masiva — columnas rendimiento', () => {
  it('acepta rendimiento > 0 con su unidad y rechaza 0, negativos y la unidad sola', async () => {
    const { makeValidateRow } = await import('../../ImportSuministrosModal')
    const validar = makeValidateRow([])
    const base = { nombre: 'Cloro', categoria: 'limpieza', unidad_medida: 'litro', stock_actual: 1, stock_minimo: 0 }

    const ok = validar({ ...base, rendimiento: '20', rendimiento_unidad: 'limpiezas' })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.data).toMatchObject({ rendimiento: 20, rendimiento_unidad: 'limpiezas' })

    const sinUnidad = validar({ ...base, rendimiento: '20' })
    expect(sinUnidad.ok).toBe(true)
    if (sinUnidad.ok) expect(sinUnidad.data).toMatchObject({ rendimiento: 20, rendimiento_unidad: undefined })

    const sinRend = validar(base)
    expect(sinRend.ok).toBe(true)
    if (sinRend.ok) expect(sinRend.data.rendimiento).toBeUndefined()

    for (const malo of ['0', '-2', 'abc']) {
      const r = validar({ ...base, rendimiento: malo })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.join(' ')).toMatch(/rendimiento debe ser un número > 0/)
    }
    const huerfana = validar({ ...base, rendimiento_unidad: 'usos' })
    expect(huerfana.ok).toBe(false)
    if (!huerfana.ok) expect(huerfana.errors.join(' ')).toMatch(/rendimiento_unidad necesita un rendimiento/)
  })
})

describe('SuministrosTab — lo que ya existía sigue igual', () => {
  it('registrar un movimiento inserta sólo el movimiento (el stock lo recalcula la BD)', async () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: '+ Movimiento' }))
    const form = screen.getByText('Registrar movimiento').parentElement as HTMLElement
    const inputs = within(form).getAllByRole('spinbutton')
    fireEvent.change(inputs[0], { target: { value: '0.5' } })
    fireEvent.click(screen.getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('movimientos_suministro', expect.objectContaining({ suministro_id: 's1', tipo: 'salida', cantidad: 0.5 })))
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })
})
