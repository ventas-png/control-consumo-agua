// Servicio Energético en el teléfono: las tablas se leen como tarjetas (rótulo
// por celda, acciones al pie), los formularios son la EditModal compartida a
// pantalla completa y no se cierran a mitad del guardado, y cada factura abre
// su detalle en ventana con las mismas acciones y permisos que la fila.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { FacturaEnergia, FuenteEnergia, ProveedorEnergia, Proyecto, TarifaEnergia } from '../../../types'

const h = vi.hoisted(() => ({
  actualizarProveedor: vi.fn(),
  actualizarFactura: vi.fn(),
  crearFactura: vi.fn(),
  eliminarFactura: vi.fn(),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
}))

// Cada hook de mutación expone `isPending` real mientras corre `mutateAsync`.
vi.mock('../../../domain/energia/mutations', async () => {
  const { useState } = await import('react')
  const hook = (fn: (...a: unknown[]) => unknown) => () => {
    const [isPending, setPending] = useState(false)
    return {
      isPending,
      mutateAsync: async (...a: unknown[]) => {
        setPending(true)
        try { return await fn(...a) } finally { setPending(false) }
      },
    }
  }
  const nada = hook(async () => undefined)
  return {
    useCrearProveedorEnergiaMutation: nada,
    useActualizarProveedorEnergiaMutation: hook((...a) => h.actualizarProveedor(...a)),
    useEliminarProveedorEnergiaMutation: nada,
    useCrearTarifaEnergiaMutation: nada,
    useActualizarTarifaEnergiaMutation: nada,
    useEliminarTarifaEnergiaMutation: nada,
    useCrearFuenteEnergiaMutation: nada,
    useActualizarFuenteEnergiaMutation: nada,
    useEliminarFuenteEnergiaMutation: nada,
    useCrearFacturaEnergiaMutation: hook((...a) => h.crearFactura(...a)),
    useActualizarFacturaEnergiaMutation: hook((...a) => h.actualizarFactura(...a)),
    useEliminarFacturaEnergiaMutation: hook((...a) => h.eliminarFactura(...a)),
  }
})
vi.mock('../../shared/Dialog', () => ({ notify: h.notify, confirm: h.confirm }))

const { default: ProveedoresTab } = await import('../tabs/ProveedoresTab')
const { default: TarifasTab } = await import('../tabs/TarifasTab')
const { default: FuentesTab } = await import('../tabs/FuentesTab')
const { default: FacturasTab } = await import('../tabs/FacturasTab')
const { default: DashboardTab } = await import('../tabs/DashboardTab')

const proyectos = [{ id: 'p1', nombre: 'Proyecto Norte' }] as Proyecto[]
const proveedores = [
  { id: 'pr1', nombre: 'EEGSA', nit: '1234567-8', contacto: '2290-1234', tipo: 'distribuidora', activo: true },
] as unknown as ProveedorEnergia[]
const tarifas = [
  { id: 't1', nombre: 'BT1', proveedor_id: 'pr1', precio_kwh_energia: 1.2, precio_kw_potencia: 0, cargo_fijo: 12.5, alumbrado_publico: 0, alumbrado_tipo: 'fijo', iva_porcentaje: 12, precio_kwh_exportado: 0, moneda: 'Q', activa: true },
] as unknown as TarifaEnergia[]
const fuentes = [
  { id: 'f1', nombre: 'Bomba pozo norte', fuente_agua_id: null, modo_suministro: 'red', tarifa_id: 't1', numero_medidor: 'M-1', potencia_contratada_kw: 25, project_id: 'p1', activo: true },
  { id: 'f2', nombre: 'Paneles casa club', fuente_agua_id: null, modo_suministro: 'hibrido', potencia_contratada_kw: 10, capacidad_solar_kwp: 12.5, project_id: 'p1', activo: true },
] as unknown as FuenteEnergia[]
const facturas = [
  {
    id: 'fe1', fuente_energia_id: 'f1', numero_factura: 'FAC-001', periodo_inicio: '2026-08-01', periodo_fin: '2026-08-31',
    kwh_consumidos: 100, kwh_generados: 0, kwh_exportados: 0, kw_demanda_max: 5,
    monto_energia: 120, monto_potencia: 0, monto_cargo_fijo: 12.5, monto_alumbrado: 0, monto_iva: 15.9,
    monto_credito_exportacion: 0, monto_otros: 0, monto_total: 148.4, moneda: 'Q', estado: 'pendiente', notas: 'Pagar en agencia',
  },
] as unknown as FacturaEnergia[]

const todos = { canCreate: true, canEdit: true, canDelete: true }
const ninguno = { canCreate: false, canEdit: false, canDelete: false }

