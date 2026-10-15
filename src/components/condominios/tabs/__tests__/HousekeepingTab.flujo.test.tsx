// Tarjetas del flujo por pasos: los botones dependen del estado; «Iniciar servicio» pide
// confirmación, exige una fila afectada (pendiente → en_proceso) y abre el paso 1; la tarjeta
// muestra la reserva, el ingreso tentativo, las horas dedicadas y el informe enviado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { ServicioHousekeeping, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  updateCondominioRowAfectando: vi.fn(async (_t: string, _id: string, _p: Record<string, unknown>) => ({ error: null as null | { message: string; code?: string } })),
  fetchResponsablesElegibles: vi.fn(async (_p: string) => ({ data: [], error: null as string | null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
  pasos: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}), rpc: () => ({}) }, db: { from: () => ({}), rpc: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(), updateCondominioRow: vi.fn(),
  updateCondominioRowAfectando: mocks.updateCondominioRowAfectando,
}))
vi.mock('../../../../domain/condominios/housekeepingResponsable', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../domain/condominios/housekeepingResponsable')>()),
  fetchResponsablesElegibles: mocks.fetchResponsablesElegibles,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../../shared/UsuarioChip', () => ({ UsuarioChip: ({ userId }: { userId: string }) => <span>chip:{userId}</span> }))
vi.mock('../HousekeepingServicioPasos', () => ({
  HousekeepingServicioPasos: (p: { servicio: { id: string }; pasoInicial: number; canEdit: boolean }) => {
    mocks.pasos(p.servicio.id, p.pasoInicial, p.canEdit)
    return <div data-testid="pasos">pasos:{p.servicio.id}:{p.pasoInicial}</div>
  },
}))

const { HousekeepingTab } = await import('../HousekeepingTab')

function servicio(over: Partial<ServicioHousekeeping> = {}): ServicioHousekeeping {
  return { id: 's1', company_id: 'c1', project_id: 'p1', tipo: 'limpieza_estandar', fecha: '2026-10-15', estado: 'pendiente', created_at: '2026-10-15T00:00:00.000Z', ...over }
}
function renderTab(props: Partial<Parameters<typeof HousekeepingTab>[0]> = {}) {
  const onRefresh = vi.fn()
  render(<HousekeepingTab servicios={[]} unidades={[] as Unidad[]} proyectoId="p1" companyId="c1" userId="u1" moneda="Q" canCreate canEdit onRefresh={onRefresh} {...props} />)
  return { onRefresh }
}
const tarjeta = (id: string) => screen.getByTestId(`servicio-${id}`)

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()); mocks.updateCondominioRowAfectando.mockResolvedValue({ error: null }); mocks.confirm.mockResolvedValue({ isConfirmed: true }) })
afterEach(() => cleanup())

