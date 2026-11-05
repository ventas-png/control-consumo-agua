// Garantías: la ficha de la garantía abre en ventana emergente (EditModal real, pantalla completa en el teléfono)
// al pulsar su fila, con todos los datos y las acciones (reclamar, editar, eliminar); en la fila queda sólo
// Reclamar. El formulario de alta / edición también va en ventana (antes se desplegaba entre los KPIs y la tabla).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { GarantiaEquipo } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
  onRefresh: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow, updateCondominioRow: mocks.updateCondominioRow, deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { I18nProvider } = await import('../../../../lib/i18n')
const { GarantiasEquipoTab } = await import('../GarantiasEquipoTab')

const garantia = (o: Partial<GarantiaEquipo>): GarantiaEquipo => ({
  id: 'g?', company_id: 'co1', project_id: 'p1', equipo: '?', estado: 'vigente', created_at: '2026-01-01T00:00:00Z', ...o,
})
const BOMBA = garantia({
  id: 'g1', equipo: 'Bomba de agua principal', area: 'Sala de máquinas', numero_serie: 'SN-12345', proveedor: 'Pedrollo GT',
  contacto_soporte: '2222-3333', fecha_compra: '2025-01-15', fecha_vencimiento: '2099-01-15', monto_compra: 12000, notas: 'Cobertura total 3 años',
})

function montar(p: { canCreate?: boolean; canEdit?: boolean; canDelete?: boolean; garantias?: GarantiaEquipo[] } = {}) {
  return render(
    <I18nProvider>
      <GarantiasEquipoTab garantias={p.garantias ?? [BOMBA]} proyectoId="p1" companyId="co1" moneda="Q"
        canCreate={p.canCreate ?? true} canEdit={p.canEdit ?? true} canDelete={p.canDelete ?? true} onRefresh={mocks.onRefresh} />
    </I18nProvider>,
  )
}
const abrir = () => fireEvent.click(screen.getByText('Bomba de agua principal'))
const ficha = () => screen.getByRole('dialog', { name: 'Bomba de agua principal' })
const pie = () => ficha().querySelector('.at-modal-footer') as HTMLElement

// jsdom dice navigator.language = 'en-US': se fija el español, que es lo que ve el staff.
beforeEach(() => { localStorage.setItem('at:locale', 'es'); Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('GarantiasEquipoTab — la ficha abre en ventana', () => {
  it('sin pulsar nada sólo hay tabla; la fila lleva Reclamar y no Editar ni Eliminar', () => {
    montar()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Eliminar' })).toBeNull()
    expect(within(screen.getByRole('table')).getByRole('button', { name: 'Reclamar' })).toBeTruthy()
  })

  it('pulsar la fila abre la ficha (pantalla completa en el teléfono) con los datos y las acciones en el pie', () => {
    montar()
    abrir()
    const v = ficha()
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(v).getByText('Vigente')).toBeTruthy()
    expect(within(v).getByText('📍 Sala de máquinas')).toBeTruthy()
    expect(within(v).getByText('SN-12345')).toBeTruthy()
    expect(within(v).getByText('Pedrollo GT')).toBeTruthy()
    expect(within(v).getByText('2222-3333')).toBeTruthy()
    expect(within(v).getByText('2099-01-15')).toBeTruthy()
    expect(within(v).getByText('Monto compra (Q)')).toBeTruthy()
    expect(within(v).getByText('Q 12.000,00')).toBeTruthy()
    expect(within(v).getByText('Cobertura total 3 años')).toBeTruthy()
    expect(within(pie()).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar', 'Reclamar', '🗑️ Eliminar', '✏️ Editar'])
  })

  it('Cerrar y Escape cierran la ficha; Editar se apila encima y Escape cierra sólo el formulario', () => {
    montar()
    abrir()
    fireEvent.click(within(pie()).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    abrir()
    fireEvent.click(within(pie()).getByRole('button', { name: 'Editar' }))
    const editar = screen.getByRole('dialog', { name: 'Editar garantía' })
    expect((within(editar).getByPlaceholderText('Ej: Bomba de agua principal') as HTMLInputElement).value).toBe('Bomba de agua principal')
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Editar garantía' })).toBeNull()
    expect(ficha()).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Reclamar y Eliminar desde el pie; eliminar cierra la ficha', async () => {
    montar()
    abrir()
    fireEvent.click(within(pie()).getByRole('button', { name: 'Reclamar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('garantias_equipo', 'g1', { estado: 'reclamada' }))
    fireEvent.click(within(pie()).getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(mocks.deleteCondominioRow).toHaveBeenCalledWith('garantias_equipo', 'g1'))
    expect(mocks.confirm).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('la acción rápida de la fila no abre la ficha', async () => {
    montar()
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Reclamar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('garantias_equipo', 'g1', { estado: 'reclamada' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('una garantía expirada lo avisa en la ficha; + Registrar Garantía abre el formulario en ventana', () => {
    montar({ garantias: [garantia({ ...BOMBA, fecha_vencimiento: '2020-01-01' })] })
    abrir()
    expect(within(ficha()).getByText('⚠️ Expirada · 2020-01-01')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar Garantía' }))
    const v = screen.getByRole('dialog', { name: 'Registrar Garantía' })
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    fireEvent.click(within(v).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sin permisos el pie sólo lleva Cerrar', () => {
    montar({ canEdit: false, canDelete: false, canCreate: false })
    abrir()
    expect(within(pie()).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar'])
  })
})
