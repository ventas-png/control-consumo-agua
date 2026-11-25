// Panel «Puesta en marcha»: aparece solo mientras falte algo, no afirma nada
// hasta tener todas las respuestas, y cada paso lleva a la pestaña que lo resuelve.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EVENTOS_MAPEO } from '../../../types/contabilidad'

const q = <T,>(data: T, isSuccess = true) => ({ data, isSuccess })
const state = vi.hoisted(() => ({
  cuentas: [] as unknown[], especiales: [] as unknown[], mapeo: [] as { evento: string }[],
  tipos: [] as unknown[], apertura: false, bancos: [] as unknown[], cargando: false,
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../domain/contabilidad/queries', () => ({
  useCuentasQuery: () => q(state.cuentas, !state.cargando),
  useCuentasEspecialesQuery: () => q(state.especiales),
  useMapeoQuery: () => q(state.mapeo),
  useConfigTiposCargoQuery: () => q(state.tipos),
  useHayAperturaQuery: () => q(state.apertura),
}))
vi.mock('../../../domain/bancos/queries', () => ({
  useCuentasBancariasQuery: () => q(state.bancos),
}))

import { PuestaEnMarchaPanel } from '../PuestaEnMarchaPanel'

function completa() {
  state.cuentas = [{ id: 'c1' }]
  state.especiales = [{ etiqueta: 'Resultado del ejercicio', estado: 'ok', bloqueante: true }]
  state.mapeo = EVENTOS_MAPEO.map((e) => ({ evento: e.evento }))
  state.tipos = [{ etiqueta: 'Mantenimiento', estado: 'ok' }]
  state.apertura = true
  state.bancos = [{ id: 'b1' }]
  state.cargando = false
}

describe('PuestaEnMarchaPanel', () => {
  beforeEach(completa)
  afterEach(cleanup)

  it('con todo listo no ocupa lugar', () => {
    const { container } = render(<PuestaEnMarchaPanel companyId="c" projectId="p" onIrA={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('mientras alguna consulta no ha respondido no afirma que falte nada', () => {
    state.cuentas = []
    state.cargando = true
    const { container } = render(<PuestaEnMarchaPanel companyId="c" projectId="p" onIrA={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('con un requerido pendiente se abre solo, lo explica y lleva a la pestaña que lo resuelve', () => {
    state.mapeo = state.mapeo.filter((m) => m.evento !== 'ingreso_agua')
    const onIrA = vi.fn()
    render(<PuestaEnMarchaPanel companyId="c" projectId="p" onIrA={onIrA} />)
    expect(screen.getByText(/5 de 6 pasos listos/)).toBeTruthy()
    expect(screen.getByText(/falta 1 requerido/)).toBeTruthy()
    expect(screen.getByText(/1 sin cuenta: Servicio de agua\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Completar mapeo' }))
    expect(onIrA).toHaveBeenCalledWith('configuracion')
  })

  it('si solo faltan recomendados queda plegado en una línea y se abre a pedido', () => {
    state.bancos = []
    render(<PuestaEnMarchaPanel companyId="c" projectId="p" onIrA={vi.fn()} />)
    expect(screen.getByText(/5 de 6 pasos listos/)).toBeTruthy()
    expect(screen.queryByText(/requerido/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Agregar cuenta' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver pasos' }))
    expect(screen.getByRole('button', { name: 'Agregar cuenta' })).toBeTruthy()
  })

  it('en la contabilidad de la empresa no se piden tipos de cargo', () => {
    state.tipos = [{ etiqueta: 'Mantenimiento', estado: 'sin_configurar' }]
    state.bancos = []
    render(<PuestaEnMarchaPanel companyId="c" projectId={null} onIrA={vi.fn()} />)
    expect(screen.getByText(/4 de 5 pasos listos/)).toBeTruthy()
  })
})
