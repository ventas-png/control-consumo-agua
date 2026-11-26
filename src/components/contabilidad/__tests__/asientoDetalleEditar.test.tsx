// Detalle de póliza: «Editar» solo en un borrador MANUAL de los tipos que el
// formulario captura, solo con el permiso «Editar» y solo donde la pantalla lo pide.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AsientoConLineas } from '../../../types/contabilidad'

const h = vi.hoisted(() => ({
  asiento: null as unknown,
  permisos: { puedeCambiarEstado: true, puedeEditar: true },
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../domain/contabilidad/queries', () => ({
  useAsientoDetalleQuery: () => ({ data: h.asiento, isLoading: false }),
}))
vi.mock('../../../domain/contabilidad/mutations', () => ({
  usePublicarAsientoMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAnularAsientoMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  usePermisosContabilidad: () => h.permisos,
}))

import { AsientoDetalleModal } from '../AsientoDetalleModal'

const base = {
  id: 'a1', company_id: 'c1', project_id: null, numero: null, fecha: '2026-09-10', periodo: '2026-09',
  tipo: 'diario', concepto: 'Ajuste', estado: 'borrador', origen: 'manual', origen_evento: null,
  anulado_por_id: null, reversa_de_id: null, total_debe: 0, total_haber: 0, conta_asiento_lineas: [],
}
const poner = (cambios: Record<string, unknown> = {}) => { h.asiento = { ...base, ...cambios } as unknown as AsientoConLineas }

describe('AsientoDetalleModal · Editar', () => {
  beforeEach(() => { poner(); h.permisos = { puedeCambiarEstado: true, puedeEditar: true } })
  afterEach(cleanup)

  it('un borrador manual ofrece «Editar» y entrega la póliza', () => {
    const onEditar = vi.fn()
    render(<AsientoDetalleModal asientoId="a1" monedaBase="GTQ" onClose={() => {}} onEditar={onEditar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(onEditar).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }))
  })

  it.each([
    ['publicada', { estado: 'publicado', numero: 7 }],
    ['automática en borrador', { origen: 'automatico', origen_evento: 'pago_contabilizado' }],
    ['apertura en borrador', { tipo: 'apertura' }],
  ])('no se ofrece en una póliza %s', (_nombre, cambios) => {
    poner(cambios)
    render(<AsientoDetalleModal asientoId="a1" monedaBase="GTQ" onClose={() => {}} onEditar={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
  })

  it('sin el permiso «Editar» no se ofrece, aunque pueda publicar', () => {
    h.permisos = { puedeCambiarEstado: true, puedeEditar: false }
    render(<AsientoDetalleModal asientoId="a1" monedaBase="GTQ" onClose={() => {}} onEditar={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeTruthy()
  })

  it('donde la pantalla no pide edición (Pendientes, Estado de cuenta) el detalle es de consulta', () => {
    render(<AsientoDetalleModal asientoId="a1" monedaBase="GTQ" onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
  })
})
