// Contratos conectados a las compras: el flujo de excepción al aprobar/emitir, la vigencia y las RPC.
// La regla la hace cumplir el servidor (assert_contratos_compras.sql); aquí se prueba que la pantalla ofrece
// el camino correcto y NUNCA salta el rechazo del servidor.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  filas: [] as unknown[],
  filtros: [] as Array<[string, unknown]>,
}))

vi.mock('../../../lib/supabase', () => {
  const consulta: Record<string, unknown> = {}
  const encadenar = (nombre: string) => (col: string, val: unknown) => { m.filtros.push([`${nombre}:${col}`, val]); return consulta }
  consulta.select = () => consulta
  consulta.eq = encadenar('eq')
  consulta.order = () => consulta
  consulta.abortSignal = async () => ({ data: m.filas, error: null })
  return {
    supabase: {
      from: () => consulta,
      rpc: (nombre: string, params: unknown) => ({
        abortSignal: async () => m.rpc(nombre, params),
      }),
    },
    warmUpSupabase: vi.fn(),
  }
})

import {
  diaSiguiente,
  ejecutarConExcepcionContrato,
  ESTADOS_RENOVABLES,
  esContratoNoVigente,
} from '../contratosCompras'
import { contratoVigente } from '../../../types/proveedores'

const NO_VIGENTE = new Error('COMPRAS_CONTRATO_NO_VIGENTE: no se puede aprobar la orden al amparo de su contrato (no está vigente hoy)')

beforeEach(() => { m.rpc.mockReset(); m.filas = []; m.filtros = [] })

