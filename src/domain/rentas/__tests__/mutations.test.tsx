// A qué tabla escribe cada reserva: propiedad enlazada → reservas_str (la misma
// que lee Condominios › STR); independiente → rentas_reservas. Y que un UPDATE
// que la RLS deja en 0 filas se reporta como fallo, no como guardado.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { PropiedadRenta } from '../../../types'

const h = vi.hoisted(() => ({ llamadas: [] as { tabla: string; op: string; payload?: unknown; id?: string }[], filas: [{ id: 'x' }] as { id: string }[] }))

vi.mock('../../../lib/supabase', () => {
  const builder = (tabla: string) => {
    const reg: { tabla: string; op: string; payload?: unknown; id?: string } = { tabla, op: '' }
    const b: Record<string, unknown> = {}
    const fin = () => Promise.resolve({ data: reg.op === 'insert' ? { id: 'nuevo' } : h.filas, error: null })
    Object.assign(b, {
      insert: (p: unknown) => { reg.op = 'insert'; reg.payload = p; h.llamadas.push(reg); return b },
      update: (p: unknown) => { reg.op = 'update'; reg.payload = p; h.llamadas.push(reg); return b },
      upsert: (p: unknown, o?: { onConflict?: string }) => { reg.op = 'upsert'; reg.payload = p; reg.id = o?.onConflict; h.llamadas.push(reg); return b },
      delete: () => { reg.op = 'delete'; h.llamadas.push(reg); return b },
      eq: (_c: string, v: string) => { reg.id = v; return b },
      select: () => b,
      single: () => fin(),
      abortSignal: () => Object.assign(fin(), b),
    })
    return b
  }
  return { supabase: { from: (t: string) => builder(t) } }
})

const { useReservasRentaMutations, usePropiedadesRentaMutations } = await import('../mutations')

const wrapper = ({ children }: { children: ReactNode }) =>
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>

const datos = {
  huesped_nombre: 'Ana', huesped_email: null, huesped_telefono: null, fecha_entrada: '2026-12-10', fecha_salida: '2026-12-13',
  num_huespedes: 3, plataforma: 'airbnb' as const, codigo_confirmacion: 'HM1', monto_noche: 100, monto_total: 300,
  estado: 'confirmada' as const, notas: null, politica_cancelacion: null, num_mascotas: 0,
}
const independiente = { id: 'ind', company_id: 'c1', project_id: null, unidad_id: null } as PropiedadRenta
const enlazada = { id: 'enl', company_id: 'c1', project_id: 'p1', unidad_id: 'u1' } as PropiedadRenta

beforeEach(() => { h.llamadas.length = 0; h.filas = [{ id: 'x' }] })

describe('useReservasRentaMutations', () => {
  it('crear en una propiedad independiente escribe rentas_reservas', async () => {
    const { result } = renderHook(() => useReservasRentaMutations('c1'), { wrapper })
    await result.current.crear.mutateAsync({ propiedad: independiente, datos })
    expect(h.llamadas).toHaveLength(1)
    expect(h.llamadas[0]).toMatchObject({ tabla: 'rentas_reservas', op: 'insert', payload: { company_id: 'c1', propiedad_id: 'ind', num_huespedes: 3 } })
  })

  it('crear en una propiedad enlazada escribe reservas_str con su proyecto y unidad', async () => {
    const { result } = renderHook(() => useReservasRentaMutations('c1'), { wrapper })
    await result.current.crear.mutateAsync({ propiedad: enlazada, datos })
    expect(h.llamadas).toHaveLength(1)
    expect(h.llamadas[0]).toMatchObject({
      tabla: 'reservas_str', op: 'insert',
      payload: { company_id: 'c1', project_id: 'p1', unidad_id: 'u1', huesped_nombre: 'Ana', num_adultos: 3, codigo_confirmacion: 'HM1' },
    })
    const payload = h.llamadas[0].payload as Record<string, unknown>
    expect(payload).not.toHaveProperty('num_huespedes')
    expect(payload).not.toHaveProperty('propiedad_id')
  })

  it('editar una de condominio va a reservas_str y NO pisa el desglose de huéspedes', async () => {
    const { result } = renderHook(() => useReservasRentaMutations('c1'), { wrapper })
    await result.current.actualizar.mutateAsync({ reserva: { id: 's1', origen: 'condominio' }, datos })
    expect(h.llamadas[0]).toMatchObject({ tabla: 'reservas_str', op: 'update', id: 's1' })
    const payload = h.llamadas[0].payload as Record<string, unknown>
    expect(payload).not.toHaveProperty('num_huespedes')
    expect(payload).not.toHaveProperty('num_adultos')
    await result.current.actualizar.mutateAsync({ reserva: { id: 'r1', origen: 'rentas' }, datos: { estado: 'cancelada' } })
    expect(h.llamadas[1]).toMatchObject({ tabla: 'rentas_reservas', op: 'update', id: 'r1', payload: { estado: 'cancelada' } })
  })

  it('un cambio que la base deja en 0 filas (RLS) se reporta como error', async () => {
    h.filas = []
    const { result } = renderHook(() => useReservasRentaMutations('c1'), { wrapper })
    await expect(result.current.actualizar.mutateAsync({ reserva: { id: 's1', origen: 'condominio' }, datos: { estado: 'en_curso' } }))
      .rejects.toThrow(/no tienes permiso/)
    await expect(result.current.eliminar.mutateAsync('r1')).rejects.toThrow(/no tienes permiso/)
    await waitFor(() => expect(result.current.eliminar.isError).toBe(true))
  })
})

