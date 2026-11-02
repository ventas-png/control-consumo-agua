// Sección recursos humanos (supabase/rls-acciones/recursos_humanos.json):
// Eliminar se ofrece y se ejecuta con canDelete (condominios.tab.<tab>.delete),
// lo mismo que exige la base. Editar no basta, y sin editar sí se borra. Antes
// lo decidía canEdit y la base sólo dejaba borrar a company_owner/admin.
// Ausencias, Personal, Turnos y Tareas por turno lo prueban en sus propios
// archivos, junto a sus mocks; aquí va Capacitación, que no tenía uno.
import { vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { eliminarExigeSuPermiso } from '../../../../test/eliminarExigeSuPermiso'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { default: CapacitacionPersonalTab } = await import('../CapacitacionPersonalTab')

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

eliminarExigeSuPermiso('Capacitación', p => render(
  <CapacitacionPersonalTab proyectoId="p1" companyId="co1" moneda="Q" canCreate {...p} onRefresh={() => {}} personal={[]}
    capacitaciones={[{
      id: 'ca1', company_id: 'co1', project_id: 'p1', nombre_empleado: 'Lucía Conserje', curso: 'Primeros auxilios',
      estado: 'planificado', created_at: '2026-10-10T00:00:00Z',
    } as never]} />,
), /^Eliminar Primeros auxilios$/, mocks.deleteCondominioRow, 'capacitacion_personal_cond', 'ca1')
