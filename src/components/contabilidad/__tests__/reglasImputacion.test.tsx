// Reglas de imputación — pruebas de la PANTALLA.
//
// Qué se prueba acá y qué NO. La RESOLUCIÓN no se prueba acá: vive en
// `conta_resolver_imputacion` y la cubre el arnés de PostgreSQL contra una base
// real. Reimplementar la prioridad en un test de componente sería medir una
// segunda implementación que a nadie le importa.
//
// Lo que sí es responsabilidad de la pantalla, y es lo que se fija:
//   · que sólo ofrezca cuentas IMPUTABLES (de detalle y activas);
//   · que MUESTRE el porqué de la resolución, no sólo la cuenta;
//   · que un «sin resolver» se vea como configuración incompleta y NO bloquee;
//   · que NO ofrezca guardar reglas que ningún documento consulta todavía.
//
// Ese último punto es una revisión que se volvió prueba: la pantalla llegó a
// ofrecer reglas por cliente/unidad y destinos de inventario y activo fijo que
// nada consumía. Guardarlas no cambiaba ningún asiento y nadie se enteraba.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CuentaContable, ResolucionImputacion } from '../../../types/contabilidad'

const state = vi.hoisted(() => ({
  cuentas: [] as CuentaContable[],
  resolucion: null as ResolucionImputacion | null,
  guardarProv: vi.fn(async (_input: Record<string, unknown>) => null),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../domain/contabilidad/queries', () => ({
  useCuentasQuery: () => ({ data: state.cuentas, isLoading: false }),
  useReglasProveedorQuery: () => ({ data: [], isLoading: false }),
  useResolucionImputacionQuery: () => ({ data: state.resolucion, isLoading: false }),
}))
vi.mock('../../../domain/contabilidad/mutations', () => ({
  useGuardarReglaProveedorMutation: () => ({ mutateAsync: state.guardarProv, isPending: false }),
  useEliminarReglaProveedorMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../../domain/cxp/queries', () => ({
  useProveedoresQuery: () => ({
    data: [{ id: 'prov-1', nombre: 'Proveedor Uno' }],
    isLoading: false,
  }),
}))

import { ReglasImputacionTab } from '../ReglasImputacionTab'

function cuenta(over: Partial<CuentaContable> & { id: string }): CuentaContable {
  return {
    company_id: 'emp-1',
    project_id: null,
    codigo: over.codigo ?? '5101',
    nombre: over.nombre ?? 'Gasto',
    tipo: 'gasto',
    naturaleza: 'deudora',
    padre_id: null,
    nivel: 3,
    es_detalle: over.es_detalle ?? true,
    activa: over.activa ?? true,
    es_sistema: false,
    moneda: null,
    descripcion: null,
    created_at: '2026-09-22T00:00:00Z',
    updated_at: '2026-09-22T00:00:00Z',
    ...over,
  } as CuentaContable
}

beforeEach(() => {
  state.cuentas = [
    cuenta({ id: 'c-detalle', codigo: '5101', nombre: 'Gasto general' }),
    cuenta({ id: 'c-agrupadora', codigo: '5', nombre: 'Gastos', es_detalle: false }),
    cuenta({ id: 'c-inactiva', codigo: '5103', nombre: 'Gasto viejo', activa: false }),
  ]
  state.resolucion = null
  state.guardarProv.mockClear()
})
afterEach(cleanup)

