// Pendientes de contabilización — pruebas de la PANTALLA.
//
// Qué NO se prueba acá: qué es un pendiente, su motivo, la autorización ni la
// idempotencia del reproceso. Eso vive en el servidor y lo cubre el arnés de
// PostgreSQL (supabase/tests/conta_pendientes_reproceso/) con asientos reales.
//
// Lo que sí es de la pantalla, y se fija:
//   · los cuatro estados: cargando, vacío (con y sin filtro), error con
//     reintento, y con datos;
//   · que el botón de reproceso respete el permiso de la sesión Y el que
//     devuelve el servidor por fila;
//   · que tras reprocesar se avise el resultado y se abra el asiento;
//   · que un «sigue pendiente» se muestre como aviso, no como éxito;
//   · que filtro y página viajen al servidor en vez de filtrarse en cliente.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { UserSession } from '../../../types'
import type { FacturaPendiente, RespuestaReproceso } from '../../../types/contabilidad'

const state = vi.hoisted(() => ({
  consulta: {} as Record<string, unknown>,
  params: [] as Array<Record<string, unknown>>,
  reprocesar: vi.fn(async (_id: string): Promise<unknown> => null),
  notify: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../domain/contabilidad/queries', () => ({
  PENDIENTES_POR_PAGINA: 2,
  useFacturasPendientesQuery: (p: Record<string, unknown>) => {
    state.params.push(p)
    return { refetch: state.refetch, isFetching: false, ...state.consulta }
  },
  useIntentosFacturaQuery: () => ({ data: [], isLoading: false, isError: false }),
}))
vi.mock('../../../domain/contabilidad/mutations', () => ({
  useReprocesarFacturaMutation: () => ({ mutateAsync: state.reprocesar, isPending: false }),
}))
vi.mock('../../shared/Dialog', () => ({ notify: state.notify, confirm: vi.fn() }))
vi.mock('../AsientoDetalleModal', () => ({
  AsientoDetalleModal: ({ asientoId }: { asientoId: string }) => <div role="dialog">Asiento {asientoId}</div>,
}))

import { PendientesContabilizacionTab, correccionPara } from '../PendientesContabilizacionTab'
import { SessionProvider } from '../../shared/SessionContext'
import { PermissionsProvider } from '../../shared/PermissionsContext'

const TODAS = ['platform.contabilidad.view', 'platform.contabilidad.create', 'platform.contabilidad.change_status']

function fila(over: Partial<FacturaPendiente> = {}): FacturaPendiente {
  return {
    factura_id: 'fac-1', numero_factura: 'A-100', concepto: 'Mantenimiento bomba',
    proveedor_id: 'prov-1', proveedor_nombre: 'Proveedor Uno', fecha_emision: '2026-09-10',
    monto_total: 500, moneda: 'USD', estado: 'aprobada', project_id: null,
    codigo: 'sin_cuenta', motivo: 'No hay regla aplicable y el evento «gasto_otros» no está mapeado.',
    linea_id: 'l-2', linea_numero: 2, linea_descripcion: 'Repuesto',
    ultimo_intento_at: '2026-09-20T10:00:00Z', ultimo_disparo: 'aprobacion', intentos: 1,
    puede_reprocesar: true, total_filas: 1,
    ...over,
  }
}

function montar(permisos: string[] = TODAS, onIrA = vi.fn()) {
  const session = {
    user_id: 'u1', company_id: 'c1', role: 'operator', permissions: new Set(permisos),
  } as unknown as UserSession
  render(
    <SessionProvider value={session}>
      <PermissionsProvider>
        <PendientesContabilizacionTab companyId="c1" projectId={null} monedaBase="GTQ" onIrA={onIrA} />
      </PermissionsProvider>
    </SessionProvider>,
  )
  return { onIrA }
}

beforeEach(() => {
  state.params = []
  state.consulta = { data: { filas: [fila()], total: 1 }, isLoading: false, isError: false }
  state.reprocesar.mockReset()
  state.notify.mockReset()
  state.refetch.mockReset()
})
afterEach(cleanup)

