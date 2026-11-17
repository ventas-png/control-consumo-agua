// Reservas de Manejo de Rentas: una sola lista para las reservas de propiedades
// independientes y las de propiedades enlazadas a un condominio (reservas_str).
// Lo que se fija: qué se ofrece para cada origen, el aviso de solape y que el
// formulario entrega a la mutación la PROPIEDAD (de la que sale la tabla destino).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ConceptoRenta, LiquidacionRenta, PropiedadRenta, Proyecto, ReservaUnificada } from '../../../types'

const h = vi.hoisted(() => ({
  crear: vi.fn(async (_vars: unknown) => undefined),
  actualizar: vi.fn(async () => undefined),
  eliminar: vi.fn(async () => undefined),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
}))

vi.mock('../../../domain/rentas/mutations', () => ({
  useReservasRentaMutations: () => ({
    crear: { isPending: false, mutateAsync: h.crear },
    actualizar: { isPending: false, mutateAsync: h.actualizar },
    eliminar: { isPending: false, mutateAsync: h.eliminar },
  }),
}))
vi.mock('../finanzas/ImportarReservasModal', () => ({ ImportarReservasModal: () => null }))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify, confirm: h.confirm }))

const { default: ReservasTab } = await import('../tabs/ReservasTab')

const base = {
  company_id: 'c1', codigo: null, tipo_detalle: null, estado: 'activa', direccion: null, ciudad: null,
  propietario_nombre: null, propietario_telefono: null, propietario_email: null, habitaciones: null, banos: null,
  capacidad: null, area_m2: null, tarifa_base: null, comision_pct: null, notas: null, created_at: '', updated_at: '',
}
const propiedades = [
  { ...base, id: 'ind', nombre: 'Casa Lago', tipo_renta: 'corto_plazo', project_id: null, unidad_id: null },
  { ...base, id: 'enl', nombre: 'Apto 2A', tipo_renta: 'corto_plazo', project_id: 'p1', unidad_id: 'u1' },
  { ...base, id: 'lp', nombre: 'Apto Zona 10', tipo_renta: 'largo_plazo', project_id: null, unidad_id: null },
] as PropiedadRenta[]
const proyectos = [{ id: 'p1', nombre: '21B+' }] as Proyecto[]
const r = (id: string, origen: 'rentas' | 'condominio', propiedad_id: string, huesped: string, entrada: string, salida: string): ReservaUnificada => ({
  id, origen, propiedad_id, huesped_nombre: huesped, huesped_email: null, huesped_telefono: null,
  fecha_entrada: entrada, fecha_salida: salida, num_huespedes: 2, plataforma: 'directo', codigo_confirmacion: null,
  monto_noche: null, monto_total: null, estado: 'confirmada', notas: null, politica_cancelacion: null, num_mascotas: 0,
})
const reservas = [
  r('r1', 'rentas', 'ind', 'Ana Pérez', '2026-12-10', '2026-12-13'),
  r('s1', 'condominio', 'enl', 'Paola González', '2026-12-20', '2026-12-27'),
]
const todos = { ver: true, crear: true, editar: true, eliminar: true }
const con = (id: string, bloque: 'huesped' | 'anfitrion', nombre: string, signo: 1 | -1, orden: number): ConceptoRenta =>
  ({ id, company_id: 'c1', codigo: id, nombre, bloque, signo, comisionable: true, orden, activo: true, created_at: '', updated_at: '' })
const conceptos = [
  con('h1', 'huesped', 'Tarifa al huésped', 1, 10),
  con('a1', 'anfitrion', 'Tarifa de la habitación', 1, 10), con('a2', 'anfitrion', 'Descuentos aplicados', -1, 20),
]
let liquidaciones = new Map<string, LiquidacionRenta>()

function montar(permisos = todos, lista = reservas) {
  return render(
    <MemoryRouter>
      <ReservasTab propiedades={propiedades} reservas={lista} proyectos={proyectos} conceptos={conceptos} liquidaciones={liquidaciones}
        companyId="c1" hoy="2026-11-16" permisos={permisos} />
    </MemoryRouter>,
  )
}
const fila = (texto: string) => screen.getByText(texto).closest('tr') as HTMLElement

