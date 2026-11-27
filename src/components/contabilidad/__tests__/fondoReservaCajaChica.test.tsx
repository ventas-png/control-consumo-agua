// Fondo de reserva (traslado manual con póliza) y caja chica (fondo fijo con reposición).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CajaChicaContable, FondoReservaResumen, ReposicionCajaFila } from '../../../types/contabilidad'

const h = vi.hoisted(() => ({
  resumen: null as unknown,
  cajas: [] as unknown[],
  traslados: [] as unknown[],
  constituciones: [] as unknown[],
  reposiciones: [] as unknown[],
  responderReposicion: (_v: unknown): unknown[] => [],
  error: null as Error | null,
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify }))
vi.mock('../../../domain/contabilidad/queries', () => ({
  useFondoReservaResumenQuery: () => ({ data: h.resumen, isLoading: false }),
  useCajasChicasQuery: () => ({ data: h.cajas, isLoading: false }),
  useCuentasQuery: () => ({ data: [
    { id: 'banco', codigo: '1101', nombre: 'Banco operativo', tipo: 'activo', es_detalle: true, activa: true },
    { id: 'fondo', codigo: '1102', nombre: 'Banco fondo de reserva', tipo: 'activo', es_detalle: true, activa: true },
    { id: 'caja', codigo: '1103', nombre: 'Caja chica', tipo: 'activo', es_detalle: true, activa: true },
    { id: 'gasto', codigo: '5101', nombre: 'Mantenimiento menor', tipo: 'gasto', es_detalle: true, activa: true },
    { id: 'titulo', codigo: '11', nombre: 'Disponible', tipo: 'activo', es_detalle: false, activa: true },
  ] }),
}))
vi.mock('../../../domain/contabilidad/mutations', () => {
  const mut = (lista: () => unknown[], responder: (v: unknown) => unknown) => () => ({
    isPending: false,
    mutateAsync: async (v: unknown) => { lista().push(v); if (h.error) throw h.error; return responder(v) },
  })
  return {
    useFondoReservaTrasladoMutation: mut(() => h.traslados, () => ({ movimiento_id: 'm', asiento_id: 'a', saldo_fondo: 4500 })),
    useCajaChicaConstituirMutation: mut(() => h.constituciones, () => 'asiento'),
    useCajaChicaReponerMutation: mut(() => h.reposiciones, (v) => h.responderReposicion(v)),
  }
})

import { FondoReservaModal } from '../FondoReservaModal'
import { CajaChicaModal } from '../CajaChicaModal'

const resumen = (c: Partial<FondoReservaResumen> = {}): FondoReservaResumen => ({
  cuenta_fondo_id: 'fondo', cuenta_contra_id: 'banco', saldo_registro: 4000, saldo_libros: 4000,
  movimientos: 3, movimientos_sin_poliza: 0, ...c,
})
const caja = (c: Partial<CajaChicaContable> = {}): CajaChicaContable => ({
  caja_id: 'c1', responsable: 'Conserje', fecha_apertura: '2026-06-01', monto_fondo: 1000, estado: 'abierta',
  cuenta_caja_id: 'caja', vales_pendientes: 2, total_pendiente: 230.25, ...c,
})
const vale = (c: Partial<ReposicionCajaFila>): ReposicionCajaFila => ({
  movimiento_id: 'v1', fecha: '2026-06-05', concepto: 'Bombillas', comprobante: 'F-101', monto: 150.25,
  cuenta_gasto_id: null, cuenta_codigo: null, cuenta_nombre: null, resultado: 'sin_cuenta', motivo: null,
  reposicion_id: null, asiento_id: null, ...c,
})

beforeEach(() => {
  h.resumen = resumen(); h.cajas = [caja()]; h.error = null; h.notify.mockReset()
  h.traslados = []; h.constituciones = []; h.reposiciones = []
})
afterEach(cleanup)