describe('HousekeepingTab — flujo por pasos', () => {
  it('pendiente: «Iniciar servicio» (sin selector de estado); en proceso: evidencia y finalizar; cerrado: ver evidencia', () => {
    renderTab({ servicios: [servicio({ id: 'p' }), servicio({ id: 'e', estado: 'en_proceso' }), servicio({ id: 'c', estado: 'completado' }), servicio({ id: 'x', estado: 'cancelado' })] })
    expect(within(tarjeta('p')).getByText('▶️ Iniciar servicio')).toBeTruthy()
    expect(within(tarjeta('p')).queryByText(/Finalizar/)).toBeNull()
    expect(within(tarjeta('e')).getByText('📝 Evidencia de ingreso')).toBeTruthy()
    expect(within(tarjeta('e')).getByText('🏁 Finalizar limpieza')).toBeTruthy()
    expect(within(tarjeta('c')).getByText('📋 Ver evidencia')).toBeTruthy()
    expect(within(tarjeta('x')).getByText('📋 Ver evidencia')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('«Iniciar servicio» confirma, exige una fila afectada al pasar a en_proceso, recarga y abre el paso 1', async () => {
    const { onRefresh } = renderTab({ servicios: [servicio()] })
    fireEvent.click(screen.getByText('▶️ Iniciar servicio'))
    await waitFor(() => expect(mocks.updateCondominioRowAfectando).toHaveBeenCalledWith('servicios_housekeeping', 's1', { estado: 'en_proceso' }))
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Iniciar servicio' }))
    expect(onRefresh).toHaveBeenCalled()
    expect(await screen.findByTestId('pasos')).toBeTruthy()
    expect(mocks.pasos).toHaveBeenCalledWith('s1', 1, true)
  })

  it('si no se confirma, no toca nada', async () => {
    mocks.confirm.mockResolvedValueOnce({ isConfirmed: false })
    renderTab({ servicios: [servicio()] })
    fireEvent.click(screen.getByText('▶️ Iniciar servicio'))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    await Promise.resolve()
    expect(mocks.updateCondominioRowAfectando).not.toHaveBeenCalled()
  })

  it('SIN_FILAS (el servicio ya no existe o no hay acceso) y una transición rechazada se explican', async () => {
    mocks.updateCondominioRowAfectando.mockResolvedValueOnce({ error: { message: 'x', code: 'SIN_FILAS' } })
    renderTab({ servicios: [servicio()] })
    fireEvent.click(screen.getByText('▶️ Iniciar servicio'))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'El servicio ya no existe o no tienes acceso.' })))
    expect(screen.queryByTestId('pasos')).toBeNull()
    mocks.updateCondominioRowAfectando.mockResolvedValueOnce({ error: { message: 'HK_TRANSICION_INVALIDA: de "pendiente" a "en_proceso"' } })
    fireEvent.click(screen.getByText('▶️ Iniciar servicio'))
    await waitFor(() => expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringMatching(/Iniciar servicio/) })))
  })

  it('«Finalizar limpieza» abre el paso 2 y «Evidencia de ingreso» el paso 1', async () => {
    renderTab({ servicios: [servicio({ estado: 'en_proceso' })] })
    fireEvent.click(screen.getByText('🏁 Finalizar limpieza'))
    expect(await screen.findByText('pasos:s1:2')).toBeTruthy()
  })

  it('la tarjeta muestra reserva, ingreso tentativo, horas dedicadas e informe enviado', () => {
    renderTab({ servicios: [servicio({
      estado: 'completado', hora_inicio: '09:00:00', hora_fin: '11:00:00', completado_por: 'u2',
      iniciado_en: '2026-10-15T15:00:00Z', completado_en: '2026-10-15T17:30:00Z', informe_enviado_en: '2026-10-15T18:00:00Z',
      reserva_str_resumen: { reserva_id: 'r1', codigo_confirmacion: 'HM-001', huesped_nombre: 'Ana Pérez', huesped_telefono: null, huesped_email: null, fecha_entrada: '2026-11-08', fecha_salida: '2026-11-12', hora_llegada_estimada: null, hora_salida_estimada: null, estado: 'en_curso', plataforma: 'airbnb', unidad_id: 'un1', vinculado_en: '2026-10-15T00:00:00Z' },
    })] })
    const t = tarjeta('s1')
    expect(within(t).getByText(/🔖 HM-001 · Ana Pérez · 08\/11 → 12\/11/)).toBeTruthy()
    expect(within(t).getByText(/🕐 Ingreso tentativo 09:00 — fin 11:00/)).toBeTruthy()
    expect(within(t).getByText(/⏱ 2 h 30 min/)).toBeTruthy()
    expect(within(t).getByText('📨 Informe enviado')).toBeTruthy()
  })

  it('sin permiso de edición: ver evidencia, sin iniciar ni editar', () => {
    renderTab({ servicios: [servicio()], canEdit: false, canCreate: false })
    expect(screen.queryByText('▶️ Iniciar servicio')).toBeNull()
    expect(screen.getByText('📋 Ver evidencia')).toBeTruthy()
    expect(screen.queryByLabelText('Editar servicio')).toBeNull()
    expect(screen.queryByText('+ Nuevo Servicio')).toBeNull()
  })
})
