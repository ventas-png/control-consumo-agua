// T7/PR3 — Contrato del módulo clientes: mapeo de error, flag alreadyLinked
// (unique 23505) y armado de mapas en las lecturas. Mock encadenable: el builder
// es "thenable" en cada paso y resuelve a `state.result` (configurable por test).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { result: unknown } = { result: { data: null, error: null } }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'order', 'single']) {
    builder[m] = () => builder
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(state.result)
  return { state, builder, rpc: () => builder }
})

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => h.builder, rpc: h.rpc },
}))

import {
  updateCliente,
  linkClienteToCompany,
  addCompanyClientesLinks,
  upsertCompanyClientesLinks,
  setCompanyClienteActivo,
  unlinkClienteFromCompany,
  createContrato,
  deleteContrato,
  createReserva,
} from '../mutations'
import {
  fetchClienteAccountMap,
  fetchCompanyClientesActivoMap,
  buscarClienteParaOnboarding,
} from '../queries'

beforeEach(() => { h.state.result = { data: null, error: null } })
function setResult(r: unknown) { h.state.result = r }

describe('clientes mutations', () => {
  it('updateCliente éxito → devuelve la fila', async () => {
    setResult({ data: { id: 'c1' }, error: null })
    expect(await updateCliente('c1', {})).toEqual({ data: { id: 'c1' }, error: null })
  })

  it('updateCliente error → { data: null, error: mensaje }', async () => {
    setResult({ data: null, error: { message: 'denied' } })
    expect(await updateCliente('c1', {})).toEqual({ data: null, error: 'denied' })
  })

  it('linkClienteToCompany unique 23505 → alreadyLinked, sin error', async () => {
    setResult({ error: { code: '23505', message: 'dup' } })
    expect(await linkClienteToCompany('co1', 'c1', 'u1')).toEqual({ error: null, alreadyLinked: true })
  })

  it('linkClienteToCompany otro error → error legible', async () => {
    setResult({ error: { code: '42501', message: 'rls' } })
    expect(await linkClienteToCompany('co1', 'c1', 'u1')).toEqual({ error: 'rls', alreadyLinked: false })
  })

  it('linkClienteToCompany éxito → sin error ni alreadyLinked', async () => {
    setResult({ error: null })
    expect(await linkClienteToCompany('co1', 'c1', 'u1')).toEqual({ error: null, alreadyLinked: false })
  })

  it('addCompanyClientesLinks → contrato { error }', async () => {
    setResult({ error: null })
    expect(await addCompanyClientesLinks([{ company_id: 'co1', cliente_id: 'c1', added_by: 'u1' }])).toEqual({ error: null })
  })

  it('upsertCompanyClientesLinks → contrato { error }', async () => {
    setResult({ error: { message: 'boom' } })
    expect(await upsertCompanyClientesLinks([])).toEqual({ error: 'boom' })
  })

  it('setCompanyClienteActivo → { error: null }', async () => {
    setResult({ error: null })
    expect(await setCompanyClienteActivo('cc1', false)).toEqual({ error: null })
  })

  it('unlinkClienteFromCompany error → mensaje', async () => {
    setResult({ error: { message: 'fk' } })
    expect(await unlinkClienteFromCompany('c1', 'co1')).toEqual({ error: 'fk' })
  })

  it('createContrato / deleteContrato / createReserva → contrato { error }', async () => {
    setResult({ error: null })
    expect(await createContrato({})).toEqual({ error: null })
    expect(await deleteContrato('x1')).toEqual({ error: null })
    expect(await createReserva({})).toEqual({ error: null })
  })
})

describe('clientes queries', () => {
  it('fetchClienteAccountMap arma el mapa e ignora cliente_id null', async () => {
    setResult({ data: [{ cliente_id: 'a' }, { cliente_id: null }, { cliente_id: 'b' }] })
    expect(await fetchClienteAccountMap(['a', 'b'])).toEqual({ a: true, b: true })
  })

  it('fetchCompanyClientesActivoMap: activo ausente = true', async () => {
    setResult({ data: [
      { id: 'cc1', cliente_id: 'a', activo: false },
      { id: 'cc2', cliente_id: 'b', activo: null },
    ] })
    expect(await fetchCompanyClientesActivoMap('co1', ['a', 'b'])).toEqual({
      a: { ccId: 'cc1', activo: false },
      b: { ccId: 'cc2', activo: true },
    })
  })

  it('buscarClienteParaOnboarding éxito → { data, error: null }', async () => {
    setResult({ data: { match_count: 2 }, error: null })
    expect(await buscarClienteParaOnboarding({ cuiDui: 'x', fechaNac: '2000-01-01', email: 'e@e.com' }))
      .toEqual({ data: { match_count: 2 }, error: null })
  })

  it('buscarClienteParaOnboarding error → mensaje legible', async () => {
    setResult({ data: null, error: { message: 'rpc fail' } })
    expect(await buscarClienteParaOnboarding({ cuiDui: 'x', fechaNac: '2000-01-01', email: 'e@e.com' }))
      .toEqual({ data: null, error: 'rpc fail' })
  })
})
