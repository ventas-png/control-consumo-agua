// Actividades: la ficha abre en ventana emergente (EditModal real, pantalla completa en el teléfono) al pulsar su
// tarjeta; antes vivía en un panel fijo al lado de la lista, que en el teléfono se repartían 300px + lo que sobrara.
// Las acciones del ciclo van en el pie; el formulario de alta también abre en ventana.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { ProgramaActividad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  notify: vi.fn(),
  onRefresh: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow, updateCondominioRow: mocks.updateCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify }))

const ProgramaActividadesTab = (await import('../ProgramaActividadesTab')).default

const actividad = (o: Partial<ProgramaActividad>): ProgramaActividad => ({
  id: 'a?', company_id: 'co1', project_id: 'p1', nombre: '?', categoria: 'recreativa', fecha_inicio: '2026-11-01',
  inscritos: 0, costo: 0, estado: 'activa', activo: true, created_at: '2026-10-01T00:00:00Z', ...o,
})
const YOGA = actividad({
  id: 'a1', nombre: 'Yoga matutino', categoria: 'salud', instructor: 'Marta', lugar: 'Salón social', fecha_inicio: '2026-11-01', fecha_fin: '2026-12-20',
  hora_inicio: '07:00:00', hora_fin: '08:00:00', dias_semana: ['lunes', 'miercoles', 'viernes'], cupo_maximo: 20, inscritos: 16, costo: 150,
  descripcion: 'Clase guiada para todos los niveles.', notas: 'Traer tapete propio.',
})
const NATACION = actividad({ id: 'a2', nombre: 'Clases de natación', categoria: 'deportiva', estado: 'programada', fecha_inicio: '2026-12-01', cupo_maximo: 10 })

function montar(p: { canCreate?: boolean; canEdit?: boolean; actividades?: ProgramaActividad[] } = {}) {
  return render(
    <ProgramaActividadesTab actividades={p.actividades ?? [YOGA, NATACION]} proyectoId="p1" companyId="co1" moneda="Q"
      canCreate={p.canCreate ?? true} canEdit={p.canEdit ?? true} onRefresh={mocks.onRefresh} />,
  )
}
const abrir = (nombre = 'Yoga matutino') => fireEvent.click(screen.getByRole('button', { name: nombre }))
const ficha = (nombre = 'Yoga matutino') => screen.getByRole('dialog', { name: new RegExp(`${nombre}$`) })
const pie = (nombre?: string) => ficha(nombre).querySelector('.at-modal-footer') as HTMLElement

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('ProgramaActividadesTab — la ficha abre en ventana', () => {
  it('sin pulsar nada sólo hay tarjetas (el filtro inicial deja las activas); la tarjeta abre la ficha a pantalla completa en el teléfono', () => {
    montar()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Yoga matutino' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clases de natación' })).toBeNull()
    abrir()
    const v = ficha()
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(v).getByText('💪 Yoga matutino')).toBeTruthy()
    expect(within(v).getByText('Activa')).toBeTruthy()
    expect(within(v).getByText('👤 Marta')).toBeTruthy()
    expect(within(v).getByText('📍 Salón social')).toBeTruthy()
    expect(within(v).getByText('2026-11-01 → 2026-12-20')).toBeTruthy()
    expect(within(v).getByText('07:00 – 08:00')).toBeTruthy()
    expect(within(v).getByText('Q 150')).toBeTruthy()
    expect(within(v).getByText('4 cupos disponibles')).toBeTruthy()
    expect(within(v).getByText('Clase guiada para todos los niveles.')).toBeTruthy()
    expect(within(v).getByText('Traer tapete propio.')).toBeTruthy()
    expect(within(pie()).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar', '✕ Cancelar actividad', '✓ Completar', '+ Inscribir'])
  })

  it('Cerrar y Escape cierran la ficha; una programada ofrece Iniciar y Cancelar actividad', () => {
    montar()
    abrir()
    fireEvent.click(within(pie()).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    abrir()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: '' } })
    abrir('Clases de natación')
    expect(within(pie('Clases de natación')).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar', '✕ Cancelar actividad', '▶ Iniciar'])
  })

  it('las acciones del pie actualizan la fila y refrescan; la ficha sigue a la fila recargada', async () => {
    const { rerender } = montar()
    abrir()
    fireEvent.click(within(pie()).getByRole('button', { name: '+ Inscribir' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('programa_actividades', 'a1', { inscritos: 17 }))
    expect(mocks.onRefresh).toHaveBeenCalled()

    fireEvent.click(within(pie()).getByRole('button', { name: '✓ Completar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('programa_actividades', 'a1', { estado: 'completada' }))
    rerender(
      <ProgramaActividadesTab actividades={[{ ...YOGA, estado: 'completada', inscritos: 17 }, NATACION]} proyectoId="p1" companyId="co1" moneda="Q"
        canCreate canEdit onRefresh={mocks.onRefresh} />,
    )
    expect(within(ficha()).getByText('Completada')).toBeTruthy()
    // El cupo se ve en la tarjeta de datos y en la barra de inscritos.
    expect(within(ficha()).getAllByText('17 / 20')).toHaveLength(2)
    expect(within(pie()).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar'])
  })

  it('sin cupo, Inscribir avisa y no escribe', async () => {
    montar({ actividades: [{ ...YOGA, inscritos: 20 }] })
    abrir()
    expect(within(ficha()).getByText('Sin cupos disponibles')).toBeTruthy()
    fireEvent.click(within(pie()).getByRole('button', { name: '+ Inscribir' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sin cupo' })))
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('+ Nueva abre el formulario en ventana y crea la actividad con el tenant', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva' }))
    const v = screen.getByRole('dialog', { name: 'Nueva actividad' })
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    fireEvent.change(within(v).getByPlaceholderText('Clases de natación, Yoga matutino…'), { target: { value: 'Zumba' } })
    fireEvent.click(within(v).getByRole('button', { name: 'X' }))
    fireEvent.click(within(v).getByRole('button', { name: '✅ Crear actividad' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, fila] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('programa_actividades')
    expect(fila).toMatchObject({ company_id: 'co1', project_id: 'p1', nombre: 'Zumba', dias_semana: ['miercoles'] })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('sin permiso de edición el pie sólo lleva Cerrar; sin permiso de alta no hay + Nueva', () => {
    montar({ canEdit: false, canCreate: false })
    expect(screen.queryByRole('button', { name: '+ Nueva' })).toBeNull()
    abrir()
    expect(within(pie()).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar'])
  })
})
