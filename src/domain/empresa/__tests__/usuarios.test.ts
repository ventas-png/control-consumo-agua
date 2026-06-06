// T7/PR3 — Contrato del dominio de gestión de usuarios (empresa/usuarios):
// app_users.activo, asignaciones de proyecto (user_project_assignments) y los
// edges create-user/delete-user (fetch + token de sesión). Mock encadenable +
// fetch/getSession stubeados.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { result: unknown } = { result: { data: null, error: null } }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq']) {
    builder[m] = () => builder
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(state.result)
  const getSession = vi.fn()
  return { state, builder, getSession }
})

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => h.builder, auth: { getSession: h.getSession } },
}))

import {
  setUsuarioActivo,
  fetchUserProjectAssignments,
  deleteUserProjectAssignments,
  insertUserProjectAssignments,
  createCompanyUser,
  deleteCompanyUser,
} from '../usuarios'

const fetchMock = vi.fn()

beforeEach(() => {
  h.state.result = { data: null, error: null }
  h.getSession.mockReset()
  h.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('app_users / asignaciones', () => {
  it('setUsuarioActivo éxito → { error: null }', async () => {
    h.state.result = { error: null }
    expect(await setUsuarioActivo('u1', false)).toEqual({ error: null })
  })

  it('setUsuarioActivo error → mensaje legible', async () => {
    h.state.result = { error: { message: 'denied' } }
    expect(await setUsuarioActivo('u1', true)).toEqual({ error: 'denied' })
  })

  it('fetchUserProjectAssignments éxito', async () => {
    h.state.result = { data: [{ project_id: 'p1' }], error: null }
    expect(await fetchUserProjectAssignments('u1')).toEqual({ data: [{ project_id: 'p1' }], error: null })
  })

  it('deleteUserProjectAssignments éxito', async () => {
    h.state.result = { error: null }
    expect(await deleteUserProjectAssignments('u1')).toEqual({ error: null })
  })

  it('insertUserProjectAssignments error → mensaje legible', async () => {
    h.state.result = { error: { message: 'fk' } }
    expect(await insertUserProjectAssignments([{ user_id: 'u1', project_id: 'p1' }])).toEqual({ error: 'fk' })
  })
})

describe('createCompanyUser (edge create-user)', () => {
  it('200 → devuelve user_id, sin error', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ user_id: 'u9' }) })
    const r = await createCompanyUser({ email: 'a@b.com', password: 'pw', full_name: 'Ana', role: 'operator' })
    expect(r).toEqual({ userId: 'u9', error: null })
    // arma la URL con el host de env + manda el token de la sesión
    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/functions/v1/create-user')
    expect((opts as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer tok')
  })

  it('!ok → error del edge', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'email en uso' }) })
    expect(await createCompanyUser({ email: '', password: '', full_name: '', role: 'viewer' }))
      .toEqual({ userId: null, error: 'email en uso' })
  })

  it('!ok sin cuerpo JSON → mensaje por defecto', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => { throw new Error('no json') } })
    expect(await createCompanyUser({ email: '', password: '', full_name: '', role: 'viewer' }))
      .toEqual({ userId: null, error: 'No se pudo crear el usuario.' })
  })
})

describe('deleteCompanyUser (edge delete-user)', () => {
  it('200 → { error: null }', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    expect(await deleteCompanyUser('u1')).toEqual({ error: null })
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/functions/v1/delete-user')
  })

  it('!ok → error del edge', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'no permitido' }) })
    expect(await deleteCompanyUser('u1')).toEqual({ error: 'no permitido' })
  })
})