describe('contratoVigente (solo para OFRECER; el servidor decide)', () => {
  const base = { estado: 'activo', fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31' }
  it('activo y dentro de las fechas', () => expect(contratoVigente(base, '2026-06-01')).toBe(true))
  it('sin fecha final = indefinido', () => expect(contratoVigente({ ...base, fecha_fin: null }, '2030-01-01')).toBe(true))
  it('vencido por fechas aunque siga «activo»', () => expect(contratoVigente(base, '2027-01-01')).toBe(false))
  it('todavía no empieza', () => expect(contratoVigente(base, '2025-12-31')).toBe(false))
  it('suspendido, vencido, terminado, cancelado o borrador no amparan', () => {
    for (const estado of ['suspendido', 'vencido', 'terminado', 'cancelado', 'borrador']) {
      expect(contratoVigente({ ...base, estado }, '2026-06-01')).toBe(false)
    }
  })
})

describe('esContratoNoVigente', () => {
  it('reconoce el código del servidor', () => expect(esContratoNoVigente(NO_VIGENTE)).toBe(true))
  it('no confunde otros rechazos', () => {
    expect(esContratoNoVigente(new Error('COMPRAS_PROVEEDOR_NO_AUTORIZADO: suspendido'))).toBe(false)
    expect(esContratoNoVigente(null)).toBe(false)
    expect(esContratoNoVigente('COMPRAS_CONTRATO_NO_VIGENTE: x')).toBe(true)
  })
})

describe('ejecutarConExcepcionContrato', () => {
  const armar = (ejecutar: () => Promise<unknown>, over: Record<string, unknown> = {}) => ({
    ordenId: 'o1', etapa: 'aprobar' as const, puedeAutorizar: true, ejecutar,
    pedirMotivo: vi.fn().mockResolvedValue('Contrato en renovación; el servicio no puede parar'),
    autorizar: vi.fn().mockResolvedValue('exc-1'),
    ...over,
  })

  it('con contrato vigente la transición pasa sin pedir nada', async () => {
    const f = armar(vi.fn().mockResolvedValue(undefined))
    await expect(ejecutarConExcepcionContrato(f)).resolves.toBe('directa')
    expect(f.pedirMotivo).not.toHaveBeenCalled()
    expect(f.autorizar).not.toHaveBeenCalled()
  })

  it('rechazo por contrato + permiso: pide el motivo, autoriza y reintenta UNA vez', async () => {
    const ejecutar = vi.fn().mockRejectedValueOnce(NO_VIGENTE).mockResolvedValueOnce(undefined)
    const f = armar(ejecutar)
    await expect(ejecutarConExcepcionContrato(f)).resolves.toBe('excepcion')
    expect(f.pedirMotivo).toHaveBeenCalledWith(NO_VIGENTE.message)
    expect(f.autorizar).toHaveBeenCalledWith({ ordenId: 'o1', etapa: 'aprobar', motivo: 'Contrato en renovación; el servicio no puede parar' })
    expect(ejecutar).toHaveBeenCalledTimes(2)
  })

  it('SIN permiso de cambio de estado: no se ofrece la excepción y el rechazo llega tal cual', async () => {
    const ejecutar = vi.fn().mockRejectedValue(NO_VIGENTE)
    const f = armar(ejecutar, { puedeAutorizar: false })
    await expect(ejecutarConExcepcionContrato(f)).rejects.toBe(NO_VIGENTE)
    expect(f.pedirMotivo).not.toHaveBeenCalled()
    expect(f.autorizar).not.toHaveBeenCalled()
    expect(ejecutar).toHaveBeenCalledTimes(1)
  })

  it('si la persona no escribe el motivo, no se autoriza nada y el rechazo se conserva', async () => {
    const ejecutar = vi.fn().mockRejectedValue(NO_VIGENTE)
    const f = armar(ejecutar, { pedirMotivo: vi.fn().mockResolvedValue(null) })
    await expect(ejecutarConExcepcionContrato(f)).rejects.toBe(NO_VIGENTE)
    expect(f.autorizar).not.toHaveBeenCalled()
    expect(ejecutar).toHaveBeenCalledTimes(1)
  })

  it('un error que no es del contrato (proveedor suspendido, etc.) no abre la excepción', async () => {
    const otro = new Error('COMPRAS_PROVEEDOR_NO_AUTORIZADO: "X" está en estado "suspendido"')
    const f = armar(vi.fn().mockRejectedValue(otro))
    await expect(ejecutarConExcepcionContrato(f)).rejects.toBe(otro)
    expect(f.pedirMotivo).not.toHaveBeenCalled()
  })

  it('si el servidor rechaza la autorización (otra persona debe autorizar), el error se muestra y no se reintenta', async () => {
    const ejecutar = vi.fn().mockRejectedValue(NO_VIGENTE)
    const auto = new Error('COMPRAS_EXCEPCION_AUTOAUTORIZACION: quien solicita la orden no autoriza su excepción')
    const f = armar(ejecutar, { autorizar: vi.fn().mockRejectedValue(auto) })
    await expect(ejecutarConExcepcionContrato(f)).rejects.toBe(auto)
    expect(ejecutar).toHaveBeenCalledTimes(1)
  })

  it('tras autorizar, si el reintento falla de nuevo, ese error se muestra (no hay bucle)', async () => {
    const ejecutar = vi.fn().mockRejectedValue(NO_VIGENTE)
    const f = armar(ejecutar)
    await expect(ejecutarConExcepcionContrato(f)).rejects.toBe(NO_VIGENTE)
    expect(ejecutar).toHaveBeenCalledTimes(2)
    expect(f.autorizar).toHaveBeenCalledTimes(1)
  })

  it('emitir usa su propia etapa', async () => {
    const ejecutar = vi.fn().mockRejectedValueOnce(NO_VIGENTE).mockResolvedValueOnce(undefined)
    const f = armar(ejecutar, { etapa: 'emitir' })
    await ejecutarConExcepcionContrato(f)
    expect(f.autorizar).toHaveBeenCalledWith(expect.objectContaining({ etapa: 'emitir' }))
  })
})

describe('utilidades de fechas y estados', () => {
  it('diaSiguiente cruza fin de mes y de año', () => {
    expect(diaSiguiente('2026-01-31')).toBe('2026-02-01')
    expect(diaSiguiente('2026-12-31')).toBe('2027-01-01')
    expect(diaSiguiente('2028-02-28')).toBe('2028-02-29')
  })
  it('solo se renuevan contratos que ya salieron de borrador y no están cancelados', () => {
    expect([...ESTADOS_RENOVABLES]).toEqual(['activo', 'suspendido', 'vencido', 'terminado'])
  })
})

// ── Las RPC reciben exactamente lo que el servidor espera ───────────────────
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import {
  useAmpliarMontoContratoMutation,
  useContratosParaOrdenQuery,
  useExcepcionContratoMutation,
  useProrrogarContratoMutation,
  useRenovarContratoMutation,
  useSeguimientoContratoQuery,
} from '../contratosCompras'

function envoltura() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children)
}

