// T7/PR3 — Contrato del dominio de cuenta/credenciales: edge functions de alta
// (cliente/empresa/OAuth) y operaciones de auth (reset, updateUser, getSession,
// signOut). Sin red/React: sólo el mapeo de resultados de supabase a `{ error }`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'

const { invoke, resetPasswordForEmail, updateUser, getSession, getUser, signInFn, signOutFn, updateEq } = vi.hoisted(() => ({
  invoke: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
  signInFn: vi.fn(),
  signOutFn: vi.fn(),
  updateEq: vi.fn(),
}))
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    functions: { invoke },
    from: () => ({ update: () => ({ eq: updateEq }) }),
    auth: {
      resetPasswordForEmail,
      updateUser,
      getSession,
      getUser,
      signInWithPassword: signInFn,
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
  fetchCurrentAuthProvider,
  signInWithPassword,
  updateUserEmail,
  updateAppUserName,
} from '../account'

beforeEach(() => {
  invoke.mockReset()
  resetPasswordForEmail.mockReset()
  updateUser.mockReset()
  getSession.mockReset()
  getUser.mockReset()
  signInFn.mockReset()
  signOutFn.mockReset()
  updateEq.mockReset()
})

describe('updateAppUserName', () => {
  it('éxito → { error: null } y filtra por id', async () => {
    updateEq.mockResolvedValueOnce({ error: null })
    expect(await updateAppUserName('u1', 'Nuevo Nombre')).toEqual({ error: null })
    expect(updateEq).toHaveBeenCalledWith('id', 'u1')
  })
  it('error → mensaje legible', async () => {
    updateEq.mockResolvedValueOnce({ error: { message: 'denied' } })
    expect(await updateAppUserName('u1', 'X')).toEqual({ error: 'denied' })
  })
})

describe('fetchCurrentAuthProvider', () => {
  it('devuelve el provider del app_metadata', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { app_metadata: { provider: 'google' } } } })
    expect(await fetchCurrentAuthProvider()).toBe('google')
  })
  it('sin sesión → undefined', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } })
    expect(await fetchCurrentAuthProvider()).toBeUndefined()
  })
})

describe('signInWithPassword', () => {
  it('éxito → { error: null }', async () => {
    signInFn.mockResolvedValueOnce({ error: null })
    expect(await signInWithPassword('a@b.com', 'pw')).toEqual({ error: null })
    expect(signInFn).toHaveBeenCalledWith({ email: 'a@b.com', password: 'pw' })
  })
  it('error → mensaje legible', async () => {
    signInFn.mockResolvedValueOnce({ error: { message: 'bad creds' } })
    expect(await signInWithPassword('a@b.com', 'x')).toEqual({ error: 'bad creds' })
  })
})

describe('updateUserEmail', () => {
  it('éxito → pasa email + emailRedirectTo', async () => {
    updateUser.mockResolvedValueOnce({ error: null })
    expect(await updateUserEmail('new@b.com', 'https://app')).toEqual({ error: null })
    expect(updateUser).toHaveBeenCalledWith({ email: 'new@b.com' }, { emailRedirectTo: 'https://app' })
  })
  it('error → mensaje crudo (la UI lo clasifica)', async () => {
    updateUser.mockResolvedValueOnce({ error: { message: 'Email rate limit exceeded' } })
    expect(await updateUserEmail('new@b.com', 'https://app')).toEqual({ error: 'Email rate limit exceeded' })
  })
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

// ── El body { error } de un FunctionsHttpError ──────────────────────────────
//
// `functions.invoke` NO devuelve el cuerpo cuando el status es no-2xx:
// `error.message` es siempre la cadena genérica del SDK y el `{ error }` que la
// edge escribió queda en `error.context`. Importa justo aquí: desde que
// signup-company y create-cliente-account son fail-closed, una caída del RPC
// `rate_limit_hit` devuelve 503 con un mensaje accionable ("intenta de nuevo en
// unos minutos") que sin extraerlo el usuario nunca ve.
describe('createClienteAccount / signupCompany · errores HTTP de la edge', () => {
  const MSG_503 = 'Servicio temporalmente no disponible. Intenta de nuevo en unos minutos.'
  const GENERICO = 'Edge Function returned a non-2xx status code'
  const payloadCliente = {
    full_name: '', email: '', cui_dui: '', fecha_nacimiento: '', password: '', legal_accepted: true,
  }
  const payloadEmpresa = {
    email: '', password: '', full_name: '', company_name: '',
    servicio_agua: true, servicio_condominios: false, legal_accepted: true,
  }

  /** FunctionsHttpError real: la clase se comprueba con `instanceof`. */
  function httpError(status: number, body: unknown) {
    return new FunctionsHttpError(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }

  it('createClienteAccount: un 503 llega a la UI con el mensaje de la edge, no el genérico', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: httpError(503, { error: MSG_503 }) })
    const res = await createClienteAccount(payloadCliente)
    expect(res.error).toBe(MSG_503)
    expect(res.error).not.toBe(GENERICO)
    expect(res.data).toBeNull()
  })

  it('signupCompany: un 503 llega a la UI con el mensaje de la edge, no el genérico', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: httpError(503, { error: MSG_503 }) })
    const res = await signupCompany(payloadEmpresa)
    expect(res.error).toBe(MSG_503)
    expect(res.error).not.toBe(GENERICO)
  })

  it('el 429 del rate limit también se propaga con su mensaje', async () => {
    const msg = 'Demasiados registros desde esta red. Espera una hora e intenta de nuevo.'
    invoke.mockResolvedValueOnce({ data: null, error: httpError(429, { error: msg }) })
    expect((await signupCompany(payloadEmpresa)).error).toBe(msg)
  })

  it('body sin `error` → cae al message del SDK en vez de romper', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: httpError(500, { otra: 'cosa' }) })
    const res = await createClienteAccount(payloadCliente)
    expect(typeof res.error).toBe('string')
    expect(res.error).toBeTruthy()
  })

  it('body no-JSON → no lanza y devuelve un mensaje utilizable', async () => {
    const err = new FunctionsHttpError(new Response('<html>502</html>', { status: 502 }))
    invoke.mockResolvedValueOnce({ data: null, error: err })
    const res = await signupCompany(payloadEmpresa)
    expect(typeof res.error).toBe('string')
    expect(res.error).toBeTruthy()
  })

  it('un error que NO es FunctionsHttpError conserva su message (sin regresión)', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'cliente no encontrado' } })
    expect((await createClienteAccount(payloadCliente)).error).toBe('cliente no encontrado')
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
