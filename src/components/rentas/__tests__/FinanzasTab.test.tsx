// Finanzas de Rentas: la vista de cartera, el mes de una propiedad (la hoja de
// Excel) y qué acciones se ofrecen según los permisos. El contenido del PDF se
// prueba aparte, sin jsPDF.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { ConceptoRenta, GastoRenta, LiquidacionRenta, PropiedadRenta, ReservaUnificada } from '../../../types'
import { liquidacionesPorReserva, resumenMes } from '../../../domain/rentas/finanzas'
import { contenidoEstadoMensual } from '../finanzas/estadoMensualPdf'

vi.mock('../../../domain/rentas/mutations', () => {
  const m = { isPending: false, mutateAsync: vi.fn() }
  return {
    useGastosRentaMutations: () => ({ crear: m, actualizar: m, eliminar: m }),
    useConceptosRentaMutations: () => ({ crear: m, actualizar: m }),
  }
})
vi.mock('../finanzas/ImportarReservasModal', () => ({ ImportarReservasModal: () => <div role="dialog">importador</div> }))
vi.mock('../../shared/Dialog', () => ({ notify: vi.fn(), confirm: vi.fn(async () => ({ isConfirmed: true })) }))

const { default: FinanzasTab } = await import('../tabs/FinanzasTab')

const con = (id: string, bloque: 'huesped' | 'anfitrion', nombre: string, signo: 1 | -1, orden: number): ConceptoRenta =>
  ({ id, company_id: 'c1', codigo: id, nombre, bloque, signo, comisionable: true, orden, activo: true, created_at: '', updated_at: '' })
const conceptos = [
  con('h1', 'huesped', 'Tarifa al huésped', 1, 10),
  con('a1', 'anfitrion', 'Tarifa de la habitación', 1, 10), con('a2', 'anfitrion', 'Descuentos aplicados', -1, 20),
]
const prop = (id: string, nombre: string, extra: Partial<PropiedadRenta> = {}) =>
  ({ id, company_id: 'c1', nombre, tipo_renta: 'corto_plazo', estado: 'activa', project_id: null, unidad_id: null, propietario_nombre: null, comision_pct: null, ...extra }) as PropiedadRenta
const propiedades = [prop('p1', 'Apto 1D SQ', { propietario_nombre: 'Doña Marta', comision_pct: 20 }), prop('p2', 'Casa Lago')]
const reservas: ReservaUnificada[] = [{
  id: 'r1', origen: 'rentas', propiedad_id: 'p1', huesped_nombre: 'Ana', huesped_email: null, huesped_telefono: null,
  fecha_entrada: '2026-02-02', fecha_salida: '2026-02-04', num_huespedes: 2, plataforma: 'airbnb', codigo_confirmacion: 'HM34',
  monto_noche: null, monto_total: 90, estado: 'completada', notas: null, politica_cancelacion: 'no_reembolsable', num_mascotas: 0,
}]
const lista: LiquidacionRenta[] = [{ id: 'l1', company_id: 'c1', propiedad_id: 'p1', reserva_id: 'r1', reserva_str_id: null, moneda: 'USD', importes: { h1: 110, a1: 100, a2: 10 }, created_at: '', updated_at: '' }]
const liquidaciones = liquidacionesPorReserva(lista)
const gastos: GastoRenta[] = [{ id: 'g1', company_id: 'c1', propiedad_id: 'p1', fecha: '2026-02-03', categoria: 'limpieza', descripcion: 'Limpieza de salida', proveedor: null, monto: 22, moneda: 'USD', a_cargo_de: 'propietario', notas: null, created_at: '', updated_at: '' }]
const todos = { ver: true, crear: true, editar: true, eliminar: true }
const soloVer = { ver: true, crear: false, editar: false, eliminar: false }

function montar(permisos = todos, permisosReservas = todos) {
  return render(
    <FinanzasTab propiedades={propiedades} reservas={reservas} contratos={[]} conceptos={conceptos} liquidaciones={liquidaciones}
      gastos={gastos} proyectos={[]} companyId="c1" hoy="2026-02-10" permisos={permisos} permisosReservas={permisosReservas} cargando={false} />,
  )
}
const fila = (texto: RegExp) => screen.getAllByRole('row').find(r => texto.test(r.textContent ?? '')) as HTMLElement
afterEach(cleanup)

