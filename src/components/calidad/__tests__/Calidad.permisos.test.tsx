// Permisos de Calidad (agua.calidad.*): crear fuentes y registrar análisis
// exige crear; editar y activar/desactivar fuentes exige editar. Consultar el
// historial, sus detalles y exportar no cambia.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { Empresa, FuenteAgua, RegistroCalidad } from '../../../types'

const mocks = vi.hoisted(() => ({
  fetchFuentes: vi.fn(async () => [] as FuenteAgua[]),
  fetchRegistrosCalidad: vi.fn(async () => [] as RegistroCalidad[]),
  getReporteCalidadSignedUrl: vi.fn(async () => ({ url: null, error: null })),
  createFuente: vi.fn<(payload: Record<string, unknown>) => Promise<{ error: string | null }>>(async () => ({ error: null })),
  updateFuente: vi.fn<(id: string, payload: Record<string, unknown>) => Promise<{ error: string | null }>>(async () => ({ error: null })),
  setFuenteActiva: vi.fn(async () => ({ error: null })),
  createRegistroCalidad: vi.fn(async () => ({ error: null })),
  uploadReporteCalidad: vi.fn(async () => ({ error: null })),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../domain/calidad/queries', () => ({
  fetchFuentes: mocks.fetchFuentes,
  fetchRegistrosCalidad: mocks.fetchRegistrosCalidad,
  getReporteCalidadSignedUrl: mocks.getReporteCalidadSignedUrl,
}))
vi.mock('../../../domain/calidad/mutations', () => ({
  createFuente: mocks.createFuente,
  updateFuente: mocks.updateFuente,
  setFuenteActiva: mocks.setFuenteActiva,
  createRegistroCalidad: mocks.createRegistroCalidad,
  uploadReporteCalidad: mocks.uploadReporteCalidad,
}))
vi.mock('../../shared/Dialog', () => ({ notify: mocks.notify }))

const { CalidadSection } = await import('../CalidadSection')

const FUENTE: FuenteAgua = {
  id: 'f1aaaaaa-0000', identificador: 'FA-001', nombre: 'Piscina principal', tipo_agua: 'piscina',
  descripcion: 'Junto al club', activo: true, created_at: '2026-01-01', frecuencia_muestreo_dias: 15,
}

const REGISTRO: RegistroCalidad = {
  id: 'r1', fuente_id: FUENTE.id, fecha: '2026-10-01T15:00:00Z',
  parametros: { pH: 7.4, cloro_libre: 2 }, cumplimiento: { pH: true, cloro_libre: true }, cumple_total: true,
  observaciones: 'Muestra de la mañana',
  fuentes_agua: { identificador: 'FA-001', nombre: 'Piscina principal', tipo_agua: 'piscina' },
}

function renderCalidad(props: Partial<Parameters<typeof CalidadSection>[0]> = {}) {
  return render(
    <CalidadSection
      fuentesAgua={[FUENTE]}
      registrosCalidad={[REGISTRO]}
      empresa={{ id: 'emp1', nombre: 'Agua SA' } as Empresa}
      userId="u1"
      onFuentesUpdated={() => {}}
      onRegistrosCalidadUpdated={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('Calidad — permisos', () => {
  it('solo consulta: sin alta de fuentes, sin pestaña de análisis y sin acciones por fuente', () => {
    renderCalidad({ canCreate: false, canEdit: false })
    expect(screen.queryByRole('button', { name: '+ Nueva fuente' })).toBeNull()
    expect(screen.queryByRole('tab', { name: /Nuevo Análisis/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Desactivar/ })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Acciones' })).toBeNull()

    // El historial sigue disponible para consultar y exportar.
    fireEvent.click(screen.getByRole('tab', { name: /Historial Calidad/ }))
    expect(screen.getByRole('button', { name: /Exportar PDF/ })).toBeTruthy()
    expect(screen.getByText('Muestra de la mañana')).toBeTruthy()
  })

  it('con crear pero sin editar: da de alta fuentes y análisis, pero no edita ni desactiva', async () => {
    renderCalidad({ canCreate: true, canEdit: false })
    expect(screen.getByRole('tab', { name: /Nuevo Análisis/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Desactivar/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Nueva fuente' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Identificador *'), { target: { value: 'FA-002' } })
    fireEvent.change(within(dialog).getByLabelText('Nombre / Descripción *'), { target: { value: 'Pozo norte' } })
    fireEvent.change(within(dialog).getByLabelText('Tipología de Agua *'), { target: { value: 'potable' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.createFuente).toHaveBeenCalledTimes(1))
  })

  it('con editar pero sin crear: edita y desactiva, pero no da de alta ni registra análisis', async () => {
    renderCalidad({ canCreate: false, canEdit: true })
    expect(screen.queryByRole('button', { name: '+ Nueva fuente' })).toBeNull()
    expect(screen.queryByRole('tab', { name: /Nuevo Análisis/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Desactivar/ }))
    await waitFor(() => expect(mocks.setFuenteActiva).toHaveBeenCalledWith(FUENTE.id, false))

    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
