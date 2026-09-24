// Cargos pendientes de contabilización — pruebas de la PANTALLA.
//
// Qué NO se prueba acá: qué es un pendiente, su motivo, la autorización, la
// idempotencia ni el aislamiento. Eso vive en el servidor y lo cubre el arnés
// supabase/tests/conta_contabilizacion_cargos contra un PostgreSQL real.
//
// Lo que sí es de la pantalla, y se fija:
//   · los estados: cargando, vacío (con y sin filtro), error con reintento, y
//     con datos (evento, unidad, responsable, motivo);
//   · que «Configurar tipo» aparezca sólo para lo que se corrige allí;
//   · que el botón de reproceso respete el permiso de la sesión Y el de la fila;
//   · que tras reprocesar se avise el PEOR resultado de los eventos y se abra
//     el asiento nuevo;
//   · que filtro y búsqueda viajen al servidor.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { UserSession } from '../../../types'
import type { CargoPendiente, RespuestaReprocesoCargo } from '../../../types/contabilidad'

const state = vi.hoisted(() => ({
  consulta: {} as Record<string, unknown>,
  params: [] as Array<Record<string, unknown>>,
  reprocesar: vi.fn(async (_doc: unknown): Promise<unknown> => []),
  notify: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../domain/contabilidad/queries', () => ({
  PENDIENTES_POR_PAGINA: 20,
  useCargosPendientesQuery: (p: Record<string, unknown>) => {
    state.params.push(p)
    return { refetch: state.refetch, isFetching: false, ...state.consulta }
  },
}))
vi.mock('../../../domain/contabilidad/mutations', () => ({
  useReprocesarCargoMutation: () => ({ mutateAsync: state.reprocesar, isPending: false }),
}))
vi.mock('../../shared/Dialog', () => ({ notify: state.notify, confirm: vi.fn() }))
vi.mock('../AsientoDetalleModal', () => ({
  AsientoDetalleModal: ({ asientoId }: { asientoId: string }) => <div role="dialog">Asiento {asientoId}</div>,
}))

import { CargosPendientesTab, mensajeReprocesoCargo, seCorrigeEnTiposCargo } from '../CargosPendientesTab'
import { SessionProvider } from '../../shared/SessionContext'
import { PermissionsProvider } from '../../shared/PermissionsContext'

const TODAS = ['platform.contabilidad.view', 'platform.contabilidad.create', 'platform.contabilidad.change_status']

function fila(over: Partial<CargoPendiente> = {}): CargoPendiente {
  return {
    origen_tabla: 'cuotas_condominio', origen_id: 'cuota-1', evento: 'cuota_emitida',
    concepto: 'Mantenimiento 2026-10', unidad_id: 'u-1', unidad_nombre: 'Apto 101',
    responsable_id: 'cli-1', responsable_nombre: 'Cliente Uno', tipo_cargo: 'mantenimiento',
    fecha: '2026-10-01', monto: 100, project_id: 'p-1',
    codigo: 'sin_configuracion', motivo: 'Falta la configuración contable del tipo «Mantenimiento».',
    ultimo_intento_at: '2026-10-01T10:00:00Z', ultimo_disparo: 'emision', intentos: 1,
    puede_reprocesar: true, total_filas: 1,
    ...over,
  }
}

function respuesta(over: Partial<RespuestaReprocesoCargo> = {}): RespuestaReprocesoCargo {
  return {
    evento: 'cuota_emitida', resultado: 'contabilizada', codigo: null, motivo: null,
    asiento_id: 'as-1', asiento_numero: 7, asiento_estado: 'publicado', intento_id: 'i-1',
    ...over,
  }
}

function montar(permisos: string[] = TODAS) {
  const onIrATiposCargo = vi.fn()
  const session = {
    user_id: 'u1', company_id: 'c1', role: 'operator', permissions: new Set(permisos),
  } as unknown as UserSession
  render(
    <SessionProvider value={session}>
      <PermissionsProvider>
        <CargosPendientesTab companyId="c1" projectId="p-1" monedaBase="GTQ" onIrATiposCargo={onIrATiposCargo} />
      </PermissionsProvider>
    </SessionProvider>,
  )
  return { onIrATiposCargo }
}

