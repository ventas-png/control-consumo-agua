// T7/PR3 — Contrato de la config de correo (comunicacion/emailConfig): scope
// superadmin vs empresa en los filtros, lecturas que degradan a null/[],
// mutaciones que mapean el error a string, y los edges (token + fetch). Mock
// encadenable que registra el último filtro aplicado + fetch/getSession.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { result: unknown; calls: Array<[string, unknown]> } = { result: { data: null, error: null }, calls: [] }
  const builder: Record<string, unknown> = {}
  // .eq registra el filtro para poder afirmar el scope
  builder.eq = (col: string, val: unknown) => { state.calls.push([col, val]); return builder }
  for (const m of ['select', 'update', 'insert', 'delete', 'order', 'limit', 'maybeSingle']) {
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
  fetchEmailConfig,
  fetchEmailTemplates,
  fetchEmailSendLog,
  deleteEmailConfig,
  updateEmailConfigMeta,
  updateEmailTemplate,
  insertEmailTemplate,
  deleteEmailTemplate,
  initiateGoogleOAuth,
  sendEmail,
} from '../emailConfig'

const fetchMock = vi.fn()

beforeEach(() => {
  h.state.result = { data: null, error: null }
  h.state.calls = []
  h.getSession.mockReset()
  h.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('scope superadmin vs empresa', () => {
  it('fetchEmailConfig superadmin → filtra is_superadmin', async () => {
    h.state.result = { data: { id: 'c1' }, error: null }
    expect(await fetchEmailConfig({ isSuperadmin: true })).toEqual({ id: 'c1' })
    expect(h.state.calls).toContainEqual(['is_superadmin', true])
  })

  it('fetchEmailConfig empresa → filtra company_id', async () => {
    h.state.result = { data: null, error: null }
    expect(await fetchEmailConfig({ isSuperadmin: false, companyId: 'co1' })).toBeNull()
    expect(h.state.calls).toContainEqual(['company_id', 'co1'])
  })

  it('fetchEmailTemplates degrada a [] sin data', async () => {
    h.state.result = { data: null, error: null }
    expect(await fetchEmailTemplates({ isSuperadmin: false, companyId: 'co1' })).toEqual([])
  })

  it('fetchEmailSendLog devuelve filas', async () => {
    h.state.result = { data: [{ id: 1, status: 'sent' }], error: null }
    expect(await fetchEmailSendLog({ isSuperadmin: true })).toEqual([{ id: 1, status: 'sent' }])
    expect(h.state.calls).toContainEqual(['is_superadmin', true])
  })
})

describe('mutaciones', () => {
  it('deleteEmailConfig empresa → filtra company_id, { error: null }', async () => {
    h.state.result = { error: null }
    expect(await deleteEmailConfig({ isSuperadmin: false, companyId: 'co1' })).toEqual({ error: null })
    expect(h.state.calls).toContainEqual(['company_id', 'co1'])
  })

  it('updateEmailConfigMeta error → mensaje legible', async () => {
    h.state.result = { error: { message: 'denied' } }
    expect(await updateEmailConfigMeta('c1', { from_name: 'X', reply_to: null })).toEqual({ error: 'denied' })
  })

  it('updateEmailTemplate éxito', async () => {
    h.state.result = { error: null }
    expect(await updateEmailTemplate('t1', { subject: 'S', html_body: '<p>' })).toEqual({ error: null })
  })

  it('insertEmailTemplate éxito', async () => {
    h.state.result = { error: null }
    expect(await insertEmailTemplate({ isSuperadmin: true }, { template_key: 'recibo', subject: 'S', html_body: '<p>' }))
      .toEqual({ error: null })
  })

  it('deleteEmailTemplate error → mensaje legible', async () => {
    h.state.result = { error: { message: 'fk' } }
    expect(await deleteEmailTemplate('t1')).toEqual({ error: 'fk' })
  })
})

describe('edges (token + fetch)', () => {
  it('initiateGoogleOAuth ok → devuelve url y manda el token', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://google/oauth' }) })
    expect(await initiateGoogleOAuth({ is_superadmin: true })).toEqual({ url: 'https://google/oauth', error: null })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/functions/v1/google-oauth-initiate')
    expect((opts as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer tok')
  })

  it('initiateGoogleOAuth !ok → error del edge', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'sin permiso' }) })
    expect(await initiateGoogleOAuth({})).toEqual({ url: null, error: 'sin permiso' })
  })

  it('initiateGoogleOAuth ok sin url → mensaje por defecto', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    expect(await initiateGoogleOAuth({})).toEqual({ url: null, error: 'No se pudo iniciar la conexión con Google.' })
  })

  it('sendEmail ok → { ok: true }', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    expect(await sendEmail({ template_key: 'difusion' })).toEqual({ ok: true, error: null })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/functions/v1/send-email')
  })

  it('sendEmail !ok → { ok: false, error }', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'cuota excedida' }) })
    expect(await sendEmail({})).toEqual({ ok: false, error: 'cuota excedida' })
  })
})