beforeEach(() => { vi.clearAllMocks(); liquidaciones = new Map() })
afterEach(cleanup)

describe('lista unificada', () => {
  it('muestra de dónde viene cada reserva y sólo deja eliminar las propias de Rentas', () => {
    montar()
    expect(within(fila('Ana Pérez')).getByText('Independiente')).toBeTruthy()
    expect(within(fila('Paola González')).getByText(/21B\+/)).toBeTruthy()
    expect(within(fila('Ana Pérez')).getByRole('button', { name: /Eliminar/ })).toBeTruthy()
    expect(within(fila('Paola González')).queryByRole('button', { name: /Eliminar/ })).toBeNull()
    expect(within(fila('Paola González')).getByRole('button', { name: /Editar/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Condominios › STR/ }).getAttribute('href')).toBe('/condominios/str')
  })

  it('solo-ver: sin botones ni selector de estado', () => {
    montar({ ver: true, crear: false, editar: false, eliminar: false })
    expect(screen.queryByRole('button', { name: /Nueva reserva/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull()
    expect(screen.queryByRole('combobox', { name: /Estado de la reserva/ })).toBeNull()
    expect(within(fila('Ana Pérez')).getByText('Confirmada')).toBeTruthy()
  })

  it('cambiar el estado desde la fila actualiza ESA reserva, con su origen', async () => {
    montar()
    fireEvent.change(screen.getByRole('combobox', { name: 'Estado de la reserva de Paola González' }), { target: { value: 'en_curso' } })
    await waitFor(() => expect(h.actualizar).toHaveBeenCalledTimes(1))
    expect(h.actualizar).toHaveBeenCalledWith({ reserva: expect.objectContaining({ id: 's1', origen: 'condominio' }), datos: { estado: 'en_curso' } })
  })

  it('cancelar pide confirmación; si se rechaza no se escribe', async () => {
    h.confirm.mockResolvedValueOnce({ isConfirmed: false })
    montar()
    fireEvent.change(screen.getByRole('combobox', { name: 'Estado de la reserva de Ana Pérez' }), { target: { value: 'cancelada' } })
    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1))
    expect(h.actualizar).not.toHaveBeenCalled()
  })
})

describe('nueva reserva', () => {
  function abrir() {
    montar()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva reserva' }))
    return screen.getByRole('dialog')
  }

  it('sólo ofrece propiedades de corto plazo y avisa que la enlazada se guarda en STR', () => {
    const dialogo = abrir()
    const opciones = within(within(dialogo).getByLabelText('Propiedad *')).getAllByRole('option').map(o => o.textContent)
    expect(opciones).toEqual(['Elige una propiedad…', 'Casa Lago', 'Apto 2A — 21B+'])
    fireEvent.change(within(dialogo).getByLabelText('Propiedad *'), { target: { value: 'enl' } })
    expect(within(dialogo).getByText('Se guarda en la pestaña STR de su condominio.')).toBeTruthy()
  })

  it('valida antes de escribir: sin fechas o con salida no posterior no llama al servidor', async () => {
    const dialogo = abrir()
    fireEvent.change(within(dialogo).getByLabelText('Propiedad *'), { target: { value: 'ind' } })
    fireEvent.change(within(dialogo).getByLabelText('Huésped *'), { target: { value: 'Eva' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'Faltan las fechas de entrada y salida' })))
    fireEvent.change(within(dialogo).getByLabelText('Entrada *'), { target: { value: '2027-01-10' } })
    fireEvent.change(within(dialogo).getByLabelText('Salida *'), { target: { value: '2027-01-10' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'La salida debe ser posterior a la entrada' })))
    expect(h.crear).not.toHaveBeenCalled()
  })

  it('avisa el solape sin impedir guardar, y calcula el total con las noches', async () => {
    const dialogo = abrir()
    fireEvent.change(within(dialogo).getByLabelText('Propiedad *'), { target: { value: 'ind' } })
    fireEvent.change(within(dialogo).getByLabelText('Huésped *'), { target: { value: '  Eva Ruiz ' } })
    fireEvent.change(within(dialogo).getByLabelText('Entrada *'), { target: { value: '2026-12-12' } })
    fireEvent.change(within(dialogo).getByLabelText('Salida *'), { target: { value: '2026-12-15' } })
    fireEvent.change(within(dialogo).getByLabelText('Monto por noche (USD)'), { target: { value: '850,50' } })
    expect(within(dialogo).getByRole('status').textContent).toMatch(/se cruzan con la reserva de Ana Pérez/)
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(h.crear).toHaveBeenCalledTimes(1))
    expect(h.crear).toHaveBeenCalledWith({
      propiedad: expect.objectContaining({ id: 'ind', unidad_id: null }),
      datos: expect.objectContaining({
        huesped_nombre: 'Eva Ruiz', fecha_entrada: '2026-12-12', fecha_salida: '2026-12-15',
        num_huespedes: 1, monto_noche: 850.5, monto_total: 2551.5, estado: 'confirmada', plataforma: 'directo',
      }),
      moneda: 'USD',
    })
  })

  it('para una propiedad enlazada entrega esa propiedad (con su unidad) a la mutación', async () => {
    const dialogo = abrir()
    fireEvent.change(within(dialogo).getByLabelText('Propiedad *'), { target: { value: 'enl' } })
    fireEvent.change(within(dialogo).getByLabelText('Huésped *'), { target: { value: 'Saúl' } })
    fireEvent.change(within(dialogo).getByLabelText('Entrada *'), { target: { value: '2027-02-01' } })
    fireEvent.change(within(dialogo).getByLabelText('Salida *'), { target: { value: '2027-02-03' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(h.crear).toHaveBeenCalledTimes(1))
    expect(h.crear.mock.calls[0][0]).toMatchObject({ propiedad: { id: 'enl', unidad_id: 'u1', project_id: 'p1' } })
  })
})

