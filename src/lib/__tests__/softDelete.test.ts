import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabase BEFORE importing the module under test so the helper picks up
// our test double. The mock returns a fluent chain whose terminal call resolves
// to an inert success payload.
const updateMock = vi.fn()
const matchMock = vi.fn()
const isMock = vi.fn()
const fromMock = vi.fn()
const getUserMock = vi.fn()

vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    auth: { getUser: () => getUserMock() },
  },
}))

import { softDelete } from '../softDelete'

beforeEach(() => {
  vi.clearAllMocks()
  // Default: chainable mocks return themselves so .from().update().match().is() works
  fromMock.mockReturnValue({ update: updateMock })
  updateMock.mockReturnValue({ match: matchMock })
  matchMock.mockReturnValue({ is: isMock })
  isMock.mockResolvedValue({ data: null, error: null, count: 1 })
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } })
})

describe('softDelete', () => {
  it('llama a update con deleted_at + deleted_by del usuario autenticado', async () => {
    await softDelete('cuotas_condominio', { id: 'cuota-1' })

    expect(fromMock).toHaveBeenCalledWith('cuotas_condominio')
    expect(updateMock).toHaveBeenCalledTimes(1)
    const payload = updateMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.deleted_by).toBe('user-123')
    expect(typeof payload.deleted_at).toBe('string')
    expect(new Date(payload.deleted_at as string).toString()).not.toBe('Invalid Date')
  })

  it('pasa el match al query builder (id simple)', async () => {
    await softDelete('pagos', { id: 'pago-42' })
    expect(matchMock).toHaveBeenCalledWith({ id: 'pago-42' })
  })

  it('soporta match multi-condicion (id + estado)', async () => {
    await softDelete('cuotas_condominio', { id: 'cuota-9', estado: 'pendiente' })
    expect(matchMock).toHaveBeenCalledWith({ id: 'cuota-9', estado: 'pendiente' })
  })

  it('filtra deleted_at IS NULL para no pisar el timestamp original (idempotente)', async () => {
    await softDelete('tickets_mantenimiento', { id: 'ticket-1' })
    expect(isMock).toHaveBeenCalledWith('deleted_at', null)
  })

  it('deja deleted_by en null si no hay usuario autenticado', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    await softDelete('fondo_reserva_condominio', { id: 'mov-7' })
    const payload = updateMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.deleted_by).toBeNull()
  })
})
