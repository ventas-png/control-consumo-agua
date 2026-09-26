// Estado de cuenta por auxiliar y por unidad — pruebas de la PANTALLA.
//
// Qué NO se prueba acá: saldos, totales, qué queda fuera del saldo, la
// conciliación, la autorización ni el aislamiento. Todo eso lo calcula el
// servidor y lo cubre el arnés supabase/tests/conta_estado_cuenta contra un
// PostgreSQL real.
//
// Lo que sí es de la pantalla, y se fija:
//   · que sin sujeto (o con un rango invertido) no se consulta;
//   · que el sujeto, el rango y la página viajen al servidor;
//   · que el resumen se muestre TAL CUAL llega (la pantalla no suma filas);
//   · que principal y mora, reversos y documentos fuera del saldo se
//     distingan, y que lo de fuera del saldo no se mezcle con el saldo;
//   · que la conciliación se pida a demanda, con el corte del rango.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type {
  ConciliacionEstadoCuenta,
  DocumentoFueraDeSaldo,
  EstadoCuenta,
  MovimientoEstadoCuenta,
} from '../../../types/contabilidad'

const state = vi.hoisted(() => ({
  estado: {} as Record<string, unknown>,
  fuera: {} as Record<string, unknown>,
  conciliacion: {} as Record<string, unknown>,
  pEstado: [] as Array<Record<string, unknown>>,
  pFuera: [] as Array<Record<string, unknown>>,
  pConciliacion: [] as Array<Record<string, unknown>>,
  refetch: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../domain/contabilidad/queries', () => ({
  ESTADO_CUENTA_POR_PAGINA: 2,
  FUERA_DE_SALDO_POR_PAGINA: 20,
  useAuxiliaresQuery: () => ({
    data: [
      { cliente_id: 'cli-1', cliente_nombre: 'Cliente Uno', cliente_codigo: null, auxiliar_id: 'ax-1', codigo: 'AUX-00001', activo: true },
      { cliente_id: 'cli-2', cliente_nombre: 'Cliente Dos', cliente_codigo: null, auxiliar_id: null, codigo: null, activo: null },
    ],
  }),
  useUnidadesLedgerQuery: () => ({ data: [{ id: 'u-1', nombre: 'Apto 101' }] }),
  useEstadoCuentaQuery: (p: Record<string, unknown>) => {
    state.pEstado.push(p)
    return { refetch: state.refetch, ...state.estado }
  },
  useEstadoCuentaFueraQuery: (p: Record<string, unknown>) => {
    state.pFuera.push(p)
    return state.fuera
  },
  useEstadoCuentaConciliacionQuery: (p: Record<string, unknown>) => {
    state.pConciliacion.push(p)
    return p.enabled ? state.conciliacion : {}
  },
}))
// El panel de saldos a favor tiene sus propias pruebas (saldosFavor.test.tsx).
vi.mock('../SaldosFavorPanel', () => ({ SaldosFavorPanel: () => <div data-testid="saldos-favor" /> }))
vi.mock('../AsientoDetalleModal', () => ({
  AsientoDetalleModal: ({ asientoId }: { asientoId: string }) => <div role="dialog">Asiento {asientoId}</div>,
}))

import { EstadoCuentaTab, marcaReverso, rangoInvalido } from '../EstadoCuentaTab'

function mov(over: Partial<MovimientoEstadoCuenta> = {}): MovimientoEstadoCuenta {
  return {
    n: 1, linea_id: 'l-1', asiento_id: 'as-1', asiento_numero: 11, fecha: '2026-02-10', origen: 'automatico',
    documento_tabla: 'cuotas_condominio', documento_id: 'k-1', evento: 'cuota_emitida',
    documento: 'Cuota K1 2026-01', concepto: 'Cuota K1', descripcion: null, tipo_cargo: 'mantenimiento',
    componente: 'principal', cuota_id: null, cuenta_id: 'c-101', cuenta_codigo: '1-CXC-RES', cuenta_nombre: 'CxC residentes',
    unidad_id: 'u-1', unidad_nombre: 'Apto 101', auxiliar_id: 'cli-1', auxiliar_nombre: 'Cliente Uno',
    es_reverso: false, reversa_de_id: null, reversa_de_numero: null,
    reversado_por_id: null, reversado_por_numero: null, reversado_por_fecha: null,
    cargo: 100, abono: 0, saldo: 100,
    ...over,
  }
}

