// Pantallas de proveedores/contratos del PR A.
//
// Lo que se fija aquí es lo que una persona ve y hace; las reglas de fondo
// (duplicados, habilitación, ciclo del contrato) las prueban los SQL de
// supabase/tests/proveedores_pr_a contra una base real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

const m = vi.hoisted(() => ({
  cambiarEstado: vi.fn(),
  eliminar: vi.fn(),
  previsualizar: vi.fn(),
  aplicar: vi.fn(),
  descartar: vi.fn(),
  prompt: vi.fn(),
  confirm: vi.fn(),
  notify: vi.fn(),
  config: [] as unknown[],
  filas: [] as unknown[],
}))

const vacio = { data: [], isLoading: false }
const ok = (fn: unknown) => ({ mutateAsync: fn, isPending: false })

vi.mock('../../../domain/proveedores/queries', () => ({
  useAsignacionesQuery: () => vacio,
  useContactosProveedorQuery: () => vacio,
  useEventosContratoQuery: () => vacio,
  useResponsablesQuery: () => ({ data: [{ id: 'u1', full_name: 'Ana' }], isLoading: false }),
  useEmpresaNombreQuery: () => ({ data: 'Empresa Uno', isLoading: false }),
  useVistaPreviaHistoricosQuery: () => vacio,
  useResumenVinculacionQuery: () => ({ data: undefined, isLoading: false }),
  useDuplicadosFiscalesQuery: () => vacio,
  useFilasLoteQuery: () => ({ data: m.filas, isLoading: false }),
  useReglasCompraQuery: () => vacio,
  useConfigCompraQuery: () => ({ data: m.config, isLoading: false }),
  useSuministrosProyectoQuery: () => vacio,
  useSugerenciaCuentaQuery: () => ({ data: null, isLoading: false }),
}))
vi.mock('../../../domain/proveedores/mutations', () => ({
  useCrearContratoMutation: () => ok(vi.fn()),
  useActualizarContratoMutation: () => ok(vi.fn()),
  useCambiarEstadoContratoMutation: () => ok(m.cambiarEstado),
  useEliminarContratoBorradorMutation: () => ok(m.eliminar),
  useSubirRespaldoContratoMutation: () => ok(vi.fn()),
  usePrevisualizarImportacionMutation: () => ok(m.previsualizar),
  useAplicarImportacionMutation: () => ok(m.aplicar),
  useDescartarImportacionMutation: () => ok(m.descartar),
  useGuardarReglaCompraMutation: () => ok(vi.fn()),
  useReemplazarReglaCompraMutation: () => ok(vi.fn()),
  useActualizarReglaCompraMutation: () => ok(vi.fn()),
  useVincularContratoMutation: () => ok(vi.fn()),
  useVincularInequivocosMutation: () => ok(vi.fn()),
  useRevertirVinculosMutation: () => ok(vi.fn()),
}))
vi.mock('../../../domain/cxp/queries', () => ({
  useProveedoresQuery: () => ({
    data: [
      { id: 'p1', company_id: 'c1', nombre: 'Aguas del Norte', nit: '1234567-8', rfc: null, pais: 'GT', codigo: 'PRV-00001', estado: 'autorizado', alcance: 'empresa', activo: true, dias_credito: 0 },
      { id: 'p2', company_id: 'c1', nombre: 'Jardines Verdes', nit: null, rfc: null, pais: null, codigo: 'PRV-00002', estado: 'en_revision', alcance: 'proyectos', activo: true, dias_credito: 0 },
    ],
    isLoading: false,
  }),
}))
vi.mock('../../../domain/contabilidad/queries', () => ({
  useCuentasQuery: () => ({
    data: [
      { id: 'a1', codigo: '5101', nombre: 'Mantenimiento', tipo: 'gasto', es_detalle: true, activa: true },
      { id: 'a2', codigo: '5100', nombre: 'Gastos (grupo)', tipo: 'gasto', es_detalle: false, activa: true },
      { id: 'a3', codigo: '1201', nombre: 'Bancos', tipo: 'activo', es_detalle: true, activa: true },
    ],
  }),
}))
vi.mock('../../shared/Dialog', () => ({ confirm: m.confirm, notify: m.notify }))
vi.mock('../../shared/PromptDialog', () => ({ openPromptDialog: m.prompt }))
vi.mock('../../shared/SecureFileLink', () => ({ SecureFileLink: ({ children }: { children: ReactNode }) => <a>{children as ReactNode}</a> }))
vi.mock('../../shared/EditModal', () => ({
  EditModal: ({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) => (
    <div role="dialog" aria-label={title}>{children}{footer}</div>
  ),
}))

import { ProveedorSelector } from '../ProveedorSelector'
import { ContratosProveedorTab } from '../ContratosProveedorTab'
import { ImportarProveedoresModal } from '../ImportarProveedoresModal'
import { ReglasCompraSection } from '../ReglasCompraSection'
import type { ContratoProveedorCatalogo, ProveedorCatalogo } from '../../../types/proveedores'

const PROVS = [
  { id: 'p1', company_id: 'c1', nombre: 'Aguas del Norte', nit: '1234567-8', pais: 'GT', codigo: 'PRV-00001', estado: 'autorizado', alcance: 'empresa', activo: true, dias_credito: 0 },
  { id: 'p2', company_id: 'c1', nombre: 'Jardines Verdes', nit: null, pais: null, codigo: 'PRV-00002', estado: 'en_revision', alcance: 'proyectos', activo: true, dias_credito: 0 },
] as unknown as ProveedorCatalogo[]

function contrato(over: Partial<ContratoProveedorCatalogo>): ContratoProveedorCatalogo {
  return {
    id: 'k1', company_id: 'c1', project_id: 'pr1', proveedor_id: 'p1', proveedor_nombre: 'Aguas del Norte',
    servicio: 'otro', fecha_inicio: '2026-01-01', estado: 'borrador', created_at: '2026-01-01', ...over,
  }
}

beforeEach(() => {
  m.confirm.mockResolvedValue({ isConfirmed: true })
  m.config = []
  m.filas = []
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('ProveedorSelector', () => {
  it('busca por código y por NIT, y muestra la habilitación en el proyecto', () => {
    const onChange = vi.fn()
    render(<ProveedorSelector proveedores={PROVS} asignaciones={[]} projectId="pr1" value={null} onChange={onChange} />)
    const caja = screen.getByRole('combobox')
    fireEvent.focus(caja)
    fireEvent.change(caja, { target: { value: '12345678' } })
    const opciones = screen.getAllByRole('option')
    expect(opciones).toHaveLength(1)
    expect(opciones[0].textContent).toContain('Aguas del Norte')
    fireEvent.change(caja, { target: { value: 'PRV-00002' } })
    expect(screen.getAllByRole('option')[0].textContent).toContain('Jardines Verdes')
  })

  it('no deja elegir lo que la pantalla bloquea y explica por qué', () => {
    const onChange = vi.fn()
    render(<ProveedorSelector proveedores={PROVS} asignaciones={[]} projectId="pr1" value={null} onChange={onChange}
      bloquear={(p) => (p.id === 'p2' ? 'No está autorizado' : null)} />)
    fireEvent.focus(screen.getByRole('combobox'))
    const bloqueada = screen.getAllByRole('option').find((o) => o.textContent?.includes('Jardines'))!
    expect(bloqueada.getAttribute('aria-disabled')).toBe('true')
    expect(bloqueada.textContent).toContain('No está autorizado')
    fireEvent.mouseDown(bloqueada)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('ContratosProveedorTab', () => {
  const props = { proyectoId: 'pr1', proyectoNombre: 'Torre Sur', companyId: 'c1', moneda: 'GTQ', canCreate: true, canEdit: true, onRefresh: vi.fn() }

  it('declara empresa y proyecto activos y se llama «Contratos», no «Proveedores»', () => {
    render(<ContratosProveedorTab {...props} contratos={[]} />)
    const ctx = screen.getByTestId('contexto-activo')
    expect(ctx.textContent).toContain('Empresa Uno')
    expect(ctx.textContent).toContain('Torre Sur')
    expect(screen.getByText(/condición de servicio/i)).toBeTruthy()
  })

  it('un borrador se puede activar o eliminar; un activo se suspende pero no se elimina', () => {
    const { rerender } = render(<ContratosProveedorTab {...props} contratos={[contrato({ estado: 'borrador' })]} />)
    expect(screen.getByText('Activar')).toBeTruthy()
    expect(screen.getByText('Eliminar')).toBeTruthy()
    rerender(<ContratosProveedorTab {...props} contratos={[contrato({ estado: 'activo' })]} />)
    expect(screen.getByText('Suspender')).toBeTruthy()
    expect(screen.getByText('Terminar')).toBeTruthy()
    expect(screen.queryByText('Eliminar')).toBeNull()
    rerender(<ContratosProveedorTab {...props} contratos={[contrato({ estado: 'terminado' })]} />)
    expect(screen.queryByText('Suspender')).toBeNull()
    expect(screen.queryByText('Activar')).toBeNull()
  })

  it('no activa un contrato incompleto: dice qué falta y no llama al servidor', async () => {
    render(<ContratosProveedorTab {...props} contratos={[contrato({ estado: 'borrador' })]} />)
    fireEvent.click(screen.getByText('Activar'))
    await waitFor(() => expect(m.notify).toHaveBeenCalled())
    expect(m.notify.mock.calls[0][0].text).toMatch(/modalidad/)
    expect(m.cambiarEstado).not.toHaveBeenCalled()
  })

  it('suspender pide motivo y lo manda; si se cancela el aviso no cambia nada', async () => {
    const c = contrato({ estado: 'activo', modalidad: 'recurrente', moneda: 'GTQ', periodicidad: 'mensual', importe_periodico: 100, responsable_id: 'u1' })
    m.prompt.mockResolvedValueOnce(null)
    render(<ContratosProveedorTab {...props} contratos={[c]} />)
    fireEvent.click(screen.getByText('Suspender'))
    await waitFor(() => expect(m.prompt).toHaveBeenCalled())
    expect(m.cambiarEstado).not.toHaveBeenCalled()
    m.prompt.mockResolvedValueOnce({ motivo: ' Incumplimiento ' })
    fireEvent.click(screen.getByText('Suspender'))
    await waitFor(() => expect(m.cambiarEstado).toHaveBeenCalledWith({ id: 'k1', estado: 'suspendido', motivo: 'Incumplimiento' }))
  })

  it('un contrato histórico en texto libre se señala y ofrece vincularlo al catálogo', () => {
    render(<ContratosProveedorTab {...props} contratos={[contrato({ proveedor_id: null, proveedor_nombre: 'Limpieza Express', estado: 'activo' })]} />)
    expect(screen.getByText(/Texto libre · sin vincular/i)).toBeTruthy()
    expect(screen.getByText(/Revisar y vincular al catálogo/)).toBeTruthy()
  })

  it('sin permiso de edición no ofrece acciones de escritura', () => {
    render(<ContratosProveedorTab {...props} canCreate={false} canEdit={false} contratos={[contrato({ estado: 'activo' })]} />)
    expect(screen.queryByText('Suspender')).toBeNull()
    expect(screen.queryByText('+ Nuevo contrato')).toBeNull()
    expect(screen.getByText('Historial')).toBeTruthy()
  })
})

describe('ImportarProveedoresModal', () => {
  const resumen = { filas: 3, crear: 1, actualizar: 0, sin_cambios: 0, omitir: 0, con_error: 1, con_advertencia: 0 }

  async function cargar(csv: string) {
    m.previsualizar.mockResolvedValueOnce({ lote_id: 'l1', resumen })
    m.filas = [
      { id: 'f1', fila: 2, accion: 'crear', estado: 'pendiente', origen: {}, cambios: {}, errores: [], advertencias: [], resultado: null },
      { id: 'f2', fila: 3, accion: 'error', estado: 'error', origen: {}, cambios: {}, errores: [{ campo: 'nit', mensaje: 'DUPLICADO_FISCAL' }], advertencias: [], resultado: null },
    ]
    render(<ImportarProveedoresModal onClose={vi.fn()} />)
    const archivo = new File([csv], 'proveedores.csv', { type: 'text/csv' })
    // jsdom no implementa File.arrayBuffer
    Object.defineProperty(archivo, 'arrayBuffer', { value: async () => new TextEncoder().encode(csv).buffer })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [archivo] } })
    await screen.findByTestId('resumen-lote')
  }
  const CSV = 'Nombre *,NIT,País\nUno SA,1234567-8,GT\nDos SA,1234567-8,GT\n'

  it('muestra la vista previa con errores por fila y NO aplica en todo-o-nada con errores', async () => {
    await cargar(CSV)
    expect(m.previsualizar).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'proveedores', opciones: { actualizar_existentes: false, vaciar_vacios: false } }))
    expect(screen.getByText('1 con error')).toBeTruthy()
    expect(screen.getByText(/DUPLICADO_FISCAL/)).toBeTruthy()
    expect((screen.getByText('Aplicar carga') as HTMLButtonElement).disabled).toBe(true)
    expect(m.aplicar).not.toHaveBeenCalled()
  })

  it('en «solo filas válidas» pide confirmar y deja claro que las erróneas no se cargan', async () => {
    await cargar(CSV)
    fireEvent.click(screen.getByLabelText(/Cargar solo las filas válidas/))
    m.aplicar.mockResolvedValueOnce({ estado: 'aplicado_parcial', modo: 'filas_validas', lote_id: 'l1', aplicadas: 1, con_error: 1 })
    fireEvent.click(screen.getByText('Aplicar carga'))
    await waitFor(() => expect(m.aplicar).toHaveBeenCalledWith({ loteId: 'l1', modo: 'filas_validas' }))
    expect(m.confirm.mock.calls[0][0].text).toMatch(/NO se cargan/)
    const res = await screen.findByTestId('resultado-carga')
    expect(res.textContent).toMatch(/parcialmente/)
    expect(res.textContent).toMatch(/1 con error \(no cargadas\)/)
  })

  it('rechaza un .xlsm sin llegar al servidor', async () => {
    render(<ImportarProveedoresModal onClose={vi.fn()} />)
    const archivo = new File(['x'], 'macro.xlsm')
    Object.defineProperty(archivo, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [archivo] } })
    await waitFor(() => expect(m.notify).toHaveBeenCalled())
    expect(m.previsualizar).not.toHaveBeenCalled()
  })

  it('aclara que importar no autoriza ni activa nada', () => {
    render(<ImportarProveedoresModal onClose={vi.fn()} />)
    expect(screen.getAllByText(/no autoriza/i).length).toBeGreaterThan(0)
  })
})

