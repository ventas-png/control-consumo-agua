// T7/PR3 — Contrato de las mutaciones del panel superadmin.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { updateEq, insertSingle, getSession } = vi.hoisted(() => ({
  updateEq: vi.fn(), insertSingle: vi.fn(), getSession: vi.fn(),
}))
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: () => ({ eq: updateEq }),
      insert: () => ({ select: () => ({ single: insertSingle }) }),
    }),
    auth: { getSession },
  },
}))

import { updateEmpresaCampo, createEmpresa, createCompanyOwner } from '../mutations'

const fetchMock = vi.fn()
beforeEach(() => {
  updateEq.mockReset(); insertSingle.mockReset(); getSession.mockReset(); fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('updateEmpresaCampo', () => {
  it('éxito → { error: null }', async () => {
    updateEq.mockResolvedValueOnce({ error: null })
    expect(await updateEmpresaCampo('e1', { max_projects: 5 })).toEqual({ error: null })
  })
  it('error → mensaje legible', async () => {
    updateEq.mockResolvedValueOnce({ error: { message: 'denied' } })
    expect(await updateEmpresaCampo('e1', {})).toEqual({ error: 'denied' })
  })
})

describe('createEmpresa', () => {
  it('éxito → devuelve la fila', async () => {
    insertSingle.mockResolvedValueOnce({ data: { id: 'e1' }, error: null })
    expect(await createEmpresa({})).toEqual({ data: { id: 'e1' }, error: null })
  })
  it('error → { data: null, error }', async () => {
    insertSingle.mockResolvedValueOnce({ data: null, error: { message: 'dup' } })
    expect(await createEmpresa({})).toEqual({ data: null, error: 'dup' })
  })
})

describe('createCompanyOwner', () => {
  const input = { email: 'a@b.com', password: 'pw', full_name: 'N', company_id: 'e1' }

  it('res.ok → { ok: true, error: null }', async () => {
    getSession.mockResolvedValueOnce({ data: { session: { access_token: 'tok' } } })
    fetchMock.mockResolvedValueOnce({ ok: true })
    expect(await createCompanyOwner(input)).toEqual({ ok: true, error: null })
  })

  it('!res.ok → { ok: false, error } (sin token tampoco revienta)', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } })
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'boom' }) })
    expect(await createCompanyOwner(input)).toEqual({ ok: false, error: 'boom' })
  })
})
