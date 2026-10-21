// Calidad de agua en el teléfono: la lista de fuentes ocupa la página y el
// formulario (alta y edición) se abre en ventana; el detalle del análisis usa
// la misma ventana de la casa, a pantalla completa en el teléfono.
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

describe('Calidad — fuentes de agua en ventana', () => {
  it('la lista ocupa la página y en el teléfono cada fuente es una tarjeta', () => {
    renderCalidad()
    // El formulario ya no vive en la página.
    expect(screen.queryByLabelText('Identificador *')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()

    const tabla = screen.getByRole('table')
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    const celdaNombre = within(tabla).getByText('Piscina principal').closest('td')!
    expect(celdaNombre.getAttribute('data-label')).toBe('Nombre')
    // El ID corto se oculta en teléfonos (encabezado y celda).
    expect(within(tabla).getByRole('columnheader', { name: 'ID' }).classList.contains('table-col-secondary')).toBe(true)
    expect(within(tabla).getByText('f1aaaaaa…').closest('td')!.classList.contains('table-col-secondary')).toBe(true)
  })

  it('"+ Nueva fuente" abre la ventana a pantalla completa y guardar crea la fuente', async () => {
    const actualizadas = [FUENTE, { ...FUENTE, id: 'f2', identificador: 'FA-002' }]
    mocks.fetchFuentes.mockResolvedValueOnce(actualizadas)
    const onFuentesUpdated = vi.fn()
    renderCalidad({ onFuentesUpdated })

    fireEvent.click(screen.getByRole('button', { name: '+ Nueva fuente' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva fuente' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Identificador *'), { target: { value: 'FA-002' } })
    fireEvent.change(within(dialog).getByLabelText('Nombre / Descripción *'), { target: { value: 'Pozo norte' } })
    fireEvent.change(within(dialog).getByLabelText('Tipología de Agua *'), { target: { value: 'potable' } })
    fireEvent.change(within(dialog).getByLabelText('Frecuencia de muestreo (días)'), { target: { value: '30' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.createFuente).toHaveBeenCalledWith({
      identificador: 'FA-002', nombre: 'Pozo norte', tipo_agua: 'potable', descripcion: '', frecuencia_muestreo_dias: 30,
    }))
    expect(mocks.updateFuente).not.toHaveBeenCalled()
    await waitFor(() => expect(onFuentesUpdated).toHaveBeenCalledWith(actualizadas))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Fuente registrada' }))
  })

  it('la validación no cambia: sin identificador avisa y la ventana sigue abierta', () => {
    renderCalidad()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva fuente' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }))

    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning', text: 'El identificador es obligatorio.' }))
    expect(mocks.createFuente).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Nueva fuente' })).toBeTruthy()
  })

  it('mientras guarda no se puede cerrar', async () => {
    let terminar: (v: { error: string | null }) => void = () => {}
    mocks.createFuente.mockImplementationOnce(() => new Promise(res => { terminar = res }))
    renderCalidad()

    fireEvent.click(screen.getByRole('button', { name: '+ Nueva fuente' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Identificador *'), { target: { value: 'FA-009' } })
    fireEvent.change(within(dialog).getByLabelText('Nombre / Descripción *'), { target: { value: 'Tanque' } })
    fireEvent.change(within(dialog).getByLabelText('Tipología de Agua *'), { target: { value: 'riego' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.createFuente).toHaveBeenCalled())
    expect((within(dialog).getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeTruthy()

    terminar({ error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('editar abre la misma ventana con los datos de la fuente y actualiza', async () => {
    renderCalidad()
    fireEvent.click(screen.getByRole('button', { name: '✏️ Editar' }))

    const dialog = screen.getByRole('dialog', { name: 'Editar fuente' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect((within(dialog).getByLabelText('Identificador *') as HTMLInputElement).value).toBe('FA-001')
    expect((within(dialog).getByLabelText('Nombre / Descripción *') as HTMLInputElement).value).toBe('Piscina principal')
    expect((within(dialog).getByLabelText('Tipología de Agua *') as HTMLSelectElement).value).toBe('piscina')
    expect((within(dialog).getByLabelText('Descripción adicional') as HTMLInputElement).value).toBe('Junto al club')
    expect((within(dialog).getByLabelText('Frecuencia de muestreo (días)') as HTMLInputElement).value).toBe('15')

    fireEvent.change(within(dialog).getByLabelText('Nombre / Descripción *'), { target: { value: 'Piscina olímpica' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.updateFuente).toHaveBeenCalledWith(FUENTE.id, {
      identificador: 'FA-001', nombre: 'Piscina olímpica', tipo_agua: 'piscina', descripcion: 'Junto al club', frecuencia_muestreo_dias: 15,
    }))
    expect(mocks.createFuente).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('cancelar descarta lo escrito: la siguiente alta abre vacía', () => {
    renderCalidad()
    fireEvent.click(screen.getByRole('button', { name: '✏️ Editar' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Nueva fuente' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva fuente' })
    expect((within(dialog).getByLabelText('Identificador *') as HTMLInputElement).value).toBe('')
    expect((within(dialog).getByLabelText('Nombre / Descripción *') as HTMLInputElement).value).toBe('')
  })

  it('activar/desactivar sigue funcionando desde la lista', async () => {
    renderCalidad()
    fireEvent.click(screen.getByRole('button', { name: '⏸ Desactivar' }))
    await waitFor(() => expect(mocks.setFuenteActiva).toHaveBeenCalledWith(FUENTE.id, false))
  })
})

describe('Calidad — historial y detalle del análisis', () => {
  it('el historial pasa a tarjetas en el teléfono', () => {
    renderCalidad()
    fireEvent.click(screen.getByRole('tab', { name: /Historial Calidad/ }))
    const tabla = screen.getByRole('table')
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    expect(within(tabla).getByText('Muestra de la mañana').closest('td')!.getAttribute('data-label')).toBe('Observaciones')
  })

  it('el detalle es una ventana a pantalla completa con el mismo contenido', () => {
    renderCalidad()
    fireEvent.click(screen.getByRole('tab', { name: /Historial Calidad/ }))
    fireEvent.click(screen.getByRole('button', { name: '🔍 Detalle' }))

    const dialog = screen.getByRole('dialog', { name: 'Análisis — FA-001' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText('Agua Piscina', { exact: false })).toBeTruthy()
    expect(within(dialog).getByText(/Resultado: ✅ CUMPLE/)).toBeTruthy()
    expect(within(dialog).getByText('Muestra de la mañana', { exact: false })).toBeTruthy()
    // Tabla de parámetros de la tipología (piscina).
    expect(within(dialog).getByRole('cell', { name: 'pH' })).toBeTruthy()
    expect(within(dialog).getByRole('cell', { name: '7.4' })).toBeTruthy()
    expect(within(dialog).getByRole('cell', { name: 'Cloro Libre' })).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    // Escape también cierra.
    fireEvent.click(screen.getByRole('button', { name: '🔍 Detalle' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