describe('desglose de cobro', () => {
  it('al guardar viaja el desglose y el total de la reserva pasa a ser lo recibido', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva reserva' }))
    const dialogo = screen.getByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText('Propiedad *'), { target: { value: 'ind' } })
    fireEvent.change(within(dialogo).getByLabelText('Huésped *'), { target: { value: 'Eva' } })
    fireEvent.change(within(dialogo).getByLabelText('Entrada *'), { target: { value: '2027-02-02' } })
    fireEvent.change(within(dialogo).getByLabelText('Salida *'), { target: { value: '2027-02-03' } })
    fireEvent.change(within(dialogo).getByLabelText('Política de cancelación'), { target: { value: 'no_reembolsable' } })
    fireEvent.change(within(dialogo).getByLabelText('Tarifa al huésped'), { target: { value: '35.10' } })
    fireEvent.change(within(dialogo).getByLabelText('Tarifa de la habitación'), { target: { value: '39' } })
    fireEvent.change(within(dialogo).getByLabelText('− Descuentos aplicados'), { target: { value: '3,90' } })
    expect(within(dialogo).getByText('Total recibido').parentElement?.textContent).toMatch(/35[.,]10/)
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(h.crear).toHaveBeenCalledTimes(1))
    expect(h.crear).toHaveBeenCalledWith({
      propiedad: expect.objectContaining({ id: 'ind' }),
      datos: expect.objectContaining({ monto_total: 35.1, politica_cancelacion: 'no_reembolsable', num_mascotas: 0 }),
      importes: { h1: 35.1, a1: 39, a2: 3.9 },
      moneda: 'USD',
    })
  })

  it('un monto que no es número no llega al servidor', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva reserva' }))
    const dialogo = screen.getByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText('Propiedad *'), { target: { value: 'ind' } })
    fireEvent.change(within(dialogo).getByLabelText('Huésped *'), { target: { value: 'Eva' } })
    fireEvent.change(within(dialogo).getByLabelText('Entrada *'), { target: { value: '2027-02-02' } })
    fireEvent.change(within(dialogo).getByLabelText('Salida *'), { target: { value: '2027-02-03' } })
    fireEvent.change(within(dialogo).getByLabelText('Tarifa de la habitación'), { target: { value: 'treinta' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Revisa el desglose de cobro' })))
    expect(h.crear).not.toHaveBeenCalled()
  })

  it('editar carga el desglose guardado; sin tocarlo, una reserva sin desglose no escribe ninguno', async () => {
    liquidaciones = new Map([['rentas:r1', { id: 'l1', company_id: 'c1', propiedad_id: 'ind', reserva_id: 'r1', reserva_str_id: null, moneda: 'USD', importes: { a1: 120 }, created_at: '', updated_at: '' }]])
    montar()
    expect(within(fila('Ana Pérez')).getByText('con desglose')).toBeTruthy()
    fireEvent.click(within(fila('Ana Pérez')).getByRole('button', { name: /Editar/ }))
    expect((within(screen.getByRole('dialog')).getByLabelText('Tarifa de la habitación') as HTMLInputElement).value).toBe('120')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(h.actualizar).toHaveBeenCalledTimes(1))
    expect(h.actualizar).toHaveBeenCalledWith(expect.objectContaining({ importes: { a1: 120 }, datos: expect.objectContaining({ monto_total: 120 }) }))

    cleanup(); vi.clearAllMocks(); liquidaciones = new Map()
    montar()
    fireEvent.click(within(fila('Paola González')).getByRole('button', { name: /Editar/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(h.actualizar).toHaveBeenCalledTimes(1))
    expect((h.actualizar.mock.calls[0] as unknown as [{ importes?: unknown }])[0].importes).toBeUndefined()
  })
})

