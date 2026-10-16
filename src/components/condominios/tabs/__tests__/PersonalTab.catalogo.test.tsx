// PersonalTab contra el catálogo del condominio (20261031000300): los selects
// de cargo y turno ofrecen SÓLO los activos del catálogo, una ficha con un
// valor apagado lo conserva marcado, el filtro no pierde a nadie, y el error
// RRHH_CARGO del trigger se muestra sin prefijo técnico. Sin catálogo (entorno
// sin la migración) se ofrecen los seis cargos y tres turnos de siempre.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { PersonalCondominio, UsuarioAsignablePersonal, CatalogoRrhhItem } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  updateCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  fetchUsuariosAsignablesPersonal: vi.fn(async () => ({
    data: [] as UsuarioAsignablePersonal[],
    error: null as { message: string } | null,
  })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}), rpc: () => ({}), storage: { from: () => ({}) } },
  db: { from: () => ({}), rpc: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchUsuariosAsignablesPersonal: mocks.fetchUsuariosAsignablesPersonal,
}))
vi.mock('../../../shared/Dialog', () => ({
  confirm: mocks.confirm,
  notify: mocks.notify,
}))

const { PersonalTab } = await import('../PersonalTab')

function item(over: Partial<CatalogoRrhhItem> = {}): CatalogoRrhhItem {
  return {
    id: 'c1', company_id: 'c1', project_id: 'p1', codigo: 'conserje', nombre: 'Conserje',
    descripcion: null, icono: '🧹', orden: 10, activo: true,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}
const cargos = [
  item({ id: 'c1', codigo: 'supervisor_piscina', nombre: 'Supervisor de piscina', icono: '🏊', orden: 5 }),
  item({ id: 'c2', codigo: 'conserje', nombre: 'Conserje', icono: '🧹', orden: 10 }),
  item({ id: 'c3', codigo: 'jardinero', nombre: 'Jardinero', icono: '🌿', orden: 30, activo: false }),
]
const turnos = [
  item({ id: 't1', codigo: 'diurno', nombre: 'Diurno', icono: '☀️', orden: 10 }),
  item({ id: 't2', codigo: 'fin_semana', nombre: 'Fin de semana', icono: '🏖️', orden: 40 }),
]

function empleado(over: Partial<PersonalCondominio> = {}): PersonalCondominio {
  return {
    id: 'emp1', company_id: 'c1', project_id: 'p1', nombre: 'Dina Villatoro',
    cargo: 'conserje', turno: 'diurno', estado: 'activo',
    created_at: '2026-01-02T00:00:00.000Z',
    ...over,
  } as PersonalCondominio
}

function renderTab(props: Partial<Parameters<typeof PersonalTab>[0]> = {}) {
  return render(
    <PersonalTab
      personal={[empleado()]}
      cargos={cargos}
      tiposTurno={turnos}
      proyectoId="p1"
      companyId="c1"
      moneda="Q"
      canCreate
      canEdit
      onRefresh={() => {}}
      {...props}
    />,
  )
}

const opciones = (label: string) => [...(screen.getByLabelText(label) as HTMLSelectElement).options].map(o => o.value)

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.fetchUsuariosAsignablesPersonal.mockResolvedValue({ data: [], error: null })
})
afterEach(() => { cleanup() })

