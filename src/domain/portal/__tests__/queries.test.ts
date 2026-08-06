// T7/PR3 — Contrato de las lecturas del portal (bootstrap, config de pago,
// fallbacks y el loader de condominios). Mock encadenable: el builder es thenable
// y resuelve, en orden, los resultados en cola (Promise.all consume uno por query).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  // `calls` registra [tabla, método, args] para poder afirmar CÓMO se acota una
  // query, no solo qué devuelve (p. ej. que los comunicados se filtren por
  // unidad y no por proyecto).
  const state: { results: unknown[]; calls: Array<[string, string, unknown[]]> } = { results: [], calls: [] }
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'gte', 'lt', 'is', 'not', 'order', 'limit', 'single', 'maybeSingle']) {
      b[m] = (...args: unknown[]) => { state.calls.push([table, m, args]); return b }
    }
    b.then = (resolve: (v: unknown) => void) => resolve(state.results.shift())
    return b
  }
  return { state, makeBuilder }
})
vi.mock('../../../lib/supabase', () => ({ db: { from: (table: string) => h.makeBuilder(table) } }))

import {
  fetchPortalBootstrap,
  fetchPortalContadores,
  fetchPortalPaymentConfig,
  fetchPortalFotoIds,
  fetchRegistroFoto,
  fetchRegistrosByContadores,
  fetchCondominiosPortalData,
} from '../queries'

beforeEach(() => { h.state.results = []; h.state.calls = [] })

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
  it('fetchRegistroFoto devuelve el valor de foto del registro', async () => {
    h.state.results = [{ data: { foto: 'cli1/123' } }]
    expect(await fetchRegistroFoto('r1')).toBe('cli1/123')
  })
  it('fetchRegistroFoto sin fila → null', async () => {
    h.state.results = [{ data: null }]
    expect(await fetchRegistroFoto('r1')).toBeNull()
  })
})

describe('fetchPortalFotoIds', () => {
  it('une los ids con foto de cliente + contador + proyecto (sin duplicar)', async () => {
    // 3 queries en paralelo (cliente, contador, proyecto) — una por dataset en cola.
    h.state.results = [
      { data: [{ id: 'a' }, { id: 'b' }] },
      { data: [{ id: 'b' }, { id: 'c' }] },
      { data: [{ id: 'd' }] },
    ]
    const ids = await fetchPortalFotoIds('cli1', ['c1'], ['p1'])
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd'])
  })
  it('solo consulta por cliente cuando no hay contadores ni proyectos', async () => {
    h.state.results = [{ data: [{ id: 'a' }] }]
    expect(await fetchPortalFotoIds('cli1', [], [])).toEqual(['a'])
  })
})

describe('fetchCondominiosPortalData', () => {
  it('mapea los 12 datasets en orden', async () => {
    h.state.results = [
      { data: ['proj'] }, { data: ['amen'] }, { data: ['cuota'] }, { data: ['reserva'] },
      { data: ['bloqueo'] }, { data: ['ticket'] }, { data: ['anuncio'] }, { data: ['visita'] },
      { data: ['mensaje'] }, { data: ['solicitud'] }, { data: ['paquete'] }, { data: ['comunicado'] },
    ]
    expect(await fetchCondominiosPortalData(['p1'], ['u1'])).toEqual({
      projData: ['proj'], amenidadesData: ['amen'], cuotasData: ['cuota'], reservasData: ['reserva'],
      bloqueosData: ['bloqueo'], ticketsData: ['ticket'], anunciosData: ['anuncio'], visitantesData: ['visita'],
      mensajesData: ['mensaje'], solicitudesRentaData: ['solicitud'], paquetesData: ['paquete'],
      comunicadosData: ['comunicado'],
    })
  })

  it('pide los comunicados acotados a las unidades del residente', async () => {
    h.state.results = Array.from({ length: 12 }, () => ({ data: [] }))
    await fetchCondominiosPortalData(['p1'], ['u1'])
    // El filtro es por unidad, NO por proyecto: los comunicados de audiencia
    // amplia llegan al residente vía "Publicar en portal" → anuncios_comunidad,
    // así que un borrador sin publicar nunca se le filtra.
    const call = h.state.calls.find(([tabla]) => tabla === 'comunicados_condominio')
    expect(call).toBeTruthy()
    expect(h.state.calls).toContainEqual(['comunicados_condominio', 'in', ['unidad_id', ['u1']]])
    expect(h.state.calls.some(([t, m]) => t === 'comunicados_condominio' && m === 'eq')).toBe(false)
  })
})