function datos(over: Partial<EstadoCuenta> = {}): EstadoCuenta {
  return {
    sujeto: { tipo: 'cliente', id: 'cli-1', nombre: 'Cliente Uno', codigo_auxiliar: 'AUX-00001' },
    project_id: 'p-1', desde: null, hasta: null,
    // A propósito, el resumen NO es la suma de las filas de la página: la
    // pantalla tiene que mostrar el del servidor.
    resumen: { saldo_inicial: 20, cargos: 655.35, abonos: 510, saldo_final: 145.35, movimientos: 5 },
    por_tipo: [
      { tipo_cargo: 'mantenimiento', saldo_inicial: 0, cargos: 500, abonos: 380, saldo_final: 120 },
      { tipo_cargo: 'recargo_mora', saldo_inicial: 0, cargos: 30, abonos: 30, saldo_final: 0 },
    ],
    fuera_de_saldo: [{ clase: 'borrador', naturaleza: 'cargo', documentos: 1, monto: 60 }],
    limite: 2, offset: 0,
    movimientos: [
      mov({ n: 1, linea_id: 'l-1', documento_tabla: 'pagos', documento: 'Pago efectivo · cuota K1 2026-01', tipo_cargo: 'recargo_mora', componente: 'mora', cargo: 0, abono: 10, saldo: 90 }),
      mov({ n: 2, linea_id: 'l-2', documento_tabla: 'pagos', documento: 'Pago efectivo · cuota K1 2026-01', componente: 'principal', cargo: 0, abono: 50, saldo: 40,
            reversado_por_id: 'as-9', reversado_por_numero: 99, reversado_por_fecha: '2026-09-25' }),
    ],
    ...over,
  }
}

function fueraFila(over: Partial<DocumentoFueraDeSaldo> = {}): DocumentoFueraDeSaldo {
  return {
    clase: 'pendiente', naturaleza: 'abono', origen_tabla: 'pagos', origen_id: 'pg-5', evento: 'pago_contabilizado',
    fecha: '2026-06-20', concepto: 'Pago efectivo · SINT K4', tipo_cargo: 'mantenimiento', unidad_id: 'u-2',
    unidad_nombre: 'Apto 102', responsable_id: 'cli-1', responsable_nombre: 'Cliente Uno', monto: 100,
    estado_actual: 'verificado', codigo: 'excede_saldo', motivo: 'El cobro excede el saldo de la cuota.',
    asiento_id: null, asiento_numero: null, asiento_fecha: null, limitacion: null, total_filas: 1,
    ...over,
  }
}

function montar(projectId: string | null = 'p-1') {
  render(<EstadoCuentaTab companyId="c1" projectId={projectId} monedaBase="GTQ" />)
}

function elegirCliente(id = 'cli-1') {
  fireEvent.change(screen.getByLabelText('Auxiliar'), { target: { value: id } })
}

const ultimo = <T,>(xs: T[]) => xs[xs.length - 1]