beforeEach(() => {
  state.params = []
  state.consulta = { data: { filas: [fila()], total: 1 }, isLoading: false, isError: false }
  state.reprocesar.mockReset()
  state.notify.mockReset()
  state.refetch.mockReset()
})
afterEach(cleanup)

describe('CargosPendientesTab', () => {
  it('muestra el cargo con su evento, unidad, responsable y motivo', () => {
    montar()
    expect(screen.getByText('Mantenimiento 2026-10')).toBeTruthy()
    expect(screen.getByText('Cuota')).toBeTruthy()
    expect(screen.getByText('Apto 101')).toBeTruthy()
    expect(screen.getByText('Cliente Uno')).toBeTruthy()
    expect(screen.getByText('Sin configuración del tipo')).toBeTruthy()
    expect(screen.getByText(/Falta la configuración contable/)).toBeTruthy()
  })

  it('un cargo sin responsable lo dice, y no ofrece «Configurar tipo»', () => {
    state.consulta = {
      data: { filas: [fila({ codigo: 'sin_responsable', responsable_id: null, responsable_nombre: null, motivo: 'Asigna el responsable.' })], total: 1 },
      isLoading: false, isError: false,
    }
    montar()
    expect(screen.getAllByText('Sin responsable').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Configurar tipo' })).toBeNull()
  })

  it('«Configurar tipo» lleva a la pestaña de tipos de cargo', () => {
    const { onIrATiposCargo } = montar()
    fireEvent.click(screen.getByRole('button', { name: 'Configurar tipo' }))
    expect(onIrATiposCargo).toHaveBeenCalledTimes(1)
  })

  it('reprocesar envía origen e id, avisa y abre la póliza nueva', async () => {
    state.reprocesar.mockResolvedValueOnce([respuesta()])
    montar()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reprocesar' })) })
    expect(state.reprocesar).toHaveBeenCalledWith({ origen_tabla: 'cuotas_condominio', origen_id: 'cuota-1' })
    expect(state.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Cargo contabilizado' }))
    expect(screen.getByRole('dialog').textContent).toContain('as-1')
  })

  it('si el servidor rechaza, se avisa el error y la fila sigue', async () => {
    state.reprocesar.mockRejectedValueOnce(new Error('No autorizado para contabilizar cargos.'))
    montar()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reprocesar' })) })
    expect(state.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'No autorizado para contabilizar cargos.' }))
    expect(screen.getByText('Mantenimiento 2026-10')).toBeTruthy()
  })

  it('sin permiso de crear y publicar no ofrece reprocesar, y lo explica', () => {
    montar(['platform.contabilidad.view'])
    expect(screen.queryByRole('button', { name: 'Reprocesar' })).toBeNull()
    expect(screen.getByText(/no reprocesarlos/)).toBeTruthy()
  })

  it('respeta la marca por fila del servidor aunque la sesión tenga permiso', () => {
    state.consulta = { data: { filas: [fila({ puede_reprocesar: false })], total: 1 }, isLoading: false, isError: false }
    montar()
    expect(screen.queryByRole('button', { name: 'Reprocesar' })).toBeNull()
  })

  it('vacío, cargando y error con reintento', () => {
    state.consulta = { data: { filas: [], total: 0 }, isLoading: false, isError: false }
    montar()
    expect(screen.getByText('Sin cargos pendientes')).toBeTruthy()
    cleanup()

    state.consulta = { data: undefined, isLoading: true, isError: false }
    montar()
    expect(screen.getByText('Cargando cargos pendientes…')).toBeTruthy()
    cleanup()

    state.consulta = { data: undefined, isLoading: false, isError: true, error: new Error('boom') }
    montar()
    expect(screen.getByRole('alert').textContent).toContain('boom')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(state.refetch).toHaveBeenCalledTimes(1)
  })

  it('el filtro por motivo viaja al servidor', () => {
    montar()
    fireEvent.click(screen.getByRole('radio', { name: 'Sin responsable' }))
    expect(state.params.at(-1)).toMatchObject({ codigo: 'sin_responsable', pagina: 0, projectId: 'p-1' })
  })
})

