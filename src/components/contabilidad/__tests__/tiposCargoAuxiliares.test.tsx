// Tipos de cargo y auxiliares — pruebas de las PANTALLAS.
//
// Qué NO se prueba acá: las validaciones de cuenta (activa, de detalle, del
// mismo ledger, del tipo contable correcto, impuesto sólo donde hay
// tratamiento), la unicidad del código de auxiliar ni la RLS. Viven en la base
// y las cubre el arnés `supabase/tests/conta_auxiliares_tipo_cargo` contra un
// PostgreSQL real, con usuarios de la aplicación.
//
// Lo que sí es responsabilidad de la pantalla, y es lo que se fija:
//   · cada columna ofrece sólo cuentas imputables DEL TIPO que exige
//     (activo / ingreso / pasivo), sin elegir ninguna por nombre ni código;
//   · la cuenta de impuesto sólo aparece donde el servidor dice que aplica;
//   · el estado que calcula el servidor se muestra, incluido su motivo;
//   · un rechazo del servidor se muestra legible, sin el código técnico;
//   · la pantalla avisa que la configuración todavía no genera asientos;
//   · asignar un auxiliar sin código deja que el servidor proponga uno.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  AuxiliarCliente,
  ConfigTipoCargoEstado,
  CuentaContable,
} from '../../../types/contabilidad'

const state = vi.hoisted(() => ({
  cuentas: [] as CuentaContable[],
  estado: [] as ConfigTipoCargoEstado[],
  auxiliares: [] as AuxiliarCliente[],
  guardarConfig: vi.fn(async (_input: Record<string, unknown>) => undefined),
  quitarConfig: vi.fn(async (_id: string) => undefined),
  guardarAux: vi.fn(async (_input: Record<string, unknown>) => undefined),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../domain/contabilidad/queries', () => ({
  AUXILIARES_LIMITE: 100,
  useCuentasQuery: () => ({ data: state.cuentas, isLoading: false }),
  useConfigTiposCargoQuery: () => ({ data: state.estado, isLoading: false, isError: false }),
  useAuxiliaresQuery: () => ({ data: state.auxiliares, isLoading: false, isError: false }),
}))
vi.mock('../../../domain/contabilidad/mutations', () => ({
  useGuardarConfigTipoCargoMutation: () => ({ mutateAsync: state.guardarConfig, isPending: false }),
  useEliminarConfigTipoCargoMutation: () => ({ mutateAsync: state.quitarConfig, isPending: false }),
  useGuardarAuxiliarMutation: () => ({ mutateAsync: state.guardarAux, isPending: false }),
}))

import { TiposCargoTab, mensajeServidor } from '../TiposCargoTab'
import { AuxiliaresTab } from '../AuxiliaresTab'

function cuenta(over: Partial<CuentaContable> & { id: string }): CuentaContable {
  return {
    company_id: 'emp-1',
    project_id: null,
    codigo: '0000',
    nombre: 'Cuenta',
    tipo: 'activo',
    naturaleza: 'deudora',
    padre_id: null,
    nivel: 3,
    es_detalle: true,
    activa: true,
    es_sistema: false,
    moneda: null,
    descripcion: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...over,
  } as CuentaContable
}

function tipo(over: Partial<ConfigTipoCargoEstado> & { tipo_cargo: string; etiqueta: string }): ConfigTipoCargoEstado {
  return {
    admite_impuesto: false,
    config_id: null,
    cuenta_cxc_id: null,
    cuenta_ingreso_id: null,
    cuenta_impuesto_id: null,
    activa: null,
    estado: 'sin_configurar',
    motivo: null,
    ...over,
  }
}

function opciones(select: HTMLElement): string[] {
  return within(select).getAllByRole('option').map((o) => o.textContent ?? '')
}

beforeEach(() => {
  state.cuentas = [
    cuenta({ id: 'cxc', codigo: 'Z-COBRAR', nombre: 'Por cobrar a vecinos', tipo: 'activo' }),
    cuenta({ id: 'cxc-agrup', codigo: '1', nombre: 'Activo', tipo: 'activo', es_detalle: false }),
    cuenta({ id: 'cxc-off', codigo: 'CXC-OLD', nombre: 'CxC vieja', tipo: 'activo', activa: false }),
    cuenta({ id: 'ing', codigo: 'Z-VENTAS', nombre: 'Ventas', tipo: 'ingreso', naturaleza: 'acreedora' }),
    cuenta({ id: 'iva', codigo: 'IVA-X', nombre: 'IVA por pagar', tipo: 'pasivo', naturaleza: 'acreedora' }),
    cuenta({ id: 'gto', codigo: 'GTO', nombre: 'Un gasto', tipo: 'gasto' }),
  ]
  state.estado = [
    tipo({ tipo_cargo: 'mantenimiento', etiqueta: 'Mantenimiento' }),
    tipo({ tipo_cargo: 'agua', etiqueta: 'Servicio de agua', admite_impuesto: true }),
  ]
  state.auxiliares = []
  state.guardarConfig.mockReset()
  state.quitarConfig.mockReset()
  state.guardarAux.mockReset()
})
afterEach(cleanup)