describe('moneda de la reserva', () => {
  it('por defecto dólares; elegir otra la manda a la ficha aunque no haya desglose', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva reserva' }))
    const dialogo = screen.getByRole('dialog')
    expect((within(dialogo).getByLabelText('Moneda') as HTMLSelectElement).value).toBe('USD')
    fireEvent.change(within(dialogo).getByLabelText('Propiedad *'), { target: { value: 'ind' } })
    fireEvent.change(within(dialogo).getByLabelText('Huésped *'), { target: { value: 'Eva' } })
    fireEvent.change(within(dialogo).getByLabelText('Entrada *'), { target: { value: '2027-02-02' } })
    fireEvent.change(within(dialogo).getByLabelText('Salida *'), { target: { value: '2027-02-03' } })
    fireEvent.change(within(dialogo).getByLabelText('Moneda'), { target: { value: 'GTQ' } })
    expect(within(dialogo).getByLabelText('Total (GTQ)')).toBeTruthy()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(h.crear).toHaveBeenCalledTimes(1))
    expect(h.crear).toHaveBeenCalledWith(expect.objectContaining({ moneda: 'GTQ', importes: {} }))
  })

  it('la lista muestra cada total en la moneda de su reserva', () => {
    liquidaciones = new Map([['rentas:r1', { id: 'l1', company_id: 'c1', propiedad_id: 'ind', reserva_id: 'r1', reserva_str_id: null, moneda: 'GTQ', importes: {}, created_at: '', updated_at: '' }]])
    montar(todos, reservas.map(x => ({ ...x, monto_total: 500 })))
    expect(fila('Ana Pérez').textContent).toMatch(/GTQ 500/)
    expect(fila('Paola González').textContent).toMatch(/USD 500/)
  })

  it('carga masiva: se ofrece a quien puede crear', () => {
    montar()
    expect(screen.getByRole('button', { name: 'Carga masiva' })).toBeTruthy()
    cleanup()
    montar({ ver: true, crear: false, editar: true, eliminar: false })
    expect(screen.queryByRole('button', { name: 'Carga masiva' })).toBeNull()
  })
})