function facturasTab(perms = todos) {
  return render(
    <FacturasTab
      facturasEnergia={facturas}
      fuentesEnergia={fuentes}
      tarifasEnergia={tarifas}
      proveedoresEnergia={proveedores}
      proyectos={proyectos}
      companyId="c1"
      moneda="Q"
      {...perms}
    />,
  )
}

/** Toda celda de datos lleva su rótulo; la de acciones (sin rótulo) va al pie de la tarjeta. */
function expectTarjetas(table: HTMLElement, rotulos: string[], conAcciones: boolean) {
  expect(table.classList.contains('table-cards-on-mobile')).toBe(true)
  expect(table.style.minWidth).toBe('')
  const celdas = [...within(table).getAllByRole('row')[1].querySelectorAll('td')]
  expect(celdas.map(td => td.getAttribute('data-label'))).toEqual(conAcciones ? [...rotulos, null] : rotulos)
}

function esperar() {
  let resolver!: () => void
  let rechazar!: (e: Error) => void
  const promesa = new Promise<void>((res, rej) => { resolver = res; rechazar = rej })
  return { promesa, resolver, rechazar }
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('Servicio Energético — tablas como tarjetas', () => {
  it('proveedores, tarifas y fuentes rotulan cada celda y llevan las acciones al pie', () => {
    render(<ProveedoresTab proveedoresEnergia={proveedores} proyectos={proyectos} companyId="c1" {...todos} />)
    expectTarjetas(screen.getByRole('table'), ['Nombre', 'NIT', 'Tipo', 'Contacto', 'Estado'], true)
    cleanup()

    render(<TarifasTab tarifasEnergia={tarifas} proveedoresEnergia={proveedores} proyectos={proyectos} companyId="c1" moneda="Q" {...todos} />)
    expectTarjetas(screen.getByRole('table'), ['Nombre', 'Proveedor', 'Precio kWh', 'Cargo fijo', 'IVA%', 'Estado'], true)
    cleanup()

    render(<FuentesTab fuentesEnergia={fuentes} fuentesAgua={[]} proveedoresEnergia={proveedores} tarifasEnergia={tarifas} proyectos={proyectos} companyId="c1" {...todos} />)
    const tabla = screen.getByRole('table')
    expectTarjetas(tabla, ['Nombre', 'Fuente de agua', 'Modo', 'Medidor', 'Capacidad', 'Estado'], true)
    // Un híbrido con red y paneles muestra las dos capacidades separadas.
    expect(within(tabla).getByText('10 kW · 12.5 kWp')).toBeTruthy()
  })

  it('sin permisos de editar ni eliminar no hay columna de acciones', () => {
    render(<ProveedoresTab proveedoresEnergia={proveedores} proyectos={proyectos} companyId="c1" {...ninguno} />)
    expectTarjetas(screen.getByRole('table'), ['Nombre', 'NIT', 'Tipo', 'Contacto', 'Estado'], false)
    expect(screen.queryByRole('button', { name: /Editar|Eliminar|Nuevo/ })).toBeNull()
  })

  it('el dashboard rotula cada celda y el total queda como título de su tarjeta', () => {
    render(<DashboardTab facturasEnergia={facturas} fuentesEnergia={fuentes} moneda="Q" />)
    const tabla = screen.getByRole('table')
    expectTarjetas(tabla, ['Fuente', 'kWh Consumidos', 'kWh Generados', 'kWh Exportados', 'kWh Netos', 'Costo Total', 'Facturas'], false)
    const total = within(tabla).getByText('TOTAL')
    expect(total.tagName).toBe('TD')
    expect(total.hasAttribute('data-label')).toBe(false)
  })
})

describe('Servicio Energético — formularios en ventana', () => {
  it('editar un proveedor abre a pantalla completa y no se cierra mientras guarda', async () => {
    const guardado = esperar()
    h.actualizarProveedor.mockReturnValue(guardado.promesa)
    render(<ProveedoresTab proveedoresEnergia={proveedores} proyectos={proyectos} companyId="c1" {...todos} />)

    fireEvent.click(screen.getByRole('button', { name: 'Editar EEGSA' }))
    const ventana = screen.getByRole('dialog', { name: 'Editar Proveedor' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect((screen.getByLabelText('NIT') as HTMLInputElement).value).toBe(String('1234567-8'))

    fireEvent.change(screen.getByLabelText('Contacto'), { target: { value: '5555-0000' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect((within(ventana).getByRole('button', { name: /Guardando/ }) as HTMLButtonElement).disabled).toBe(true))
    expect(h.actualizarProveedor).toHaveBeenCalledWith({ id: 'pr1', patch: expect.objectContaining({ contacto: '5555-0000' }) })

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: 'Editar Proveedor' })).toBeTruthy()

    guardado.resolver()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Proveedor actualizado' }))
  })

  it('las ventanas de tarifa y fuente también van a pantalla completa en el teléfono', () => {
    render(<TarifasTab tarifasEnergia={tarifas} proveedoresEnergia={proveedores} proyectos={proyectos} companyId="c1" moneda="Q" {...todos} />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar BT1' }))
    expect(screen.getByRole('dialog', { name: 'Editar Tarifa' }).classList.contains('at-modal--fs-mobile')).toBe(true)
    expect((screen.getByLabelText('IVA (%)') as HTMLInputElement).value).toBe(String(12))
    cleanup()

    render(<FuentesTab fuentesEnergia={fuentes} fuentesAgua={[]} proveedoresEnergia={proveedores} tarifasEnergia={tarifas} proyectos={proyectos} companyId="c1" {...todos} />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar Bomba pozo norte' }))
    expect(screen.getByRole('dialog', { name: 'Editar Fuente de Energía' }).classList.contains('at-modal--fs-mobile')).toBe(true)
    expect((screen.getByLabelText('Número de medidor') as HTMLInputElement).value).toBe(String('M-1'))
  })
})

describe('Servicio Energético — facturas', () => {
  it('tocar una factura abre su detalle con el desglose; Editar abre el formulario encima', () => {
    facturasTab()
    const tabla = screen.getByRole('table')
    expectTarjetas(tabla, ['Fuente', 'Período', 'kWh Consumidos', 'kWh Exportados', 'Total', 'Estado'], true)

    fireEvent.click(within(tabla).getByText('Bomba pozo norte'))
    const detalle = screen.getByRole('dialog', { name: '📄 Bomba pozo norte' })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(detalle).getByText('FAC-001')).toBeTruthy()
    expect(within(detalle).getByText('Q 120.00')).toBeTruthy()
    expect(within(detalle).getByText('Pagar en agencia')).toBeTruthy()

    fireEvent.click(within(detalle).getByRole('button', { name: 'Editar' }))
    const formulario = screen.getByRole('dialog', { name: '📝 Editar Factura' })
    expect(formulario.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect((screen.getByLabelText(/Período fin/) as HTMLInputElement).value).toBe(String('2026-08-31'))

    // Escape cierra solo la ventana de arriba.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '📝 Editar Factura' })).toBeNull()
    expect(screen.getByRole('dialog', { name: '📄 Bomba pozo norte' })).toBeTruthy()
  })

  it('el botón Ver abre el detalle con teclado; sin permisos no ofrece editar ni eliminar', () => {
    facturasTab(ninguno)
    expect(screen.queryByRole('button', { name: /^(Editar|Eliminar)/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Nueva Factura' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Ver factura de Bomba pozo norte/ }))
    const detalle = screen.getByRole('dialog', { name: '📄 Bomba pozo norte' })
    expect(within(detalle).queryByRole('button', { name: /Editar|Eliminar/ })).toBeNull()
    fireEvent.click(within(detalle).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('eliminar desde el detalle pide confirmación y cierra la ventana', async () => {
    h.eliminarFactura.mockResolvedValue(undefined)
    facturasTab()
    fireEvent.click(screen.getByRole('button', { name: /^Ver factura de Bomba pozo norte/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(h.eliminarFactura).toHaveBeenCalledWith('fe1'))
    expect(h.confirm).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('si guardar falla, la ventana sigue abierta con lo escrito; no se cierra mientras guarda', async () => {
    const intento = esperar()
    h.actualizarFactura.mockReturnValueOnce(intento.promesa)
    facturasTab()
    fireEvent.click(screen.getByRole('button', { name: /^Editar factura de Bomba pozo norte/ }))
    const formulario = screen.getByRole('dialog', { name: '📝 Editar Factura' })
    fireEvent.change(screen.getByLabelText('Número de factura'), { target: { value: 'FAC-002' } })
    fireEvent.click(within(formulario).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect((within(formulario).getByRole('button', { name: /Guardando/ }) as HTMLButtonElement).disabled).toBe(true))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(formulario).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: '📝 Editar Factura' })).toBeTruthy()

    intento.rechazar(new Error('Sin conexión'))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect(screen.getByRole('dialog', { name: '📝 Editar Factura' })).toBeTruthy()
    expect((screen.getByLabelText('Número de factura') as HTMLInputElement).value).toBe(String('FAC-002'))
    expect(h.notify).toHaveBeenCalledTimes(1)

    // El segundo intento guarda y cierra.
    h.actualizarFactura.mockResolvedValueOnce(undefined)
    fireEvent.click(within(screen.getByRole('dialog', { name: '📝 Editar Factura' })).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '📝 Editar Factura' })).toBeNull())
    expect(h.actualizarFactura).toHaveBeenLastCalledWith({ id: 'fe1', patch: expect.objectContaining({ numero_factura: 'FAC-002' }) })
    expect(h.notify).toHaveBeenLastCalledWith(expect.objectContaining({ variant: 'success', title: 'Factura actualizada' }))
  })
})