describe('PendientesContabilizacionTab — estados', () => {
  it('cargando', () => {
    state.consulta = { data: undefined, isLoading: true, isError: false }
    montar()
    expect(screen.getByText('Cargando pendientes…')).toBeTruthy()
  })

  it('vacío sin filtro: dice que todo tiene asiento', () => {
    state.consulta = { data: { filas: [], total: 0 }, isLoading: false, isError: false }
    montar()
    expect(screen.getByText('Sin pendientes de contabilización')).toBeTruthy()
  })

  it('vacío CON filtro: no afirma que no haya pendientes', () => {
    state.consulta = { data: { filas: [], total: 0 }, isLoading: false, isError: false }
    montar()
    fireEvent.click(screen.getByText('Cuenta inválida'))
    expect(screen.getByText('Nada coincide con el filtro')).toBeTruthy()
  })

  it('error: lo muestra y permite reintentar', () => {
    state.consulta = { data: undefined, isLoading: false, isError: true, error: new Error('No autorizado para ver la contabilidad.') }
    montar()
    expect(screen.getByRole('alert').textContent).toContain('No autorizado para ver la contabilidad.')
    fireEvent.click(screen.getByText('Reintentar'))
    expect(state.refetch).toHaveBeenCalledTimes(1)
  })

  it('con datos: factura, proveedor, importe, motivo tipificado, línea y último intento', () => {
    montar()
    expect(screen.getByText('Proveedor Uno')).toBeTruthy()
    expect(screen.getByText(/A-100/)).toBeTruthy()
    const tabla = within(screen.getByRole('table'))
    expect(tabla.getByText('Sin cuenta')).toBeTruthy()
    expect(tabla.getByText('Línea 2')).toBeTruthy()
    expect(screen.getByText(/gasto_otros/)).toBeTruthy()
    expect(screen.getByText('Aprobación')).toBeTruthy()
  })
})

describe('PendientesContabilizacionTab — permisos', () => {
  it('con permiso de crear y publicar, ofrece reprocesar', () => {
    montar()
    expect(screen.getByRole('button', { name: 'Reprocesar' })).toBeTruthy()
  })

  it('sólo con ver: NO ofrece reprocesar y lo explica', () => {
    montar(['platform.contabilidad.view'])
    expect(screen.queryByRole('button', { name: 'Reprocesar' })).toBeNull()
    expect(screen.getByText(/no reprocesarlos/)).toBeTruthy()
  })

  it('si el SERVIDOR dice que no puede, tampoco se ofrece aunque la sesión crea que sí', () => {
    state.consulta = { data: { filas: [fila({ puede_reprocesar: false })], total: 1 }, isLoading: false, isError: false }
    montar()
    expect(screen.queryByRole('button', { name: 'Reprocesar' })).toBeNull()
  })
})

describe('PendientesContabilizacionTab — reproceso', () => {
  it('éxito: avisa con el folio y abre el asiento generado', async () => {
    const r: RespuestaReproceso = {
      resultado: 'contabilizada', codigo: null, motivo: null, origen_linea_id: null,
      asiento_id: 'as-9', asiento_numero: 42, asiento_estado: 'publicado', intento_id: 'i-1',
    }
    state.reprocesar.mockResolvedValue(r)
    montar()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reprocesar' })) })
    expect(state.reprocesar).toHaveBeenCalledWith('fac-1')
    expect(state.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', text: expect.stringContaining('#42') }))
    expect(screen.getByRole('dialog').textContent).toContain('as-9')
  })

  it('sigue pendiente: se muestra como AVISO con el motivo, no como éxito', async () => {
    state.reprocesar.mockResolvedValue({
      resultado: 'pendiente', codigo: 'configuracion_incompleta',
      motivo: 'Falta el mapeo del evento «cxp_proveedores».', origen_linea_id: null,
      asiento_id: null, asiento_numero: null, asiento_estado: null, intento_id: 'i-2',
    })
    montar()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reprocesar' })) })
    expect(state.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'warning', title: 'Configuración incompleta', text: expect.stringContaining('cxp_proveedores'),
    }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('rechazo del servidor: se informa como error', async () => {
    state.reprocesar.mockRejectedValue(new Error('No autorizado para contabilizar facturas.'))
    montar()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reprocesar' })) })
    expect(state.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'error', text: 'No autorizado para contabilizar facturas.',
    }))
  })
})

describe('PendientesContabilizacionTab — servidor y navegación', () => {
  it('el filtro por motivo y la página viajan al servidor', () => {
    state.consulta = { data: { filas: [fila(), fila({ factura_id: 'fac-2' })], total: 5 }, isLoading: false, isError: false }
    montar()
    fireEvent.click(screen.getByText('Configuración incompleta'))
    expect(state.params.at(-1)).toMatchObject({ codigo: 'configuracion_incompleta', pagina: 0 })
    fireEvent.click(screen.getByText('Siguiente'))
    expect(state.params.at(-1)).toMatchObject({ codigo: 'configuracion_incompleta', pagina: 1 })
    expect(screen.getByText('Página 2 de 3')).toBeTruthy()
  })

  it('«corregir» lleva a la pantalla autorizada según el motivo', () => {
    const { onIrA } = montar()
    fireEvent.click(screen.getByText('Configurar cuenta'))
    expect(onIrA).toHaveBeenCalledWith('reglas')
    expect(correccionPara('cuenta_invalida')?.destino).toBe('catalogo')
    expect(correccionPara('configuracion_incompleta')?.destino).toBe('configuracion')
    expect(correccionPara('periodo_cerrado')).toBeNull()
  })
})