describe('ReglasCompraSection', () => {
  it('ofrece solo cuentas de detalle del tipo que admite el destino', () => {
    render(<ReglasCompraSection companyId="c1" projectId={null} puedeEditar />)
    const cuentas = within(screen.getByLabelText('Cuenta de la regla')).getAllByRole('option').map((o) => o.textContent)
    expect(cuentas.some((t) => t?.includes('5101'))).toBe(true)
    expect(cuentas.some((t) => t?.includes('5100'))).toBe(false) // agrupadora
    expect(cuentas.some((t) => t?.includes('1201'))).toBe(false) // tipo activo en destino gasto
    fireEvent.change(screen.getByLabelText('Destino de la compra'), { target: { value: 'inventario' } })
    const activos = within(screen.getByLabelText('Cuenta de la regla')).getAllByRole('option').map((o) => o.textContent)
    expect(activos.some((t) => t?.includes('1201'))).toBe(true)
  })

  it('la configuración incompleta se ve, no se calla', () => {
    m.config = [{ concepto: 'destino', destino: 'gasto', categoria: null, cuenta_id: null, cuenta_codigo: null, origen: 'sin_resolver', completa: false, motivo: 'Falta el mapeo' }]
    render(<ReglasCompraSection companyId="c1" projectId={null} puedeEditar />)
    expect(screen.getByRole('alert').textContent).toMatch(/Configuración incompleta/)
    expect(screen.getByRole('alert').textContent).toMatch(/Falta el mapeo/)
  })

  it('por producto exige proyecto y sin permiso no hay formulario', () => {
    const { rerender } = render(<ReglasCompraSection companyId="c1" projectId={null} puedeEditar />)
    expect((screen.getByRole('option', { name: /Por producto/ }) as HTMLOptionElement).disabled).toBe(true)
    rerender(<ReglasCompraSection companyId="c1" projectId={null} puedeEditar={false} />)
    expect(screen.queryByText('Agregar regla')).toBeNull()
  })
})
