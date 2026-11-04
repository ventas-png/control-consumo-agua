// Contrato del dominio para la eliminación de la propia cuenta: previsualización (dry_run), borrado con la palabra, mensaje REAL del
// servidor en los no-2xx (409 del único propietario, 503 sin Stripe) y la salida que limpia el rastro local sin depender del signOut remoto.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'

const { invoke, signOutFn, clearSessionFn, clearQueries } = vi.hoisted(() => ({
  invoke: vi.fn(),
  signOutFn: vi.fn(),
  clearSessionFn: vi.fn(),
  clearQueries: vi.fn(),
}))
vi.mock('../../../lib/supabase', () => ({ supabase: { functions: { invoke }, auth: { signOut: signOutFn } } }))
vi.mock('../../../lib/authSession', () => ({ clearSession: clearSessionFn }))
vi.mock('../../queryClient', () => ({ queryClient: { clear: clearQueries } }))

import {
  DELETE_OWN_ACCOUNT_CONFIRM_WORD,
  deleteOwnAccount,
  previewDeleteOwnAccount,
  signOutAfterOwnAccountDeleted,
} from '../account'
import { CONFIRM_WORD } from '../../../../supabase/functions/delete-own-account/validate'

function httpError(status: number, body: unknown): FunctionsHttpError {
  return new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

beforeEach(() => {
  invoke.mockReset()
  signOutFn.mockReset()
  clearSessionFn.mockReset()
  clearQueries.mockReset()
})

describe('previewDeleteOwnAccount', () => {
  it('llama al edge con dry_run y traduce suspende_empresa', async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, dry_run: true, suspende_empresa: true }, error: null })
    expect(await previewDeleteOwnAccount()).toEqual({ data: { suspendeEmpresa: true }, error: null })
    expect(invoke).toHaveBeenCalledWith('delete-own-account', { body: { dry_run: true } })

    invoke.mockResolvedValueOnce({ data: { ok: true, dry_run: true, suspende_empresa: false }, error: null })
    expect(await previewDeleteOwnAccount()).toEqual({ data: { suspendeEmpresa: false }, error: null })
    invoke.mockResolvedValueOnce({ data: null, error: null })
    expect(await previewDeleteOwnAccount()).toEqual({ data: { suspendeEmpresa: false }, error: null })
  })

  it('un 409 devuelve el mensaje que escribió el servidor, no la cadena genérica del SDK', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: httpError(409, { error: 'Eres el único propietario de la empresa y otra persona tiene acceso a ella.' }) })
    const r = await previewDeleteOwnAccount()
    expect(r.data).toBeNull()
    expect(r.error).toMatch(/único propietario/)
  })
})

describe('deleteOwnAccount', () => {
  it('la palabra del cliente es la que exige el servidor, y se manda tal cual en confirm', async () => {
    expect(DELETE_OWN_ACCOUNT_CONFIRM_WORD).toBe(CONFIRM_WORD)
    invoke.mockResolvedValueOnce({ data: { ok: true, empresa_suspendida: false }, error: null })
    expect(await deleteOwnAccount('ELIMINAR')).toEqual({ error: null })
    expect(invoke).toHaveBeenCalledWith('delete-own-account', { body: { confirm: 'ELIMINAR' } })
  })

  it('503 (sin Stripe) y 500 llegan con el mensaje del cuerpo; un error sin cuerpo cae al message', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: httpError(503, { error: 'Tu empresa tiene una suscripción de pago activa…' }) })
    expect((await deleteOwnAccount('ELIMINAR')).error).toMatch(/suscripción de pago activa/)
    invoke.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') })
    expect((await deleteOwnAccount('ELIMINAR')).error).toBe('Failed to fetch')
  })
})

describe('signOutAfterOwnAccountDeleted', () => {
  it('cierra la sesión local, limpia la sesión guardada y la caché de consultas, y redirige al inicio', async () => {
    signOutFn.mockResolvedValueOnce({ error: null })
    const redirigir = vi.fn()
    await signOutAfterOwnAccountDeleted(redirigir)
    expect(signOutFn).toHaveBeenCalledWith({ scope: 'local' })
    expect(clearSessionFn).toHaveBeenCalledTimes(1)
    expect(clearQueries).toHaveBeenCalledTimes(1)
    expect(redirigir).toHaveBeenCalledWith('/')
  })

  it('si el signOut remoto revienta (la identidad ya no existe), el rastro local se limpia igual', async () => {
    signOutFn.mockRejectedValueOnce(new Error('403'))
    const redirigir = vi.fn()
    await signOutAfterOwnAccountDeleted(redirigir)
    expect(clearSessionFn).toHaveBeenCalledTimes(1)
    expect(clearQueries).toHaveBeenCalledTimes(1)
    expect(redirigir).toHaveBeenCalledWith('/')
  })
})
