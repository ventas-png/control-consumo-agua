// Pendientes › Otros documentos: lo que falta se ve con su nombre de pantalla,
// se va a corregirlo y se reprocesa; sin permiso, solo se ve.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AsientoOmitido } from '../../../types/contabilidad'

const h = vi.hoisted(() => ({
  filas: [] as unknown[],
  error: null as Error | null,
  permisos: { puedeCrear: true, puedeCambiarEstado: true },
  reprocesar: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify, confirm: vi.fn() }))
vi.mock('../../../domain/contabilidad/queries', () => ({
  useOmitidosQuery: () => ({ data: h.error ? undefined : h.filas, isLoading: false, isError: !!h.error, error: h.error }),
  useAsientoDetalleQuery: () => ({ data: null, isLoading: false }),
}))
vi.mock('../../../domain/contabilidad/mutations', () => ({
  useReprocesarOmitidoMutation: () => ({ mutateAsync: h.reprocesar, isPending: false }),
  usePublicarAsientoMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAnularAsientoMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  usePermisosContabilidad: () => h.permisos,
}))

import { OtrosPendientesTab, mensajeReprocesoOmitido } from '../OtrosPendientesTab'

const GASTO: AsientoOmitido = {
  id: 'o1', origen_tabla: 'gastos_condominio', origen_id: 'g1', evento: 'gasto_pagado', fecha: '2026-11-03',
  concepto: 'Gasto: Reparación de bomba', importe: 500, moneda_doc: null, codigo: 'sin_mapeo',
  motivo: 'Falta asignar cuenta a 2 evento(s) en Contabilidad › Configuración.',
  eventos_faltan: ['gasto_mantenimiento', 'compras_por_facturar'], intentos: 3,
  primer_intento: '2026-11-03T10:00:00Z', ultimo_intento: '2026-11-05T10:00:00Z',
}

function montar(extra: Partial<Parameters<typeof OtrosPendientesTab>[0]> = {}) {
  return render(<OtrosPendientesTab companyId="c1" projectId="p1" monedaBase="GTQ" {...extra} />)
}

describe('OtrosPendientesTab', () => {
  beforeEach(() => {
    h.filas = [GASTO]; h.error = null; h.permisos = { puedeCrear: true, puedeCambiarEstado: true }
    h.reprocesar.mockReset(); h.notify.mockReset()
  })
  afterEach(cleanup)

  it('sin pendientes lo dice en una línea', () => {
    h.filas = []
    montar()
    expect(screen.getByText(/Sin otros documentos pendientes/)).toBeTruthy()
  })

  it('muestra el documento con su nombre de pantalla, el motivo y QUÉ cuentas faltan, con su etiqueta de Configuración', () => {
    montar()
    expect(screen.getByText('Gasto: Reparación de bomba')).toBeTruthy()
    expect(screen.getByText('Gasto')).toBeTruthy()
    expect(screen.getByText('Sin cuenta asignada')).toBeTruthy()
    expect(screen.getByText('Gastos › Mantenimiento')).toBeTruthy()
    expect(screen.getByText('Cuenta especial › Bienes y servicios por facturar')).toBeTruthy()
    expect(screen.getByText('3 intentos')).toBeTruthy()
  })

  it('«Completar mapeo» lleva a Configuración; una cuenta inválida lleva al catálogo', () => {
    const onIrAConfiguracion = vi.fn(); const onIrACatalogo = vi.fn()
    h.filas = [GASTO, { ...GASTO, id: 'o2', codigo: 'cuenta_invalida', eventos_faltan: [], motivo: 'Cuenta de otra contabilidad.' }]
    montar({ onIrAConfiguracion, onIrACatalogo })
    fireEvent.click(screen.getByRole('button', { name: 'Completar mapeo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revisar catálogo' }))
    expect(onIrAConfiguracion).toHaveBeenCalledTimes(1)
    expect(onIrACatalogo).toHaveBeenCalledTimes(1)
  })

  it('reprocesar con la causa corregida avisa la póliza generada', async () => {
    h.reprocesar.mockResolvedValue({ resultado: 'contabilizado', codigo: null, motivo: null, asiento_id: 'a9', asiento_numero: 42 })
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Reprocesar' }))
    await waitFor(() => expect(h.reprocesar).toHaveBeenCalledWith('o1'))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success', text: 'Se generó la póliza #42.' })))
  })

  it('reprocesar sin corregir avisa el motivo vigente; un rechazo del servidor se muestra', async () => {
    h.reprocesar.mockResolvedValueOnce({ resultado: 'pendiente', codigo: 'sin_mapeo', motivo: 'Falta asignar cuenta a 1 evento(s).', asiento_id: null, asiento_numero: null })
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Reprocesar' }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'warning', title: 'Sin cuenta asignada', text: 'Falta asignar cuenta a 1 evento(s).' })))
    h.reprocesar.mockRejectedValueOnce(new Error('No autorizado para contabilizar documentos.'))
    fireEvent.click(screen.getByRole('button', { name: 'Reprocesar' }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', text: 'No autorizado para contabilizar documentos.' })))
  })

  it('sin crear Y cambiar estado no se ofrece reprocesar, y se explica', () => {
    h.permisos = { puedeCrear: true, puedeCambiarEstado: false }
    montar()
    expect(screen.queryByRole('button', { name: 'Reprocesar' })).toBeNull()
    expect(screen.getByText(/no reprocesarlos/)).toBeTruthy()
  })

  it('si la consulta falla lo dice, en vez de afirmar que no hay pendientes', () => {
    h.error = new Error('permission denied')
    montar()
    expect(screen.getByRole('alert').textContent).toMatch(/No se pudieron cargar.*permission denied/)
    expect(screen.queryByText(/Sin otros documentos pendientes/)).toBeNull()
  })
})

describe('mensajeReprocesoOmitido', () => {
  it('asentado en borrador (sin folio) remite al tipo de cambio; resuelto por otra vía es informativo', () => {
    expect(mensajeReprocesoOmitido({ resultado: 'contabilizado', codigo: null, motivo: null, asiento_id: 'a', asiento_numero: null }).text)
      .toMatch(/borrador/)
    expect(mensajeReprocesoOmitido({ resultado: 'ya_resuelto', codigo: null, motivo: 'El documento ya no está pendiente.', asiento_id: null, asiento_numero: null }))
      .toMatchObject({ variant: 'info', text: 'El documento ya no está pendiente.' })
  })
})
