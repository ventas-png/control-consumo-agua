// T7/PR3 — Contrato del I/O de MFA TOTP (auth/mfaActions): wrappers sobre
// supabase.auth.mfa.* que mapean a { data?, error }.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { listFactors, enroll, challenge, verify, unenroll } = vi.hoisted(() => ({
  listFactors: vi.fn(), enroll: vi.fn(), challenge: vi.fn(), verify: vi.fn(), unenroll: vi.fn(),
}))
vi.mock('../../../lib/supabase', () => ({
  supabase: { auth: { mfa: { listFactors, enroll, challenge, verify, unenroll } } },
}))

import {
  listMfaFactors,
  enrollTotpFactor,
  challengeMfaFactor,
  verifyMfaFactor,
  unenrollMfaFactor,
} from '../mfaActions'

beforeEach(() => {
  listFactors.mockReset(); enroll.mockReset(); challenge.mockReset(); verify.mockReset(); unenroll.mockReset()
})

describe('listMfaFactors', () => {
  it('éxito → { data, error: null }', async () => {
    listFactors.mockResolvedValueOnce({ data: { all: [{ id: 'f1' }] }, error: null })
    expect(await listMfaFactors()).toEqual({ data: { all: [{ id: 'f1' }] }, error: null })
  })
  it('error → mensaje legible y data null', async () => {
    listFactors.mockResolvedValueOnce({ data: null, error: { message: 'aal' } })
    expect(await listMfaFactors()).toEqual({ data: null, error: 'aal' })
  })
})

describe('enrollTotpFactor', () => {
  it('éxito → devuelve qr+secret e invoca con factorType totp', async () => {
    enroll.mockResolvedValueOnce({ data: { id: 'f1', totp: { qr_code: '<svg>', secret: 'S' } }, error: null })
    expect(await enrollTotpFactor('Auth')).toEqual({ data: { id: 'f1', totp: { qr_code: '<svg>', secret: 'S' } }, error: null })
    expect(enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'Auth' })
  })
})

describe('challengeMfaFactor', () => {
  it('éxito → { data: { id }, error: null }', async () => {
    challenge.mockResolvedValueOnce({ data: { id: 'ch1' }, error: null })
    expect(await challengeMfaFactor('f1')).toEqual({ data: { id: 'ch1' }, error: null })
    expect(challenge).toHaveBeenCalledWith({ factorId: 'f1' })
  })
})

describe('verifyMfaFactor', () => {
  it('éxito → { error: null } con los 3 args', async () => {
    verify.mockResolvedValueOnce({ error: null })
    expect(await verifyMfaFactor('f1', 'ch1', '123456')).toEqual({ error: null })
    expect(verify).toHaveBeenCalledWith({ factorId: 'f1', challengeId: 'ch1', code: '123456' })
  })
  it('error → mensaje legible', async () => {
    verify.mockResolvedValueOnce({ error: { message: 'invalid' } })
    expect(await verifyMfaFactor('f1', 'ch1', '000000')).toEqual({ error: 'invalid' })
  })
})

describe('unenrollMfaFactor', () => {
  it('éxito → { error: null }', async () => {
    unenroll.mockResolvedValueOnce({ error: null })
    expect(await unenrollMfaFactor('f1')).toEqual({ error: null })
    expect(unenroll).toHaveBeenCalledWith({ factorId: 'f1' })
  })
})