beforeEach(() => {
  state.pEstado = []
  state.pFuera = []
  state.pConciliacion = []
  state.estado = { data: datos(), isLoading: false, isError: false }
  state.fuera = { data: { filas: [fueraFila()], total: 1 }, isLoading: false, isError: false }
  state.conciliacion = {
    data: {
      corte: null, saldo_contable: 160.35, saldo_documentos: 145.35, diferencia: 15, cuadra: false,
      por_cuenta: [{ cuenta_id: 'c-101', codigo: '1-CXC-RES', nombre: 'CxC', saldo: 160.35 }],
      total_discrepancias: 1,
      discrepancias: [{ clase: 'sin_documento', origen_tabla: null, origen_id: null, asiento_id: 'as-m', asiento_numero: 77, contable: 15, documentos: 0, diferencia: 15 }],
    } satisfies ConciliacionEstadoCuenta,
    isLoading: false, isError: false,
  }
  state.refetch.mockReset()
})
afterEach(cleanup)

describe('EstadoCuentaTab', () => {
  it('sin sujeto no consulta: pide elegir un auxiliar', () => {
    montar()
    expect(screen.getByText('Elige un auxiliar')).toBeTruthy()
    expect(ultimo(state.pEstado).sujeto).toBeNull()
    expect(ultimo(state.pFuera).sujeto).toBeNull()
  })

  it('el auxiliar y el rango viajan al servidor', () => {
    montar()
    elegirCliente()
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-02-01' } })
    fireEvent.change(screen.getByLabelText('Hasta (corte)'), { target: { value: '2026-03-31' } })
    const p = ultimo(state.pEstado)
    expect(p.sujeto).toEqual({ tipo: 'cliente', id: 'cli-1' })
    expect(p.desde).toBe('2026-02-01')
    expect(p.hasta).toBe('2026-03-31')
    expect(p.pagina).toBe(0)
    expect(p.projectId).toBe('p-1')
    expect(ultimo(state.pFuera).hasta).toBe('2026-03-31')
  })

  it('un rango invertido no se consulta y se avisa', () => {
    montar()
    elegirCliente()
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-05-01' } })
    fireEvent.change(screen.getByLabelText('Hasta (corte)'), { target: { value: '2026-04-01' } })
    expect(screen.getByRole('alert').textContent).toMatch(/posterior a la final/)
    expect(ultimo(state.pEstado).sujeto).toBeNull()
  })

  it('muestra el resumen del SERVIDOR, no la suma de la página', () => {
    montar()
    elegirCliente()
    const resumen = screen.getByRole('heading', { name: /Cliente Uno · AUX-00001/ }).parentElement!
    expect(within(resumen).getByText('Saldo inicial', { selector: 'dt' }).nextSibling?.textContent).toContain('20.00')
    expect(within(resumen).getByText('Cargos del período', { selector: 'dt' }).nextSibling?.textContent).toContain('655.35')
    expect(within(resumen).getByText('Saldo final', { selector: 'dt' }).nextSibling?.textContent).toContain('145.35')
    expect(screen.getByText(/5 movimientos · saldo acumulado calculado sobre todo el rango/)).toBeTruthy()
  })

  it('distingue principal y mora de un mismo cobro, y marca el reverso', () => {
    montar()
    elegirCliente()
    expect(screen.getByText('Aplicado a mora')).toBeTruthy()
    expect(screen.getByText('Aplicado a principal')).toBeTruthy()
    expect(screen.getByText(/Reversado con la póliza #99/)).toBeTruthy()
    expect(screen.getAllByText('Recargo por mora').length).toBeGreaterThan(0)
  })

  it('la paginación pide la página siguiente al servidor', () => {
    montar()
    elegirCliente()
    expect(screen.getByText('Página 1 de 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(ultimo(state.pEstado).pagina).toBe(1)
  })

  it('cambiar de sujeto o de corte vuelve a la página 1 en ESE mismo render (nunca pide la página vieja con el filtro nuevo)', () => {
    montar()
    elegirCliente()
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(ultimo(state.pEstado).pagina).toBe(1)
    const antes = state.pEstado.length
    elegirCliente('cli-2')
    const conB = state.pEstado.slice(antes).filter((p) => (p.sujeto as { id: string } | null)?.id === 'cli-2')
    expect(conB.length).toBeGreaterThan(0)
    expect(conB.every((p) => p.pagina === 0)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    const antes2 = state.pEstado.length
    fireEvent.change(screen.getByLabelText('Hasta (corte)'), { target: { value: '2026-01-31' } })
    const conCorte = state.pEstado.slice(antes2).filter((p) => p.hasta === '2026-01-31')
    expect(conCorte.length).toBeGreaterThan(0)
    expect(conCorte.every((p) => p.pagina === 0)).toBe(true)
  })

  it('la conciliación pedida no sobrevive a un cambio de corte', () => {
    montar()
    elegirCliente()
    fireEvent.click(screen.getByRole('button', { name: 'Conciliar' }))
    expect(ultimo(state.pConciliacion).enabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Hasta (corte)'), { target: { value: '2026-01-31' } })
    expect(ultimo(state.pConciliacion).enabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Conciliar' })).toBeTruthy()
  })

  it('al corte: contabilizado después, estado de HOY rotulado y limitaciones visibles', () => {
    state.estado = {
      data: datos({
        hasta: '2026-01-31',
        fuera_de_saldo: [{ clase: 'contabilizado_despues', naturaleza: 'cargo', documentos: 1, monto: 100 }],
        limitaciones: [{ codigo: 'rechazo_sin_fecha', documentos: 1, monto: 80, descripcion: 'Cobros HOY rechazados que nunca tuvieron asiento.' }],
      }),
      isLoading: false, isError: false,
    }
    state.fuera = {
      data: {
        filas: [
          fueraFila({ clase: 'contabilizado_despues', naturaleza: 'cargo', origen_tabla: 'cuotas_condominio', origen_id: 'k-20',
                      estado_actual: 'pendiente', codigo: 'contabilizado_despues_del_corte',
                      motivo: 'Contabilizado con fecha 2026-02-03, posterior al corte.', asiento_id: 'as-20', asiento_numero: 20, asiento_fecha: '2026-02-03' }),
          fueraFila({ clase: 'cobro_sin_vinculo', naturaleza: 'cargo', origen_tabla: 'cargos_adicionales_unidad', origen_id: 'ca-21',
                      estado_actual: 'pagado', limitacion: 'estado_actual_sin_fecha', monto: 12 }),
        ],
        total: 2,
      },
      isLoading: false, isError: false,
    }
    montar()
    elegirCliente()
    fireEvent.change(screen.getByLabelText('Hasta (corte)'), { target: { value: '2026-01-31' } })
    const seccion = screen.getByRole('heading', { name: 'Fuera del saldo contable' }).parentElement!
    expect(within(seccion).getAllByText(/Contabilizado después del corte/).length).toBeGreaterThan(0)
    expect(within(seccion).getByRole('button', { name: /Póliza #20 del/ })).toBeTruthy()
    expect(within(seccion).getByRole('columnheader', { name: 'Estado hoy' })).toBeTruthy()
    expect(within(seccion).getByText('pagado')).toBeTruthy()
    expect(within(seccion).getByText(/Estado de hoy, sin fecha: puede no ser el del corte/)).toBeTruthy()
    expect(within(seccion).getByRole('note', { name: 'Limitaciones del corte' }).textContent).toContain('Cobros HOY rechazados')
  })

  it('un cobro verificado sin fecha registrada se muestra «Sin fecha», rotulado, sin inventar una', () => {
    state.fuera = {
      data: {
        filas: [fueraFila({ fecha: null, limitacion: 'verificacion_sin_fecha',
                            motivo: 'Sin asiento. Se reactivó el 2026-08-10 y después se verificó sin fecha registrada: se lista por su estado de hoy.' })],
        total: 1,
      },
      isLoading: false, isError: false,
    }
    montar()
    elegirCliente()
    const seccion = screen.getByRole('heading', { name: 'Fuera del saldo contable' }).parentElement!
    const fila = within(seccion).getByText(/se verificó sin fecha registrada/).closest('tr')!
    expect(within(fila).getByText('Sin fecha')).toBeTruthy()
    expect(within(fila).getByText(/Estado de hoy, sin fecha: puede no ser el del corte/)).toBeTruthy()
  })

  it('lo de fuera del saldo se lista aparte, con su clase y motivo, y el cobro con signo menos', () => {
    montar()
    elegirCliente()
    const seccion = screen.getByRole('heading', { name: 'Fuera del saldo contable' }).parentElement!
    expect(within(seccion).getByText(/Asiento en borrador · cargos: 1/)).toBeTruthy()
    expect(within(seccion).getByText('Pendiente de contabilizar')).toBeTruthy()
    expect(within(seccion).getByText('El cobro excede el saldo de la cuota.')).toBeTruthy()
    expect(within(seccion).getByText(/−GTQ 100\.00/)).toBeTruthy()
  })

  it('la conciliación se pide a demanda, con el corte del rango, y muestra las discrepancias', () => {
    montar()
    elegirCliente()
    fireEvent.change(screen.getByLabelText('Hasta (corte)'), { target: { value: '2026-08-31' } })
    expect(ultimo(state.pConciliacion).enabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Conciliar' }))
    const p = ultimo(state.pConciliacion)
    expect(p.enabled).toBe(true)
    expect(p.corte).toBe('2026-08-31')
    expect(screen.getByText('No cuadra')).toBeTruthy()
    expect(screen.getByText(/Movimiento contable sin documento/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Póliza #77' }))
    expect(screen.getByRole('dialog').textContent).toContain('as-m')
  })

  it('por unidad: la columna muestra el responsable de cada movimiento', () => {
    montar()
    fireEvent.click(screen.getByRole('radio', { name: 'Por unidad' }))
    fireEvent.change(screen.getByLabelText('Unidad'), { target: { value: 'u-1' } })
    expect(ultimo(state.pEstado).sujeto).toEqual({ tipo: 'unidad', id: 'u-1' })
    expect(screen.getByRole('columnheader', { name: 'Responsable' })).toBeTruthy()
  })

  it('en la contabilidad de la empresa no hay estado por unidad', () => {
    montar(null)
    expect((screen.getByRole('radio', { name: 'Por unidad' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/no tiene unidades/)).toBeTruthy()
  })

  it('un error del servidor se muestra con reintento', () => {
    state.estado = { data: undefined, isLoading: false, isError: true, error: new Error('No autorizado para ver la contabilidad.') }
    montar()
    elegirCliente()
    expect(screen.getByRole('alert').textContent).toContain('No autorizado para ver la contabilidad.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(state.refetch).toHaveBeenCalledTimes(1)
  })
})

describe('ayudas puras', () => {
  it('rangoInvalido', () => {
    expect(rangoInvalido('2026-05-01', '2026-04-01')).toBe(true)
    expect(rangoInvalido('2026-04-01', '2026-04-01')).toBe(false)
    expect(rangoInvalido('', '2026-04-01')).toBe(false)
  })
  it('marcaReverso', () => {
    const base = { es_reverso: false, reversa_de_numero: null, reversado_por_id: null, reversado_por_numero: null, reversado_por_fecha: null }
    expect(marcaReverso(base)).toBeNull()
    expect(marcaReverso({ ...base, es_reverso: true, reversa_de_numero: 5 })).toBe('Reverso de la póliza #5')
    expect(marcaReverso({ ...base, reversado_por_id: 'x', reversado_por_numero: 9 })).toBe('Reversado con la póliza #9')
    // Reverso con fecha posterior al corte: no se presenta como reverso de la fila.
    expect(marcaReverso({ ...base, reversado_despues_del_corte: true, reversado_despues_fecha: null })).toBe('Reversado después del corte')
  })
})
