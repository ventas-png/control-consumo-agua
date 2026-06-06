// T7/PR3 — Contrato de las lecturas del portal (bootstrap, config de pago,
// fallbacks y el loader de condominios). Mock encadenable: el builder es thenable
// y resuelve, en orden, los resultados en cola (Promise.all consume uno por query).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { results: unknown[] } = { results: [] }
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'gte', 'lt', 'is', 'order', 'limit', 'single', 'maybeSingle']) {
    b[m] = () => b
  }
  b.then = (resolve: (v: unknown) => void) => resolve(state.results.shift())
  return { state, b }
})
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => h.b } }))

import {
  fetchPortalBootstrap,
  fetchPortalContadores,
  fetchPortalPaymentConfig,
  fetchRegistrosByContadores,
  fetchCondominiosPortalData,
} from '../queries'

beforeEach(() => { h.state.results = [] })

describe('fetchPortalBootstrap', () => {
  it('mapea los 4 datasets en orden', async () => {
    h.state.results = [{ data: ['cc'] }, { data: ['u'] }, { data: ['r'] }, { data: { email: 'a' } }]
    expect(await fetchPortalBootstrap('cli1')).toEqual({
      ccData: ['cc'], uData: ['u'], rData: ['r'], clData: { email: 'a' },
    })
  })
})

describe('fetchPortalPaymentConfig', () => {
  it('devuelve la fila', async () => {
    h.state.results = [{ data: { stripe_configured: true, stripe_activo: true, paypal_configured: false, paypal_activo: true } }]
    expect(await fetchPortalPaymentConfig('co1')).toEqual({
      stripe_configured: true, stripe_activo: true, paypal_configured: false, paypal_activo: true,
    })
  })
  it('sin config → null', async () => {
    h.state.results = [{ data: null }]
    expect(await fetchPortalPaymentConfig('co1')).toBeNull()
  })
})

describe('lecturas de portal (data cruda nullable)', () => {
  it('fetchPortalContadores devuelve data', async () => {
    h.state.results = [{ data: [{ id: 'c1' }] }]
    expect(await fetchPortalContadores(['u1'])).toEqual([{ id: 'c1' }])
  })
  it('fetchRegistrosByContadores con data null → null', async () => {
    h.state.results = [{ data: null }]
    expect(await fetchRegistrosByContadores(['c1'])).toBeNull()
  })
})

describe('fetchCondominiosPortalData', () => {
  it('mapea los 11 datasets en orden', async () => {
    h.state.results = [
      { data: ['proj'] }, { data: ['amen'] }, { data: ['cuota'] }, { data: ['reserva'] },
      { data: ['bloqueo'] }, { data: ['ticket'] }, { data: ['anuncio'] }, { data: ['visita'] },
      { data: ['mensaje'] }, { data: ['solicitud'] }, { data: ['paquete'] },
    ]
    expect(await fetchCondominiosPortalData(['p1'], ['u1'])).toEqual({
      projData: ['proj'], amenidadesData: ['amen'], cuotasData: ['cuota'], reservasData: ['reserva'],
      bloqueosData: ['bloqueo'], ticketsData: ['ticket'], anunciosData: ['anuncio'], visitantesData: ['visita'],
      mensajesData: ['mensaje'], solicitudesRentaData: ['solicitud'], paquetesData: ['paquete'],
    })
  })
})
