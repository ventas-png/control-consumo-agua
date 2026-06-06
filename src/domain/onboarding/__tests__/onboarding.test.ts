// T7/PR3 — Contrato del onboarding: preview/accept (edge), sign-in y createProject.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { invoke, signIn, insert } = vi.hoisted(() => ({
  invoke: vi.fn(), signIn: vi.fn(), insert: vi.fn(),
}))
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    functions: { invoke },
    auth: { signInWithPassword: signIn },
    from: () => ({ insert }),
  },
}))

import { previewInvitation } from '../queries'
import { acceptInvitation, signInWithPassword, createProject } from '../mutations'

beforeEach(() => { invoke.mockReset(); signIn.mockReset(); insert.mockReset() })

describe('previewInvitation', () => {
  it('éxito → { data, error: null }', async () => {
    invoke.mockResolvedValueOnce({ data: { valid: true, email: 'a@b.com' }, error: null })
    expect(await previewInvitation('tok')).toEqual({ data: { valid: true, email: 'a@b.com' }, error: null })
  })

  it('error del edge → mensaje legible', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'expired' } })
    expect(await previewInvitation('tok')).toEqual({ data: null, error: 'expired' })
  })
})

describe('acceptInvitation', () => {
  it('éxito → { data, error: null }', async () => {
    invoke.mockResolvedValueOnce({ data: { success: true, email: 'a@b.com' }, error: null })
    expect(await acceptInvitation('tok', 'pw', 'Nombre')).toEqual({ data: { success: true, email: 'a@b.com' }, error: null })
  })
})

describe('signInWithPassword', () => {
  it('éxito → { error: null }', async () => {
    signIn.mockResolvedValueOnce({ error: null })
    expect(await signInWithPassword('a@b.com', 'pw')).toEqual({ error: null })
  })

  it('error → mensaje legible', async () => {
    signIn.mockResolvedValueOnce({ error: { message: 'bad creds' } })
    expect(await signInWithPassword('a@b.com', 'pw')).toEqual({ error: 'bad creds' })
  })
})

describe('createProject', () => {
  it('éxito → { error: null }', async () => {
    insert.mockResolvedValueOnce({ error: null })
    expect(await createProject({})).toEqual({ error: null })
  })

  it('error → mensaje legible', async () => {
    insert.mockResolvedValueOnce({ error: { message: 'rls' } })
    expect(await createProject({})).toEqual({ error: 'rls' })
  })
})