describe('PersonalTab — cargos y turnos desde el catálogo del condominio', () => {
  it('el alta ofrece sólo los activos, en su orden, y arranca en el primero', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Agregar Personal'))
    await screen.findByLabelText('Cuenta con la que ingresa')
    expect(opciones('Cargo del empleado')).toEqual(['supervisor_piscina', 'conserje'])
    expect((screen.getByLabelText('Cargo del empleado') as HTMLSelectElement).value).toBe('supervisor_piscina')
    expect(opciones('Turno del empleado')).toEqual(['diurno', 'fin_semana'])
    fireEvent.change(screen.getByPlaceholderText('Nombre completo'), { target: { value: 'Fede' } })
    fireEvent.change(screen.getByLabelText('Turno del empleado'), { target: { value: 'fin_semana' } })
    fireEvent.click(screen.getByText('Agregar'))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(payload).toMatchObject({ cargo: 'supervisor_piscina', turno: 'fin_semana' })
  })

  it('una ficha con un cargo apagado lo conserva marcado «(inactivo)» y avisa', async () => {
    renderTab({ personal: [empleado({ cargo: 'jardinero' })] })
    fireEvent.click(screen.getByText('✏️'))
    await screen.findByLabelText('Cuenta con la que ingresa')
    const select = screen.getByLabelText('Cargo del empleado') as HTMLSelectElement
    expect(select.value).toBe('jardinero')
    expect([...select.options].map(o => o.text)).toContain('🌿 Jardinero (inactivo)')
    expect(screen.getByText(/ya no se ofrece en Configuración/)).toBeTruthy()
  })

  it('un valor legado fuera del catálogo se conserva como «(histórico)»', async () => {
    renderTab({ personal: [empleado({ cargo: 'Polivalente', turno: 'mixto' })] })
    fireEvent.click(screen.getByText('✏️'))
    await screen.findByLabelText('Cuenta con la que ingresa')
    expect([...(screen.getByLabelText('Cargo del empleado') as HTMLSelectElement).options].map(o => o.text)).toContain('Polivalente (histórico)')
    expect([...(screen.getByLabelText('Turno del empleado') as HTMLSelectElement).options].map(o => o.text)).toContain('mixto (histórico)')
  })

  it('la tarjeta nombra el cargo y el turno con el catálogo', () => {
    renderTab({ personal: [empleado({ cargo: 'supervisor_piscina', turno: 'fin_semana' })] })
    expect(screen.getByText('Supervisor de piscina')).toBeTruthy()
    expect(screen.getByText('🏖️ Fin de semana')).toBeTruthy()
  })

  it('el filtro por cargo incluye el cargo apagado de quien lo tiene', () => {
    renderTab({ personal: [empleado(), empleado({ id: 'emp2', nombre: 'Beto', cargo: 'jardinero' })] })
    expect(opciones('Filtrar por cargo')).toEqual(['todos', 'supervisor_piscina', 'conserje', 'jardinero'])
    fireEvent.change(screen.getByLabelText('Filtrar por cargo'), { target: { value: 'jardinero' } })
    expect(screen.getByText('Beto')).toBeTruthy()
    expect(screen.queryByText('Dina Villatoro')).toBeNull()
  })

  it('el error RRHH_CARGO del trigger se muestra sin el prefijo técnico', async () => {
    mocks.createCondominioRow.mockResolvedValueOnce({ error: { code: '23514', message: 'RRHH_CARGO: el cargo "jardinero" no está activo en el catálogo de este condominio (Recursos Humanos → Configuración)' } })
    renderTab()
    fireEvent.click(screen.getByText('+ Agregar Personal'))
    await screen.findByLabelText('Cuenta con la que ingresa')
    fireEvent.change(screen.getByPlaceholderText('Nombre completo'), { target: { value: 'X' } })
    fireEvent.click(screen.getByText('Agregar'))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect((mocks.notify.mock.calls[0][0] as { text: string }).text).toBe('el cargo "jardinero" no está activo en el catálogo de este condominio (Recursos Humanos → Configuración)')
  })

  it('sin catálogo (entorno sin la migración): los seis cargos y tres turnos de siempre', async () => {
    renderTab({ cargos: [], tiposTurno: [] })
    fireEvent.click(screen.getByText('+ Agregar Personal'))
    await screen.findByLabelText('Cuenta con la que ingresa')
    expect(opciones('Cargo del empleado')).toEqual(['conserje', 'guardia', 'jardinero', 'mantenimiento', 'administrador', 'otro'])
    expect(opciones('Turno del empleado')).toEqual(['diurno', 'nocturno', 'rotativo'])
  })
})
