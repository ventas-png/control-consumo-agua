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
//   · que no mande `especificidad`, que es una columna generada.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CuentaContable, ResolucionImputacion } from '../../../types/contabilidad'

const state = vi.hoisted(() => ({
  cuentas: [] as CuentaContable[],
  resolucion: null as ResolucionImputacion | null,
  guardarProv: vi.fn(async (_input: Record<string, unknown>) => null),
  guardarCargo: vi.fn(async (_input: Record<string, unknown>) => null),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../domain/contabilidad/queries', () => ({
  useCuentasQuery: () => ({ data: state.cuentas, isLoading: false }),
  useReglasProveedorQuery: () => ({ data: [], isLoading: false }),
  useReglasCargoQuery: () => ({ data: [], isLoading: false }),
  useResolucionImputacionQuery: () => ({ data: state.resolucion, isLoading: false }),
}))
vi.mock('../../../domain/contabilidad/mutations', () => ({
  useGuardarReglaProveedorMutation: () => ({ mutateAsync: state.guardarProv, isPending: false }),
  useEliminarReglaProveedorMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGuardarReglaCargoMutation: () => ({ mutateAsync: state.guardarCargo, isPending: false }),
  useEliminarReglaCargoMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  state.guardarCargo.mockClear()
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
    expect(intro).toMatch(/la de cliente o unidad/i)
    expect(intro).toMatch(/el mapeo general del evento/i)
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

    // Y NO bloquea: los formularios siguen ahí, que es lo único que permite
    // arreglar la configuración que falta.
    expect(screen.getByLabelText('Proveedor')).toBeTruthy()
    expect(screen.getByLabelText('Tipo de cargo')).toBeTruthy()
  })

  it('guarda la regla de proveedor con destino y cuenta, sin inventar campos', async () => {
    render(<ReglasImputacionTab companyId="emp-1" projectId={null} />)

    fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'prov-1' } })
    fireEvent.change(screen.getByLabelText('Destino'), { target: { value: 'inventario' } })
    fireEvent.change(screen.getByLabelText('Cuenta'), { target: { value: 'c-detalle' } })
    fireEvent.click(screen.getAllByText('Agregar regla')[0])

    await vi.waitFor(() => expect(state.guardarProv).toHaveBeenCalledTimes(1))
    expect(state.guardarProv).toHaveBeenCalledWith({
      proveedor_id: 'prov-1',
      destino: 'inventario',
      cuenta_id: 'c-detalle',
    })
  })

  it('la regla de cargo NO manda especificidad: es una columna generada', async () => {
    render(<ReglasImputacionTab companyId="emp-1" projectId={null} />)

    fireEvent.change(screen.getByLabelText('Tipo de cargo'), { target: { value: 'multa' } })
    fireEvent.change(screen.getByLabelText('Cuenta del cargo'), { target: { value: 'c-detalle' } })
    fireEvent.click(screen.getAllByText('Agregar regla')[1])

    await vi.waitFor(() => expect(state.guardarCargo).toHaveBeenCalledTimes(1))
    const enviado = state.guardarCargo.mock.calls[0][0]
    expect(enviado).toEqual({ categoria: 'multa', cuenta_id: 'c-detalle' })
    expect(enviado).not.toHaveProperty('especificidad')
  })

  it('exige elegir cuenta antes de guardar, y lo dice', async () => {
    render(<ReglasImputacionTab companyId="emp-1" projectId={null} />)

    fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'prov-1' } })
    fireEvent.click(screen.getAllByText('Agregar regla')[0])

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(state.guardarProv).not.toHaveBeenCalled()
  })
})