describe('ReglasImputacionTab', () => {
  it('sólo ofrece cuentas de detalle y activas', () => {
    render(<ReglasImputacionTab companyId="emp-1" projectId={null} />)
    const select = screen.getByLabelText('Cuenta') as HTMLSelectElement
    const valores = Array.from(select.options).map((o) => o.value)

    // La de detalle y activa está; la agrupadora y la inactiva NO, porque el
    // trigger de BD las rechazaría y ofrecerlas sería prometer algo imposible.
    expect(valores).toContain('c-detalle')
    expect(valores).not.toContain('c-agrupadora')
    expect(valores).not.toContain('c-inactiva')
  })

  it('enseña la prioridad completa en pantalla, no en un manual', () => {
    const { container } = render(<ReglasImputacionTab companyId="emp-1" projectId={null} />)
    // El texto de la prioridad vive en el párrafo de cabecera. Se lee de ahí y
    // no con getByText suelto: «mapeo general del evento» también aparece en
    // los mensajes de estado vacío de las dos secciones.
    const intro = container.querySelector('p')?.textContent ?? ''
    expect(intro).toMatch(/la del documento/i)
    expect(intro).toMatch(/la regla del proveedor/i)
    expect(intro).toMatch(/el mapeo general del evento/i)
    // Y NO promete el escalón de cliente/unidad, que no está cableado.
    expect(intro).not.toMatch(/cliente o unidad/i)
    expect(intro).toMatch(/no se le inventa una cuenta/i)
  })

  it('muestra la cuenta resuelta Y el escalón que la eligió', () => {
    state.resolucion = {
      cuenta_id: 'c-detalle',
      origen_resolucion: 'regla_proveedor',
      regla_tabla: 'conta_reglas_proveedor',
      regla_id: 'r-1',
      evento_usado: null,
      motivo: null,
    }
    render(<ReglasImputacionTab companyId="emp-1" projectId={null} />)

    // Acotado a la caja de previsualización: el nombre de la cuenta también
    // aparece en los <option> de los selectores, y ahí no prueba nada.
    const caja = screen.getByRole('status')
    expect(caja.textContent).toContain('5101 · Gasto general')
    expect(caja.textContent).toContain('Regla del proveedor')
  })

  it('un «sin resolver» se ve como configuración incompleta, con su motivo', () => {
    state.resolucion = {
      cuenta_id: null,
      origen_resolucion: 'sin_resolver',
      regla_tabla: null,
      regla_id: null,
      evento_usado: 'activo_fijo',
      motivo: 'No hay regla aplicable y el evento «activo_fijo» no está mapeado.',
    }
    render(<ReglasImputacionTab companyId="emp-1" projectId={null} />)

    const caja = screen.getByRole('status')
    expect(caja.textContent).toContain('Sin resolver — falta configuración')
    expect(caja.textContent).toContain('no está mapeado')

    // Y NO bloquea: el formulario sigue ahí, que es lo único que permite
    // arreglar la configuración que falta.
    expect(screen.getByLabelText('Proveedor')).toBeTruthy()
    expect(screen.getByLabelText('Cuenta')).toBeTruthy()
  })

  it('guarda la regla de proveedor con destino y cuenta, sin inventar campos', async () => {
    render(<ReglasImputacionTab companyId="emp-1" projectId={null} />)

    fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'prov-1' } })
    fireEvent.change(screen.getByLabelText('Destino'), { target: { value: 'gasto' } })
    fireEvent.change(screen.getByLabelText('Cuenta'), { target: { value: 'c-detalle' } })
    fireEvent.click(screen.getAllByText('Agregar regla')[0])

    await vi.waitFor(() => expect(state.guardarProv).toHaveBeenCalledTimes(1))
    expect(state.guardarProv).toHaveBeenCalledWith({
      proveedor_id: 'prov-1',
      destino: 'gasto',
      cuenta_id: 'c-detalle',
    })
  })

  it('NO ofrece guardar reglas por cliente o unidad: ningún documento las consulta', () => {
    render(<ReglasImputacionTab companyId="emp-1" projectId={null} />)

    // `conta_reglas_cargo` existe en la BD y el resolutor la evalúa, pero
    // `cargos_adicionales_unidad` todavía no llama al resolutor. Un control
    // para guardarlas prometería cambiar un asiento sin cambiar ninguno.
    expect(screen.queryByLabelText('Tipo de cargo')).toBeNull()
    expect(screen.queryByLabelText('Cuenta del cargo')).toBeNull()
    expect(screen.getAllByText('Agregar regla')).toHaveLength(1)

    // Y la pantalla lo DICE, en vez de dejar el hueco sin explicación.
    expect(document.body.textContent).toMatch(/todavía no consultan estas reglas/i)
  })

  it('sólo ofrece destinos que un documento consulta de verdad', () => {
    render(<ReglasImputacionTab companyId="emp-1" projectId={null} />)
    const destino = screen.getByLabelText('Destino') as HTMLSelectElement
    const valores = Array.from(destino.options).map((o) => o.value)

    // `conta_tg_facturas_prov()` resuelve `gasto` y nada más. Inventario y
    // activo fijo los decide la recepción de la orden de compra, no la
    // factura, así que ofrecerlos acá sería dejar configurar aire.
    expect(valores).toEqual(['gasto'])
  })

  it('exige elegir cuenta antes de guardar, y lo dice', async () => {
    render(<ReglasImputacionTab companyId="emp-1" projectId={null} />)

    fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'prov-1' } })
    fireEvent.click(screen.getAllByText('Agregar regla')[0])

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(state.guardarProv).not.toHaveBeenCalled()
  })
})