describe('TiposCargoTab', () => {
  it('cada columna ofrece sólo cuentas imputables del tipo que exige', () => {
    render(<TiposCargoTab companyId="emp-1" projectId={null} />)
    const cxc = opciones(screen.getByLabelText('Cuenta por cobrar de Mantenimiento'))
    expect(cxc).toEqual(['Elegir…', 'Z-COBRAR · Por cobrar a vecinos'])
    const ingreso = opciones(screen.getByLabelText('Cuenta de ingreso de Mantenimiento'))
    expect(ingreso).toEqual(['Elegir…', 'Z-VENTAS · Ventas'])
  })

  it('la cuenta de impuesto sólo aparece donde el servidor dice que aplica', () => {
    render(<TiposCargoTab companyId="emp-1" projectId={null} />)
    expect(screen.queryByLabelText('Cuenta de impuesto de Mantenimiento')).toBeNull()
    const imp = opciones(screen.getByLabelText('Cuenta de impuesto de Servicio de agua'))
    expect(imp).toEqual(['Sin impuesto', 'IVA-X · IVA por pagar'])
  })

  it('no elige ninguna cuenta por su cuenta: todo arranca vacío', () => {
    render(<TiposCargoTab companyId="emp-1" projectId={null} />)
    expect((screen.getByLabelText('Cuenta por cobrar de Mantenimiento') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('Cuenta de ingreso de Mantenimiento') as HTMLSelectElement).value).toBe('')
  })

  it('guarda lo elegido y nunca envía impuesto a un tipo que no lo admite', async () => {
    render(<TiposCargoTab companyId="emp-1" projectId={null} />)
    fireEvent.change(screen.getByLabelText('Cuenta por cobrar de Mantenimiento'), { target: { value: 'cxc' } })
    fireEvent.change(screen.getByLabelText('Cuenta de ingreso de Mantenimiento'), { target: { value: 'ing' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Guardar' })[0])
    await waitFor(() => expect(state.guardarConfig).toHaveBeenCalledTimes(1))
    expect(state.guardarConfig.mock.calls[0][0]).toEqual({
      id: null,
      tipo_cargo: 'mantenimiento',
      cuenta_cxc_id: 'cxc',
      cuenta_ingreso_id: 'ing',
      cuenta_impuesto_id: null,
      activa: true,
    })
  })

  it('no guarda sin las dos cuentas obligatorias', async () => {
    render(<TiposCargoTab companyId="emp-1" projectId={null} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Guardar' })[0])
    expect((await screen.findByRole('alert')).textContent).toContain('Elige la cuenta por cobrar y la de ingreso.')
    expect(state.guardarConfig).not.toHaveBeenCalled()
  })

  it('muestra el rechazo del servidor sin el código técnico', async () => {
    state.guardarConfig.mockRejectedValueOnce(
      new Error('CONFIG_CUENTA_INACTIVA: la cuenta por cobrar (CXC-OLD) está desactivada.'))
    render(<TiposCargoTab companyId="emp-1" projectId={null} />)
    fireEvent.change(screen.getByLabelText('Cuenta por cobrar de Mantenimiento'), { target: { value: 'cxc' } })
    fireEvent.change(screen.getByLabelText('Cuenta de ingreso de Mantenimiento'), { target: { value: 'ing' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Guardar' })[0])
    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toContain('la cuenta por cobrar (CXC-OLD) está desactivada.')
    expect(alerta.textContent).not.toContain('CONFIG_CUENTA_INACTIVA')
  })

  it('muestra el estado y el motivo que calcula el servidor', () => {
    state.estado = [tipo({
      tipo_cargo: 'mantenimiento', etiqueta: 'Mantenimiento', config_id: 'cfg-1',
      cuenta_cxc_id: 'cxc', cuenta_ingreso_id: 'ing', activa: true,
      estado: 'cuenta_invalida', motivo: 'cuenta de ingreso (Z-VENTAS): inactiva',
    })]
    render(<TiposCargoTab companyId="emp-1" projectId={null} />)
    expect(screen.getByText('Cuenta inválida')).toBeTruthy()
    expect(screen.getByText('cuenta de ingreso (Z-VENTAS): inactiva')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeTruthy()
  })

  it('avisa que la configuración todavía no genera asientos', () => {
    render(<TiposCargoTab companyId="emp-1" projectId={null} />)
    expect(screen.getByText(/todavía no genera asientos/)).toBeTruthy()
  })
})

describe('mensajeServidor', () => {
  it('traduce el rechazo de RLS a un mensaje de permiso', () => {
    expect(mensajeServidor(new Error('new row violates row-level security policy for table "conta_config_tipo_cargo"')))
      .toBe('No tienes permiso para cambiar la configuración contable de esta empresa.')
  })
})

describe('AuxiliaresTab', () => {
  beforeEach(() => {
    state.auxiliares = [
      { cliente_id: 'cli-1', cliente_nombre: 'Cliente Uno', cliente_codigo: 'C-1', auxiliar_id: null, codigo: null, activo: null },
      { cliente_id: 'cli-2', cliente_nombre: 'Cliente Dos', cliente_codigo: 'C-2', auxiliar_id: 'aux-2', codigo: 'TORRE1-101', activo: true },
    ]
  })

  it('asignar sin escribir código deja que el servidor proponga uno', async () => {
    render(<AuxiliaresTab companyId="emp-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Asignar' }))
    await waitFor(() => expect(state.guardarAux).toHaveBeenCalledTimes(1))
    expect(state.guardarAux.mock.calls[0][0]).toEqual({ auxiliar_id: null, cliente_id: 'cli-1', codigo: null })
  })

  it('renombrar envía el id del auxiliar y el código nuevo', async () => {
    render(<AuxiliaresTab companyId="emp-1" />)
    fireEvent.change(screen.getByLabelText('Código de auxiliar de Cliente Dos'), { target: { value: 'TORRE1-102' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(state.guardarAux).toHaveBeenCalledTimes(1))
    expect(state.guardarAux.mock.calls[0][0]).toEqual({ auxiliar_id: 'aux-2', cliente_id: 'cli-2', codigo: 'TORRE1-102' })
  })

  it('un código repetido se explica en palabras', async () => {
    state.guardarAux.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "uq_conta_auxiliares_codigo"'))
    render(<AuxiliaresTab companyId="emp-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Ese código ya lo usa otro cliente de la empresa.')
  })
})
