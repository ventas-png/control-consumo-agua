// Los modales de póliza piden el catálogo DEL LEDGER activo.
//
// Regresión: ambos llamaban `useCuentasQuery(companyId)` sin el projectId. La
// query, sin ese argumento, filtra `project_id IS NULL` — o sea el catálogo de
// la EMPRESA — así que en la contabilidad de un proyecto la pantalla ofrecía
// las cuentas de la empresa y armaba el asiento contra ellas (la apertura del
// proyecto mostraba los bancos de la empresa; la póliza moría al publicar con
// "cuentas de otra contabilidad" y dejaba el borrador cruzado atrás).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import type { CuentaContable } from '../../../types/contabilidad'

const state = vi.hoisted(() => ({
  llamadas: [] as Array<{ companyId?: string; projectId?: string | null }>,
  cuentas: [] as CuentaContable[],
}))

// El barril de `../shared` arrastra el cliente de Supabase, que exige las env
// vars VITE_SUPABASE_* inexistentes en test.
vi.mock('../../../lib/supabase', () => ({
  supabase: {},
  warmUpSupabase: vi.fn(),
}))

vi.mock('../../../domain/contabilidad/queries', () => ({
  useCuentasQuery: (companyId?: string, projectId?: string | null) => {
    state.llamadas.push({ companyId, projectId })
    return { data: state.cuentas }
  },
}))
vi.mock('../../../domain/contabilidad/mutations', () => ({
  useCrearAsientoBorradorMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePublicarAsientoMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

import { AperturaSaldosModal } from '../AperturaSaldosModal'
import { AsientoFormModal } from '../AsientoFormModal'

function cuenta(id: string, codigo: string, nombre: string): CuentaContable {
  return {
    id, codigo, nombre,
    company_id: 'c1', project_id: null,
    tipo: 'activo', naturaleza: 'deudora', padre_id: null, nivel: 4,
    es_detalle: true, activa: true, es_sistema: false, moneda: null,
    created_at: '', updated_at: '',
  } as CuentaContable
}

beforeEach(() => {
  state.llamadas = []
  state.cuentas = [cuenta('cta-p1', '1102-01', 'Banco del proyecto')]
})
afterEach(cleanup)

describe('AperturaSaldosModal', () => {
  it('pide el catálogo del PROYECTO cuando la contabilidad activa es un proyecto', () => {
    render(<AperturaSaldosModal companyId="c1" projectId="p1" monedaBase="GTQ" onClose={() => {}} />)
    expect(state.llamadas).toContainEqual({ companyId: 'c1', projectId: 'p1' })
    expect(state.llamadas.every((l) => l.projectId === 'p1')).toBe(true)
    expect(screen.getByText(/1102-01 — Banco del proyecto/)).toBeTruthy()
  })

  it('pide el catálogo de la EMPRESA cuando la contabilidad activa es la empresa', () => {
    render(<AperturaSaldosModal companyId="c1" projectId={null} monedaBase="GTQ" onClose={() => {}} />)
    expect(state.llamadas).toContainEqual({ companyId: 'c1', projectId: null })
  })
})

describe('AsientoFormModal', () => {
  it('pide el catálogo del PROYECTO cuando la contabilidad activa es un proyecto', () => {
    render(<AsientoFormModal companyId="c1" projectId="p1" monedaBase="GTQ" onClose={() => {}} />)
    expect(state.llamadas).toContainEqual({ companyId: 'c1', projectId: 'p1' })
    expect(state.llamadas.every((l) => l.projectId === 'p1')).toBe(true)
  })

  it('pide el catálogo de la EMPRESA cuando la contabilidad activa es la empresa', () => {
    render(<AsientoFormModal companyId="c1" projectId={null} monedaBase="GTQ" onClose={() => {}} />)
    expect(state.llamadas).toContainEqual({ companyId: 'c1', projectId: null })
  })
})