describe('usePropiedadesRentaMutations', () => {
  it('eliminar sin fila de vuelta se reporta como error', async () => {
    h.filas = []
    const { result } = renderHook(() => usePropiedadesRentaMutations('c1'), { wrapper })
    await expect(result.current.eliminar.mutateAsync('p')).rejects.toThrow(/no tienes permiso/)
    expect(h.llamadas[0]).toMatchObject({ tabla: 'rentas_propiedades', op: 'delete', id: 'p' })
  })
})

describe('desglose de cobro', () => {
  it('crear con desglose: primero la reserva, luego su liquidación, colgada de la tabla que toca', async () => {
    const { result } = renderHook(() => useReservasRentaMutations('c1'), { wrapper })
    await result.current.crear.mutateAsync({ propiedad: independiente, datos, importes: { a1: 39 } })
    expect(h.llamadas.map(l => `${l.tabla}:${l.op}`)).toEqual(['rentas_reservas:insert', 'rentas_liquidaciones:upsert'])
    expect(h.llamadas[1]).toMatchObject({ id: 'reserva_id', payload: { company_id: 'c1', propiedad_id: 'ind', reserva_id: 'nuevo', importes: { a1: 39 } } })

    h.llamadas.length = 0
    await result.current.crear.mutateAsync({ propiedad: enlazada, datos, importes: { a1: 39 } })
    expect(h.llamadas[0]).toMatchObject({ tabla: 'reservas_str', payload: { politica_cancelacion: null, mascotas: false } })
    expect(h.llamadas[1]).toMatchObject({ tabla: 'rentas_liquidaciones', id: 'reserva_str_id', payload: { propiedad_id: 'enl', reserva_str_id: 'nuevo' } })
  })

  it('sin desglose (o vacío) no se escribe liquidación al crear', async () => {
    const { result } = renderHook(() => useReservasRentaMutations('c1'), { wrapper })
    await result.current.crear.mutateAsync({ propiedad: independiente, datos, importes: {} })
    await result.current.crear.mutateAsync({ propiedad: independiente, datos })
    expect(h.llamadas.map(l => l.tabla)).toEqual(['rentas_reservas', 'rentas_reservas'])
  })

  it('editar: un desglose vacío SÍ viaja (es vaciar el que había); el de condominio no pisa huéspedes ni mascotas', async () => {
    const { result } = renderHook(() => useReservasRentaMutations('c1'), { wrapper })
    await result.current.actualizar.mutateAsync({ reserva: { id: 's1', origen: 'condominio' }, datos: { ...datos }, propiedad: enlazada, importes: {} })
    expect(h.llamadas.map(l => `${l.tabla}:${l.op}`)).toEqual(['reservas_str:update', 'rentas_liquidaciones:upsert'])
    expect(h.llamadas[0].payload).not.toHaveProperty('num_huespedes')
    expect(h.llamadas[0].payload).not.toHaveProperty('num_mascotas')
    expect(h.llamadas[1]).toMatchObject({ id: 'reserva_str_id', payload: { reserva_str_id: 's1', importes: {} } })
  })

  it('un desglose que la RLS deja en 0 filas se reporta como fallo', async () => {
    h.filas = []
    const { result } = renderHook(() => useReservasRentaMutations('c1'), { wrapper })
    await expect(result.current.crear.mutateAsync({ propiedad: independiente, datos, importes: { a1: 1 } })).rejects.toThrow(/guardar el desglose/)
  })
})

describe('datos de la estancia: qué columna va a qué tabla', () => {
  const estancia = { ...datos, num_huespedes: 4, num_adultos: 2, num_ninos: 1, num_bebes: 1, fecha_reservacion: '2026-11-01', hora_llegada_estimada: '15:00', hora_salida_estimada: null, foto_url: 'f.jpg', foto_documento_url: null }
  it('independiente: total, niños, bebés y fotos; sin adultos (se derivan del total)', async () => {
    const { result } = renderHook(() => useReservasRentaMutations('c1'), { wrapper })
    await result.current.crear.mutateAsync({ propiedad: independiente, datos: estancia })
    const p = h.llamadas[0].payload as Record<string, unknown>
    expect(p).toMatchObject({ num_huespedes: 4, num_ninos: 1, num_bebes: 1, fecha_reservacion: '2026-11-01', hora_llegada_estimada: '15:00' })
    expect(p).not.toHaveProperty('num_adultos')
    expect(p).toMatchObject({ foto_url: 'f.jpg', foto_documento_url: null })
  })
  it('enlazada: desglose, fotos y mascotas como sí/no; sin el total ni el número de mascotas', async () => {
    const { result } = renderHook(() => useReservasRentaMutations('c1'), { wrapper })
    await result.current.actualizar.mutateAsync({ reserva: { id: 's1', origen: 'condominio' }, datos: { ...estancia, num_mascotas: 2 } })
    const p = h.llamadas[0].payload as Record<string, unknown>
    expect(p).toMatchObject({ num_adultos: 2, num_ninos: 1, num_bebes: 1, foto_url: 'f.jpg', foto_documento_url: null, mascotas: true })
    expect(p).not.toHaveProperty('num_huespedes')
    expect(p).not.toHaveProperty('num_mascotas')
  })
  it('un cambio parcial (sólo el estado) no arrastra columnas que no vinieron', async () => {
    const { result } = renderHook(() => useReservasRentaMutations('c1'), { wrapper })
    await result.current.actualizar.mutateAsync({ reserva: { id: 's1', origen: 'condominio' }, datos: { estado: 'en_curso' } })
    expect(h.llamadas[0].payload).toEqual({ estado: 'en_curso' })
  })
})
