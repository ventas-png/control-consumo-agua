import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { AusenciaPersonal, DiaNoLaborable, PersonalCondominio } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
  generarBloquesTurno: vi.fn(),
}))
vi.mock('../../../shared/Dialog', () => ({
  confirm: mocks.confirm,
  notify: mocks.notify,
}))

const AusenciasTab = (await import('../AusenciasTab')).default

const empleado: PersonalCondominio = {
  id: 'emp1', company_id: 'c1', project_id: 'p1', nombre: 'Lucía Conserje',
  cargo: 'conserje', turno: 'diurno', estado: 'activo',
} as PersonalCondominio

function ausencia(over: Partial<AusenciaPersonal> = {}): AusenciaPersonal {
  return {
    id: 'a1', company_id: 'c1', project_id: 'p1', personal_id: 'emp1',
    tipo: 'vacaciones', fecha_inicio: '2026-11-02', fecha_fin: '2026-11-06',
    goce_salario: true, estado: 'solicitada', created_at: '2026-10-01T00:00:00.000Z',
    personal_nombre: 'Lucía Conserje',
    ...over,
  }
}

const feriado: DiaNoLaborable = {
  id: 'd1', company_id: 'c1', project_id: 'p1', fecha: '2026-11-03',
  nombre: 'Día de todos los santos', tipo: 'asueto_local', recurre_anual: true,
  paga_recargo: true, factor_recargo: 2, created_at: '2026-10-01T00:00:00.000Z',
}

function renderTab(props: Partial<Parameters<typeof AusenciasTab>[0]> = {}) {
  return render(
    <AusenciasTab
      ausencias={[ausencia()]}
      diasNoLaborables={[feriado]}
      personal={[empleado]}
      proyectoId="p1"
      companyId="c1"
      userId="user-1"
      canCreate
      canEdit
      onRefresh={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
})

afterEach(() => { cleanup() })

describe('AusenciasTab — ausencias y calendario laboral', () => {
  it('lista la ausencia con su rango y sus días', () => {
    renderTab()
    expect(screen.getByText('Lucía Conserje')).toBeTruthy()
    expect(screen.getByText(/2026-11-02 → 2026-11-06 · 5 días/)).toBeTruthy()
  })

  it('autorizar marca la ausencia como aprobada', async () => {
    renderTab()
    fireEvent.click(screen.getByText('✔ Autorizar'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(tabla).toBe('ausencias_personal')
    expect(id).toBe('a1')
    expect(patch.estado).toBe('aprobada')
    // `aprobada_por` NO viaja: lo sella trg_sellar_cierre en el UPDATE.
    expect(patch.aprobada_por).toBeUndefined()
  })

  it('denegar la deja rechazada', async () => {
    renderTab()
    fireEvent.click(screen.getByText('✕ Denegar'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [, , patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(patch.estado).toBe('rechazada')
  })

  it('el filtro por estado esconde lo que no corresponde', () => {
    renderTab({ ausencias: [ausencia(), ausencia({ id: 'a2', estado: 'cancelada', motivo: 'Se pospuso' })] })
    fireEvent.click(screen.getByText('Aprobada'))
    expect(screen.queryByText('Se pospuso')).toBeNull()
  })

  it('el festivo dentro del rango no consume día hábil', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Registrar ausencia'))
    fireEvent.change(screen.getByLabelText('Empleado *'), { target: { value: 'emp1' } })
    fireEvent.change(screen.getByLabelText('Desde *'), { target: { value: '2026-11-02' } })
    fireEvent.change(screen.getByLabelText('Hasta *'), { target: { value: '2026-11-06' } })
    // 5 naturales − 1 asueto = 4 hábiles.
    expect(screen.getByText('4 hábiles')).toBeTruthy()

    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('ausencias_personal')
    expect(payload.dias_habiles).toBe(4)
    expect(payload.estado).toBe('solicitada')
  })

  it('el alta ya autorizada sella quién aprobó, porque el trigger no dispara en INSERT', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Registrar ausencia'))
    fireEvent.change(screen.getByLabelText('Empleado *'), { target: { value: 'emp1' } })
    fireEvent.click(screen.getByLabelText(/Ya está autorizada/))
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(payload.estado).toBe('aprobada')
    expect(payload.aprobada_por).toBe('user-1')
  })

  it('el tipo propone el goce por defecto pero se puede cambiar', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Registrar ausencia'))
    fireEvent.change(screen.getByLabelText('Empleado *'), { target: { value: 'emp1' } })
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'suspension' } })

    const goce = screen.getByLabelText(/Con goce de salario/) as HTMLInputElement
    expect(goce.checked).toBe(false)
    fireEvent.click(goce)

    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(payload.tipo).toBe('suspension')
    expect(payload.goce_salario).toBe(true)
  })

  it('rechaza un rango que termina antes de empezar', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Registrar ausencia'))
    fireEvent.change(screen.getByLabelText('Empleado *'), { target: { value: 'emp1' } })
    fireEvent.change(screen.getByLabelText('Hasta *'), { target: { value: '2020-01-01' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'warning', title: 'Rango inválido' }),
    ))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })

  it('el calendario laboral muestra el factor de recargo', () => {
    renderTab()
    fireEvent.click(screen.getByRole('tab', { name: /Días no laborables/ }))
    expect(screen.getByText('Día de todos los santos')).toBeTruthy()
    expect(screen.getByText('Trabajarlo se paga ×2.00')).toBeTruthy()
  })

  it('crea un día no laborable', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('tab', { name: /Días no laborables/ }))
    fireEvent.click(screen.getByText('+ Agregar día'))
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Navidad' } })
    fireEvent.change(screen.getByLabelText('Fecha *'), { target: { value: '2026-12-25' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('dias_no_laborables')
    expect(payload.nombre).toBe('Navidad')
    expect(payload.factor_recargo).toBe(2)
  })

  it('sin permiso de edición no ofrece autorizar ni eliminar', () => {
    renderTab({ canCreate: false, canEdit: false })
    expect(screen.queryByText('✔ Autorizar')).toBeNull()
    expect(screen.queryByText('+ Registrar ausencia')).toBeNull()
  })

  it('explica el estado vacío cuando no hay ausencias', () => {
    renderTab({ ausencias: [] })
    expect(screen.getByText('Sin ausencias registradas')).toBeTruthy()
  })
})