describe('cartera', () => {
  it('una fila por propiedad con su mes y el camino al detalle', () => {
    montar()
    expect(screen.getByRole('heading', { name: 'Finanzas de la cartera' })).toBeTruthy()
    const f = fila(/Apto 1D SQ/)
    expect(f.textContent).toMatch(/7%/)        // 2 de 28 noches
    expect(f.textContent).toMatch(/90[.,]00/)  // acreditado: 100 − 10
    expect(f.textContent).toMatch(/18[.,]00/)  // comisión 20%
    expect(f.textContent).toMatch(/50[.,]00/)  // a pagar: 90 − 18 − 22
    expect(within(fila(/Casa Lago/)).getByText('sin %')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Descargar estado/ })).toBeNull()
  })

  it('cambiar de mes recalcula', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }))
    expect((screen.getByLabelText('Mes') as HTMLInputElement).value).toBe('2026-03')
    expect(fila(/Apto 1D SQ/).textContent).toMatch(/0%/)
  })
})

describe('el mes de una propiedad', () => {
  function abrir(permisos = todos, permisosReservas = todos) {
    montar(permisos, permisosReservas)
    fireEvent.click(screen.getByRole('button', { name: 'Ver el mes de Apto 1D SQ' }))
  }

  it('calendario día por día: los montos el día de entrada, la noche siguiente ocupada, el resto libre', () => {
    abrir()
    const cal = within(screen.getByRole('region', { name: 'Calendario del mes' }))
    expect(cal.getAllByRole('row')).toHaveLength(1 + 28 + 1)
    const dia2 = cal.getByRole('rowheader', { name: '2' }).closest('tr') as HTMLElement
    expect(dia2.textContent).toMatch(/HM34/)
    expect(dia2.textContent).toMatch(/No reembolsable/)
    expect(dia2.textContent).toMatch(/110[.,]00/)
    expect(dia2.textContent).toMatch(/90[.,]00/)
    const dia3 = cal.getByRole('rowheader', { name: '3' }).closest('tr') as HTMLElement
    expect(dia3.textContent).toMatch(/HM34/)
    expect(dia3.textContent).not.toMatch(/90[.,]00/)
    expect((cal.getByRole('rowheader', { name: '4' }).closest('tr') as HTMLElement).textContent).toMatch(/libre/)
    expect(cal.getByRole('rowheader', { name: '10 · hoy' })).toBeTruthy()
  })

  it('«todas las columnas» abre una columna por concepto, como la hoja', () => {
    abrir()
    const cal = within(screen.getByRole('region', { name: 'Calendario del mes' }))
    expect(cal.queryByRole('columnheader', { name: '− Descuentos aplicados' })).toBeNull()
    fireEvent.click(screen.getByLabelText('Ver todas las columnas del desglose'))
    expect(cal.getByRole('columnheader', { name: '− Descuentos aplicados' })).toBeTruthy()
    expect(cal.getByRole('columnheader', { name: 'Tarifa al huésped' })).toBeTruthy()
  })

  it('estado del propietario, ocupación y gastos del mes', () => {
    abrir()
    const estado = screen.getByRole('region', { name: 'Estado del propietario' })
    expect(estado.textContent).toMatch(/Comisión de administración \(20%\)/)
    expect(estado.textContent).toMatch(/A pagar al propietario.*50[.,]00/)
    expect(screen.getByRole('region', { name: 'Ocupación del mes' }).textContent).toMatch(/2 noches ocupadas/)
    expect(within(screen.getByRole('region', { name: 'Gastos del mes' })).getByText('Limpieza de salida')).toBeTruthy()
  })

  it('acciones según permisos: importar es de Reservas; conceptos y gastos, de Finanzas', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Importar reservas' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Configurar conceptos' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '+ Registrar gasto' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Descargar estado (PDF)' })).toBeTruthy()
    cleanup()
    abrir(soloVer, soloVer)
    expect(screen.queryByRole('button', { name: 'Importar reservas' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Configurar conceptos' })).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Registrar gasto' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Editar el gasto/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Descargar estado (PDF)' })).toBeTruthy()
  })

  it('configurar conceptos lista los dos bloques con sus controles', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Configurar conceptos' }))
    const dialogo = within(screen.getByRole('dialog'))
    expect(dialogo.getByRole('region', { name: 'Cobro al huésped' })).toBeTruthy()
    expect((dialogo.getByLabelText('Descuentos aplicados: suma o resta') as HTMLSelectElement).value).toBe('-1')
    expect(dialogo.getByLabelText('Nuevo concepto en Recibido por el anfitrión')).toBeTruthy()
  })
})

describe('contenido del PDF', () => {
  it('reservas del mes con sus columnas, gastos del propietario y la liquidación', () => {
    const resumen = resumenMes({ propiedad: propiedades[0], mes: '2026-02', reservas, contratos: [], gastos, conceptos, liquidaciones })
    const c = contenidoEstadoMensual({ propiedad: propiedades[0], resumen, reservas, liquidaciones, conceptos, gastos, moneda: 'USD' })
    expect(c.subtitulo).toBe('Apto 1D SQ · febrero de 2026')
    expect(c.cabecera).toContainEqual(['Propietario', 'Doña Marta'])
    expect(c.reservas.encabezado).toEqual(['Entrada', 'Noches', 'Reserva', 'Huésp.', 'Tarifa de la habitación', '− Descuentos aplicados', 'Total recibido'])
    expect(c.reservas.filas).toHaveLength(1)
    expect(c.reservas.filas[0].slice(1, 4)).toEqual(['2', 'HM34', '2'])
    expect(c.reservas.filas[0][6]).toMatch(/90[.,]00/)
    expect(c.gastos).toHaveLength(1)
    expect(c.liquidacion.map(l => l[0])).toEqual(['Acreditación del mes', expect.stringMatching(/Comisión de administración \(20% de /), '− Gastos a cargo del propietario'])
    expect(c.aPagar[1]).toMatch(/50[.,]00/)
    expect(c.archivo).toBe('estado_apto_1d_sq_2026-02.pdf')
  })
})

describe('moneda', () => {
  it('se ve una moneda a la vez y se avisa de las otras', () => {
    const { unmount } = render(
      <FinanzasTab propiedades={propiedades} reservas={reservas} contratos={[]} conceptos={conceptos} liquidaciones={liquidaciones}
        gastos={[...gastos, { ...gastos[0], id: 'g2', monto: 300, moneda: 'GTQ' }]} proyectos={[]} companyId="c1" hoy="2026-02-10"
        permisos={todos} permisosReservas={todos} cargando={false} />,
    )
    expect(screen.getByRole('status').textContent).toMatch(/también hay montos en GTQ/)
    expect(fila(/Apto 1D SQ/).textContent).toMatch(/USD 50[.,]00/)
    fireEvent.change(screen.getByLabelText('Moneda de los montos'), { target: { value: 'GTQ' } })
    expect(fila(/Apto 1D SQ/).textContent).toMatch(/GTQ -300[.,]00/)
    expect(screen.getByRole('status').textContent).toMatch(/también hay montos en USD/)
    unmount()
  })
})

describe('tendencia', () => {
  it('muestra el periodo mes a mes y lleva al detalle del mes elegido', () => {
    montar()
    fireEvent.click(screen.getByRole('radio', { name: 'Tendencia' }))
    expect((screen.getByLabelText('Periodo') as HTMLSelectElement).value).toBe('12')
    expect(screen.getByRole('region', { name: 'Acreditado por mes (USD)' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Ocupación por mes (%)' })).toBeTruthy()
    expect(screen.getAllByRole('row')).toHaveLength(1 + 12 + 1)
    expect(fila(/Febrero de 2026/).textContent).toMatch(/4% \(2\/56\).*USD 90[.,]00/)
    fireEvent.change(screen.getByLabelText('Periodo'), { target: { value: '6' } })
    expect(screen.getAllByRole('row')).toHaveLength(1 + 6 + 1)
    fireEvent.click(screen.getByRole('button', { name: 'Ver el detalle de enero de 2026' }))
    expect((screen.getByLabelText('Mes') as HTMLInputElement).value).toBe('2026-01')
    expect(screen.getByRole('heading', { name: 'Finanzas de la cartera' })).toBeTruthy()
  })
})
