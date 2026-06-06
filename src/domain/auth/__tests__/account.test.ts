// T7/PR3 — Contrato del dominio de cuenta/credenciales: edge functions de alta
// (cliente/empresa/OAuth) y operaciones de auth (reset, updateUser, getSession,
// signOut). Sin red/React: sólo el mapeo de resultados de supabase a `{ error }`.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { invoke, resetPasswordForEmail, updateUser, getSession, signOutFn } = vi.hoisted(() => ({
  invoke: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  getSession: vi.fn(),
  signOutFn: vi.fn(),
}))
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    functions: { invoke },
    auth: {
      resetPasswordForEmail,
      updateUser,
      getSession,
      signOut: signOutFn,
    },
  },
}))

import {
  createClienteAccount,
  signupCompany,
  completeOAuthOnboarding,
  requestPasswordReset,
  updatePassword,
  hasActiveSession,
  signOut,
  signOutGlobal,
} from '../account'

beforeEach(() => {
  invoke.mockReset()
  resetPasswordForEmail.mockReset()
  updateUser.mockReset()
  getSession.mockReset()
  signOutFn.mockReset()
})

describe('createClienteAccount', () => {
  it('éxito → { data, error: null } e invoca el edge correcto', async () => {
    invoke.mockResolvedValueOnce({ data: { success: true }, error: null })
    const payload = {
      full_name: 'Juan', email: 'a@b.com', cui_dui: '123',
      fecha_nacimiento: '1990-01-01', password: 'pw', legal_accepted: true,
    }
    expect(await createClienteAccount(payload)).toEqual({ data: { success: true }, error: null })
    expect(invoke).toHaveBeenCalledWith('create-cliente-account', { body: payload })
  })

  it('error del edge → mensaje legible y data null', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'cliente no encontrado' } })
    expect(await createClienteAccount({
      full_name: '', email: '', cui_dui: '', fecha_nacimiento: '', password: '', legal_accepted: true,
    })).toEqual({ data: null, error: 'cliente no encontrado' })
  })

  it('data undefined → se normaliza a null', async () => {
    invoke.mockResolvedValueOnce({ data: undefined, error: null })
    expect(await createClienteAccount({
      full_name: '', email: '', cui_dui: '', fecha_nacimiento: '', password: '', legal_accepted: true,
    })).toEqual({ data: null, error: null })
  })
})

describe('signupCompany', () => {
  it('éxito → { data, error: null } e invoca signup-company', async () => {
    invoke.mockResolvedValueOnce({ data: { success: true }, error: null })
    const payload = {
      email: 'a@b.com', password: 'pw', full_name: 'Ana', company_name: 'ACME',
      servicio_agua: true, servicio_condominios: false, legal_accepted: true,
    }
    expect(await signupCompany(payload)).toEqual({ data: { success: true }, error: null })
    expect(invoke).toHaveBeenCalledWith('signup-company', { body: payload })
  })

  it('error del edge → mensaje legible', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'email en uso' } })
    expect(await signupCompany({
      email: '', password: '', full_name: '', company_name: '',
      servicio_agua: false, servicio_condominios: true, legal_accepted: true,
    })).toEqual({ data: null, error: 'email en uso' })
  })
})

describe('completeOAuthOnboarding', () => {
  it('éxito → { data, error: null } e invoca complete-oauth-onboarding', async () => {
    invoke.mockResolvedValueOnce({ data: { success: true }, error: null })
    expect(await completeOAuthOnboarding({ cui_dui: '123', fecha_nacimiento: '1990-01-01' }))
      .toEqual({ data: { success: true }, error: null })
    expect(invoke).toHaveBeenCalledWith('complete-oauth-onboarding', {
      body: { cui_dui: '123', fecha_nacimiento: '1990-01-01' },
    })
  })
})

describe('requestPasswordReset', () => {
  it('éxito → { error: null } y pasa redirectTo', async () => {
    resetPasswordForEmail.mockResolvedValueOnce({ error: null })
    expect(await requestPasswordReset('a@b.com', 'https://app')).toEqual({ error: null })
    expect(resetPasswordForEmail).toHaveBeenCalledWith('a@b.com', { redirectTo: 'https://app' })
  })

  it('error → mensaje legible', async () => {
    resetPasswordForEmail.mockResolvedValueOnce({ error: { message: 'rate limit' } })
    expect(await requestPasswordReset('a@b.com', 'https://app')).toEqual({ error: 'rate limit' })
  })
})

describe('updatePassword', () => {
  it('éxito → { error: null }', async () => {
    updateUser.mockResolvedValueOnce({ error: null })
    expect(await updatePassword('nuevaClave')).toEqual({ error: null })
    expect(updateUser).toHaveBeenCalledWith({ password: 'nuevaClave' })
  })

  it('error → mensaje legible', async () => {
    updateUser.mockResolvedValueOnce({ error: { message: 'weak password' } })
    expect(await updatePassword('123')).toEqual({ error: 'weak password' })
  })
})

describe('hasActiveSession', () => {
  it('con sesión → true', async () => {
    getSession.mockResolvedValueOnce({ data: { session: { access_token: 'tok' } } })
    expect(await hasActiveSession()).toBe(true)
  })

  it('sin sesión → false', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } })
    expect(await hasActiveSession()).toBe(false)
  })
})

describe('signOut / signOutGlobal', () => {
  it('signOut → sign-out local sin scope', async () => {
    signOutFn.mockResolvedValueOnce({ error: null })
    await signOut()
    expect(signOutFn).toHaveBeenCalledWith()
  })

  it('signOutGlobal → scope global', async () => {
    signOutFn.mockResolvedValueOnce({ error: null })
    await signOutGlobal()
    expect(signOutFn).toHaveBeenCalledWith({ scope: 'global' })
  })
})