describe('mensajeReprocesoCargo', () => {
  it('lo que sigue pendiente pesa más que lo ya contabilizado', () => {
    const m = mensajeReprocesoCargo([
      respuesta({ resultado: 'ya_contabilizada' }),
      respuesta({ evento: 'cuota_mora', resultado: 'pendiente', codigo: 'sin_configuracion', motivo: 'Falta recargo_mora.', asiento_id: null }),
    ])
    expect(m).toEqual({ variant: 'warning', title: 'Sin configuración del tipo', text: 'Falta recargo_mora.' })
  })

  it('una póliza nueva se nombra por su folio', () => {
    expect(mensajeReprocesoCargo([respuesta({ asiento_numero: 12 })]).text).toBe('Se generó la póliza #12.')
  })

  it('nada nuevo → «ya estaba contabilizado»', () => {
    expect(mensajeReprocesoCargo([respuesta({ resultado: 'ya_contabilizada' })]).title).toBe('Ya estaba contabilizado')
  })

  it('período cerrado se explica como bloqueo', () => {
    const m = mensajeReprocesoCargo([respuesta({ resultado: 'bloqueada', codigo: 'periodo_cerrado', motivo: 'El período 2026-02 está cerrado.', asiento_id: null })])
    expect(m.title).toBe('Período cerrado')
  })
})

describe('seCorrigeEnTiposCargo', () => {
  it('sólo configuración y cuenta inválida se corrigen en Tipos de cargo', () => {
    expect(seCorrigeEnTiposCargo('sin_configuracion')).toBe(true)
    expect(seCorrigeEnTiposCargo('cuenta_invalida')).toBe(true)
    expect(seCorrigeEnTiposCargo('sin_responsable')).toBe(false)
    expect(seCorrigeEnTiposCargo('periodo_cerrado')).toBe(false)
  })
})

describe('cobros pendientes (20261002000100)', () => {
  it('un cobro sin devengo se muestra como cobro, con su motivo, y se reprocesa por su id', async () => {
    state.consulta = {
      data: {
        filas: [fila({
          origen_tabla: 'pagos', origen_id: 'pago-1', evento: 'pago_contabilizado',
          concepto: 'Cobro efectivo — Mantenimiento 2026-10', tipo_cargo: null,
          codigo: 'devengo_pendiente', motivo: 'Esta cuota todavía no está contabilizada.',
        })],
        total: 1,
      },
      isLoading: false, isError: false,
    }
    state.reprocesar.mockResolvedValueOnce([respuesta({ evento: 'pago_contabilizado', asiento_id: 'as-9', asiento_numero: 9 })])
    montar()
    expect(screen.getByText('Cobro')).toBeTruthy()
    expect(screen.getByText('Cuota sin contabilizar')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Configurar tipo' })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reprocesar' })) })
    expect(state.reprocesar).toHaveBeenCalledWith({ origen_tabla: 'pagos', origen_id: 'pago-1' })
  })

  it('el excedente se filtra por su motivo en el servidor', () => {
    montar()
    fireEvent.click(screen.getByRole('radio', { name: 'Excede el saldo' }))
    expect(state.params.at(-1)).toMatchObject({ codigo: 'excede_saldo', pagina: 0 })
  })

  it('reprocesar una cuota con su cobro: el cobro que sigue pendiente pesa más', () => {
    const m = mensajeReprocesoCargo([
      respuesta({ resultado: 'contabilizada' }),
      respuesta({ evento: 'pago_contabilizado', resultado: 'pendiente', codigo: 'excede_saldo', motivo: 'El cobro supera el saldo.', asiento_id: null }),
    ])
    expect(m).toEqual({ variant: 'warning', title: 'Excede el saldo de la cuota', text: 'El cobro supera el saldo.' })
  })
})