describe('RPC de contratos y compras', () => {
  it('excepción: orden, etapa y motivo', async () => {
    m.rpc.mockResolvedValue({ data: 'exc-1', error: null })
    const { result } = renderHook(() => useExcepcionContratoMutation(), { wrapper: envoltura() })
    await act(async () => { await result.current.mutateAsync({ ordenId: 'o1', etapa: 'emitir', motivo: 'Se emite hoy; la renovación se firma esta semana' }) })
    expect(m.rpc).toHaveBeenCalledWith('compras_oc_excepcion_contrato',
      { p_orden_id: 'o1', p_etapa: 'emitir', p_motivo: 'Se emite hoy; la renovación se firma esta semana' })
  })

  it('renovar: fechas, motivo y condiciones opcionales (nulas por defecto: el servidor copia las del original)', async () => {
    m.rpc.mockResolvedValue({ data: 'nuevo', error: null })
    const { result } = renderHook(() => useRenovarContratoMutation(), { wrapper: envoltura() })
    await act(async () => { await result.current.mutateAsync({ contratoId: 'c1', fechaInicio: '2027-01-01', fechaFin: null, motivo: 'Renovación anual' }) })
    expect(m.rpc).toHaveBeenCalledWith('contrato_renovar', {
      p_contrato_id: 'c1', p_fecha_inicio: '2027-01-01', p_fecha_fin: null, p_motivo: 'Renovación anual',
      p_referencia: null, p_importe_periodico: null, p_monto_maximo: null,
    })
  })

  it('prorrogar: la nueva fecha (o indefinido) y el motivo', async () => {
    m.rpc.mockResolvedValue({ data: null, error: null })
    const { result } = renderHook(() => useProrrogarContratoMutation(), { wrapper: envoltura() })
    await act(async () => { await result.current.mutateAsync({ contratoId: 'c1', fechaFin: null, motivo: 'Adenda 2' }) })
    expect(m.rpc).toHaveBeenCalledWith('contrato_prorrogar', { p_contrato_id: 'c1', p_fecha_fin: null, p_motivo: 'Adenda 2' })
  })

  it('ampliar monto: la clave de idempotencia viaja y es la MISMA en un reintento', async () => {
    m.rpc.mockResolvedValue({ data: 'amp-1', error: null })
    const { result } = renderHook(() => useAmpliarMontoContratoMutation(), { wrapper: envoltura() })
    const v = { contratoId: 'c1', incremento: 500, motivo: 'Ampliación autorizada por el comité', clave: 'clave-estable-1', documento: 'ADENDA-1' }
    await act(async () => { await result.current.mutateAsync(v) })
    await act(async () => { await result.current.mutateAsync(v) })
    expect(m.rpc).toHaveBeenNthCalledWith(1, 'contrato_ampliar_monto', {
      p_contrato_id: 'c1', p_incremento: 500, p_motivo: v.motivo, p_clave: 'clave-estable-1', p_documento: 'ADENDA-1',
    })
    expect(m.rpc.mock.calls[1]).toEqual(m.rpc.mock.calls[0])
  })

  it('seguimiento: lee la RPC del contrato y devuelve NULL tal cual cuando no hay acceso', async () => {
    m.rpc.mockResolvedValue({ data: null, error: null })
    const { result } = renderHook(() => useSeguimientoContratoQuery('c1'), { wrapper: envoltura() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
    expect(m.rpc).toHaveBeenCalledWith('compras_contrato_seguimiento', { p_contrato_id: 'c1' })
  })

  it('un rechazo del servidor llega con su mensaje', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: 'CONTRATO_AMPLIACION_CLAVE: esa clave ya registró otra ampliación distinta.' } })
    const { result } = renderHook(() => useAmpliarMontoContratoMutation(), { wrapper: envoltura() })
    await expect(result.current.mutateAsync({ contratoId: 'c1', incremento: 1, motivo: 'Motivo suficiente aquí', clave: 'clave-abc-123' }))
      .rejects.toThrow(/CONTRATO_AMPLIACION_CLAVE/)
  })

  it('contratos para una orden: del proveedor y proyecto, activos, y solo los vigentes hoy', async () => {
    m.filas = [
      { id: 'a', estado: 'activo', fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31' },
      { id: 'b', estado: 'activo', fecha_inicio: '2026-01-01', fecha_fin: '2026-02-01' },
      { id: 'c', estado: 'activo', fecha_inicio: '2026-01-01', fecha_fin: null },
    ]
    const { result } = renderHook(() => useContratosParaOrdenQuery('emp', 'proy', 'prov', '2026-06-01'), { wrapper: envoltura() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect((result.current.data ?? []).map((c) => c.id)).toEqual(['a', 'c'])
    expect(m.filtros).toEqual(expect.arrayContaining([
      ['eq:company_id', 'emp'], ['eq:project_id', 'proy'], ['eq:proveedor_id', 'prov'], ['eq:estado', 'activo'],
    ]))
  })

  it('sin proveedor o sin proyecto no consulta nada', () => {
    const { result } = renderHook(() => useContratosParaOrdenQuery('emp', 'proy', null, '2026-06-01'), { wrapper: envoltura() })
    expect(result.current.fetchStatus).toBe('idle')
  })
})