describe('FondoReservaModal', () => {
  const abrir = (puede = true) =>
    render(<FondoReservaModal companyId="c" projectId="p1" monedaBase="GTQ" puedeRegistrar={puede} onClose={vi.fn()} />)
  const llenar = (monto: string) => {
    fireEvent.change(screen.getByLabelText('Monto'), { target: { value: monto } })
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-06-30' } })
    fireEvent.change(screen.getByLabelText('Concepto'), { target: { value: 'Traslado de junio' } })
  }

  it('propone las cuentas de la última vez y registra la aportación con su póliza', async () => {
    abrir()
    expect(screen.getByText(/Saldo en libros/).textContent).toMatch(/4,000\.00/)
    expect((screen.getByLabelText('Cuenta del fondo de reserva') as HTMLSelectElement).value).toBe('fondo')
    expect((screen.getByLabelText('Contrapartida') as HTMLSelectElement).value).toBe('banco')
    const boton = screen.getByRole('button', { name: /Registrar aportación/ }) as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    llenar('500')
    expect(boton.disabled).toBe(false)
    fireEvent.click(boton)
    await waitFor(() => expect(h.traslados).toHaveLength(1))
    expect(h.traslados[0]).toEqual({
      projectId: 'p1', tipo: 'aportacion', monto: 500, fecha: '2026-06-30', concepto: 'Traslado de junio',
      cuentaFondoId: 'fondo', cuentaContraId: 'banco', referencia: null,
    })
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', text: expect.stringMatching(/4,500\.00/) }))
  })

  it('el retiro pide su propia contrapartida y no deja pasar más que el saldo en libros', () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Movimiento'), { target: { value: 'retiro' } })
    // la contrapartida sugerida era la de las aportaciones: para un retiro se elige de nuevo
    expect((screen.getByLabelText('Contrapartida') as HTMLSelectElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('Contrapartida'), { target: { value: 'gasto' } })
    llenar('4000.01')
    expect(screen.getByText(/supera el saldo en libros/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Registrar retiro/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Monto'), { target: { value: '4000' } })
    expect((screen.getByRole('button', { name: /Registrar retiro/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('avisa cuando el registro de Condominios y los libros no coinciden', () => {
    h.resumen = resumen({ saldo_registro: 4300, movimientos_sin_poliza: 1 })
    abrir()
    const aviso = screen.getByRole('alert').textContent ?? ''
    expect(aviso).toMatch(/1 movimiento\(s\).*sin póliza/)
    expect(aviso).toMatch(/difieren en .*300\.00/)
  })

  it('solo ofrece cuentas de detalle; el fondo, solo de activo; sin permiso no hay botón', () => {
    abrir(false)
    const fondo = Array.from((screen.getByLabelText('Cuenta del fondo de reserva') as HTMLSelectElement).options).map((o) => o.value)
    expect(fondo).toEqual(['', 'banco', 'fondo', 'caja'])
    const contra = Array.from((screen.getByLabelText('Contrapartida') as HTMLSelectElement).options).map((o) => o.value)
    expect(contra).toEqual(['', 'banco', 'caja', 'gasto'])
    expect(screen.queryByRole('button', { name: /Registrar/ })).toBeNull()
    expect(screen.getByText(/Solo consulta/)).toBeTruthy()
  })

  it('el rechazo del servidor se muestra tal cual', async () => {
    h.error = new Error('El periodo 2026-06 de este proyecto está cerrado; reábrelo o elige otra fecha.')
    abrir()
    llenar('100')
    fireEvent.click(screen.getByRole('button', { name: /Registrar aportación/ }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: expect.stringMatching(/periodo 2026-06/) })))
  })
})

describe('CajaChicaModal', () => {
  const abrir = (puede = true) =>
    render(<CajaChicaModal companyId="c" projectId="p1" monedaBase="GTQ" puedeRegistrar={puede} onClose={vi.fn()} />)

  it('sin caja abierta explica dónde abrirla', () => {
    h.cajas = [caja({ estado: 'cerrada' })]
    abrir()
    expect(screen.getByText(/no tiene una caja chica abierta/)).toBeTruthy()
  })

  it('una caja sin fondo en libros se constituye primero, con su cuenta y su banco', async () => {
    h.cajas = [caja({ cuenta_caja_id: null })]
    abrir()
    expect(screen.getByText(/Paso 1 · Constituir el fondo/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Ver vales pendientes/ })).toBeNull()
    const boton = screen.getByRole('button', { name: 'Constituir fondo' }) as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText('Banco'), { target: { value: 'banco' } })
    fireEvent.change(screen.getByLabelText('Cuenta de caja chica'), { target: { value: 'caja' } })
    fireEvent.click(boton)
    await waitFor(() => expect(h.constituciones).toEqual([{ cajaId: 'c1', fecha: '2026-06-01', cuentaCajaId: 'caja', cuentaBancoId: 'banco' }]))
  })

  it('repone: lista los vales, se elige la cuenta de cada uno y solo esos pasan al gasto', async () => {
    h.responderReposicion = (v) => {
      const { aplicar, lineas } = v as { aplicar: boolean; lineas: Array<{ movimiento_id: string; cuenta_gasto_id: string }> }
      const con = (id: string) => lineas.find((l) => l.movimiento_id === id)?.cuenta_gasto_id ?? null
      return [
        vale({ cuenta_gasto_id: con('v1'), cuenta_codigo: con('v1') ? '5101' : null, cuenta_nombre: con('v1') ? 'Mantenimiento menor' : null,
          resultado: con('v1') ? (aplicar ? 'repuesto' : 'previsualizacion') : 'sin_cuenta' }),
        vale({ movimiento_id: 'v2', concepto: 'Taxi', comprobante: null, monto: 80 }),
      ]
    }
    abrir()
    expect(screen.getByText(/2 vale\(s\) · .*230\.25/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-06-30' } })
    fireEvent.change(screen.getByLabelText('Banco'), { target: { value: 'banco' } })
    fireEvent.click(screen.getByRole('button', { name: /Ver vales pendientes/ }))
    await waitFor(() => expect(screen.getByText('Bombillas')).toBeTruthy())
    expect((h.reposiciones[0] as { aplicar: boolean }).aplicar).toBe(false)

    const reponer = () => screen.getByRole('button', { name: /Reponer/ }) as HTMLButtonElement
    expect(reponer().disabled).toBe(true)
    const selVale = screen.getByLabelText('Cuenta de gasto de Bombillas') as HTMLSelectElement
    // ni la caja ni el banco se ofrecen como cuenta del vale; los gastos van primero
    expect(Array.from(selVale.options).map((o) => o.value)).toEqual(['', 'gasto', 'fondo'])
    fireEvent.change(selVale, { target: { value: 'gasto' } })
    expect(reponer().disabled).toBe(false)
    expect(reponer().textContent).toMatch(/150\.25/)

    fireEvent.click(reponer())
    await waitFor(() => expect(h.reposiciones).toHaveLength(2))
    expect(h.reposiciones[1]).toEqual({
      cajaId: 'c1', fecha: '2026-06-30', cuentaBancoId: 'banco', aplicar: true,
      lineas: [{ movimiento_id: 'v1', cuenta_gasto_id: 'gasto' }],
    })
    await waitFor(() => expect(screen.getByText(/✓ 5101 · Mantenimiento menor/)).toBeTruthy())
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'warning', text: expect.stringMatching(/1 vale\(s\) por .*150\.25.*1 quedaron pendientes/),
    }))
    expect(reponer().disabled).toBe(true)
  })

  it('sin permiso se consultan los vales pero no se repone', () => {
    abrir(false)
    expect(screen.getByRole('button', { name: /Ver vales pendientes/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Reponer/ })).toBeNull()
    expect(screen.getByText(/Solo consulta/)).toBeTruthy()
  })
})
