// T7/PR3 — Contrato del dominio shared: storage (condominios-media), suscripción
// activa y create-checkout-session.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'

const { upload, remove, maybeSingle, invoke } = vi.hoisted(() => ({
  upload: vi.fn(), remove: vi.fn(), maybeSingle: vi.fn(), invoke: vi.fn(),
}))
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload, remove }) },
    from: () => ({ select: () => ({ eq: () => ({ in: () => ({ maybeSingle }) }) }) }),
    functions: { invoke },
  },
}))

import { uploadCondominiosMedia, removeCondominiosMedia, uploadMudanzaDoc } from '../storage'
import { fetchActiveSubscription } from '../queries'
import { createCheckoutSession, createBillingPortalSession } from '../mutations'

beforeEach(() => { upload.mockReset(); remove.mockReset(); maybeSingle.mockReset(); invoke.mockReset() })

describe('storage condominios-media', () => {
  it('upload éxito → { data: { path }, error: null }', async () => {
    upload.mockResolvedValueOnce({ data: { path: 'p/x.jpg' }, error: null })
    expect(await uploadCondominiosMedia('p/x.jpg', new Blob(['x']), { contentType: 'image/jpeg' }))
      .toEqual({ data: { path: 'p/x.jpg' }, error: null })
  })
  it('upload error → { data: null, error }', async () => {
    upload.mockResolvedValueOnce({ data: null, error: { message: 'too big' } })
    expect(await uploadCondominiosMedia('p/x', new Blob(['x']))).toEqual({ data: null, error: 'too big' })
  })
  it('remove → contrato { error }', async () => {
    remove.mockResolvedValueOnce({ error: null })
    expect(await removeCondominiosMedia(['p/x'])).toEqual({ error: null })
  })
  it('uploadMudanzaDoc mapea el error a string', async () => {
    upload.mockResolvedValueOnce({ data: null, error: { message: 'mime no permitido' } })
    expect(await uploadMudanzaDoc('u1/x.jpg', new Blob(['x']), { contentType: 'image/jpeg' }))
      .toEqual({ error: 'mime no permitido' })
  })
  it('uploadMudanzaDoc éxito → { error: null }', async () => {
    upload.mockResolvedValueOnce({ data: { path: 'u1/x.jpg' }, error: null })
    expect(await uploadMudanzaDoc('u1/x.jpg', new Blob(['x']))).toEqual({ error: null })
  })
})

describe('fetchActiveSubscription', () => {
  it('devuelve la fila', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { status: 'trialing', trial_end: '2026-01-01' } })
    expect(await fetchActiveSubscription('co1')).toEqual({ status: 'trialing', trial_end: '2026-01-01' })
  })
  it('sin suscripción → null', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null })
    expect(await fetchActiveSubscription('co1')).toBeNull()
  })
})

describe('createCheckoutSession', () => {
  const body = { plan_code: 'pro', billing_cycle: 'monthly', return_path: '/perfil' }
  it('éxito → { url, error: null }', async () => {
    invoke.mockResolvedValueOnce({ data: { url: 'https://checkout' }, error: null })
    expect(await createCheckoutSession(body)).toEqual({ url: 'https://checkout', error: null })
  })
  it('error del edge → { url: null, error }', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'stripe down' } })
    expect(await createCheckoutSession(body)).toEqual({ url: null, error: 'stripe down' })
  })
  it('sin url en la respuesta → { url: null, error: null }', async () => {
    invoke.mockResolvedValueOnce({ data: {}, error: null })
    expect(await createCheckoutSession(body)).toEqual({ url: null, error: null })
  })
  it('FunctionsHttpError → expone el mensaje del body del edge', async () => {
    const ctx = new Response(JSON.stringify({ error: 'Stripe no configurado. Contacta a AdministraTodo.' }), { status: 503 })
    invoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(ctx) })
    expect(await createCheckoutSession(body))
      .toEqual({ url: null, error: 'Stripe no configurado. Contacta a AdministraTodo.' })
  })
})

describe('createBillingPortalSession', () => {
  it('éxito → { url, error: null }', async () => {
    invoke.mockResolvedValueOnce({ data: { url: 'https://portal' }, error: null })
    expect(await createBillingPortalSession()).toEqual({ url: 'https://portal', error: null })
  })
  it('FunctionsHttpError → expone el mensaje del body del edge', async () => {
    const ctx = new Response(JSON.stringify({ error: 'No hay informacion de pago registrada. Primero configura un plan.' }), { status: 404 })
    invoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(ctx) })
    expect(await createBillingPortalSession())
      .toEqual({ url: null, error: 'No hay informacion de pago registrada. Primero configura un plan.' })
  })
  it('FunctionsHttpError con body no-JSON → cae al mensaje genérico', async () => {
    const ctx = new Response('boom', { status: 500 })
    invoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(ctx) })
    const { url, error } = await createBillingPortalSession()
    expect(url).toBeNull()
    expect(error).toMatch(/non-2xx/)
  })
})
