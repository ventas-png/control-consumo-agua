// La vista previa de la cuenta de un renglón NO decide nada (lo guarda el
// servidor), pero no puede mentir: ni mostrar la entrada anterior ni confundir
// «sin regla» con «la consulta falló». Usa el hook REAL con `rpc` simulado y
// respuestas que se resuelven cuando el test lo decide (latencia controlada).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

interface Pendiente {
  params: Record<string, unknown>
  resolve: (v: { data: unknown; error: null }) => void
  reject: (e: unknown) => void
}
const m = vi.hoisted(() => ({ pendientes: [] as Pendiente[] }))

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (_nombre: string, params: Record<string, unknown>) => ({
      abortSignal: () =>
        new Promise((resolve, reject) => {
          m.pendientes.push({ params, resolve: resolve as Pendiente['resolve'], reject })
        }),
    }),
  },
  warmUpSupabase: vi.fn(),
}))

import { SugerenciaCuentaLinea } from '../SugerenciaCuentaLinea'

const regla = (codigo: string, nombre: string) =>
  ({ data: [{ cuenta_id: 'x', cuenta_codigo: codigo, cuenta_nombre: nombre, origen: 'regla_compra', regla_id: 'r', motivo: null }], error: null })
const mapeo = { data: [{ cuenta_id: 'y', cuenta_codigo: '5101', cuenta_nombre: 'Gasto general', origen: 'mapeo_evento', regla_id: null, motivo: null }], error: null }

function envolver(ui: ReactNode, qc: QueryClient) {
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}
const nuevoQc = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
const base = { projectId: 'p1', destino: 'gasto' as const, fecha: '2026-10-01' }

const buscar = (cat: string, prov: string | null) =>
  m.pendientes.find((p) => p.params.p_categoria === cat && p.params.p_proveedor_id === prov)

beforeEach(() => { m.pendientes = [] })
afterEach(cleanup)

describe('SugerenciaCuentaLinea', () => {
  it('respuesta LENTA: mientras carga no afirma ninguna cuenta; al llegar, la muestra', async () => {
    render(envolver(<SugerenciaCuentaLinea {...base} indice={0} proveedorId="v1" categoria="obras" />, nuevoQc()))
    const el = screen.getByTestId('sugerencia-0')
    expect(el.getAttribute('data-estado')).toBe('cargando')
    expect(el.textContent).toMatch(/consultando/)
    expect(el.textContent).not.toMatch(/cuenta 5/)

    await act(async () => { buscar('obras', 'v1')!.resolve(regla('5201', 'Obras') as never) })
    await waitFor(() => expect(screen.getByTestId('sugerencia-0').getAttribute('data-estado')).toBe('regla_compra'))
    expect(screen.getByTestId('sugerencia-0').textContent).toMatch(/5201 Obras/)
  })

  it('consulta FALLIDA: se distingue y dice que el servidor igual la resuelve', async () => {
    render(envolver(<SugerenciaCuentaLinea {...base} indice={0} proveedorId="v1" categoria="obras" />, nuevoQc()))
    await act(async () => { buscar('obras', 'v1')!.resolve({ data: null, error: { message: 'timeout de red' } } as never) })
    const el = await screen.findByRole('alert')
    expect(el.getAttribute('data-estado')).toBe('error')
    expect(el.textContent).toMatch(/no se pudo consultar/)
    expect(el.textContent).toMatch(/timeout de red/)
    expect(el.textContent).toMatch(/el servidor la resuelve al guardar/)
  })

  it('«sin regla aplicable» es un RESULTADO válido y se ve distinto de un fallo', async () => {
    render(envolver(<SugerenciaCuentaLinea {...base} indice={0} proveedorId="v1" categoria="limpieza" />, nuevoQc()))
    await act(async () => { buscar('limpieza', 'v1')!.resolve(mapeo as never) })
    const el = await screen.findByTestId('sugerencia-0')
    await waitFor(() => expect(el.getAttribute('data-estado')).toBe('mapeo_evento'))
    expect(el.textContent).toMatch(/sin regla de compra aplicable/)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('cambiar proveedor o categoría NO deja la cuenta de la entrada anterior, aunque la vieja llegue tarde', async () => {
    const qc = nuevoQc()
    const { rerender } = render(envolver(<SugerenciaCuentaLinea {...base} indice={0} proveedorId="v1" categoria="obras" />, qc))
    const vieja = buscar('obras', 'v1')!

    // El usuario cambia de categoría ANTES de que llegue la primera respuesta.
    rerender(envolver(<SugerenciaCuentaLinea {...base} indice={0} proveedorId="v1" categoria="seguridad" />, qc))
    expect(screen.getByTestId('sugerencia-0').getAttribute('data-estado')).toBe('cargando')
    const nueva = buscar('seguridad', 'v1')!

    // Llegan en orden inverso: primero la NUEVA, luego la VIEJA (latencia distinta).
    await act(async () => { nueva.resolve(regla('5301', 'Seguridad') as never) })
    await act(async () => { vieja.resolve(regla('5201', 'Obras') as never) })
    await waitFor(() => expect(screen.getByTestId('sugerencia-0').textContent).toMatch(/5301 Seguridad/))
    expect(screen.getByTestId('sugerencia-0').textContent).not.toMatch(/5201/)

    // Cambiar de proveedor: vuelve a consultar y no arrastra la anterior.
    rerender(envolver(<SugerenciaCuentaLinea {...base} indice={0} proveedorId="v2" categoria="seguridad" />, qc))
    expect(screen.getByTestId('sugerencia-0').getAttribute('data-estado')).toBe('cargando')
    await act(async () => { buscar('seguridad', 'v2')!.resolve(regla('5302', 'Seguridad v2') as never) })
    await waitFor(() => expect(screen.getByTestId('sugerencia-0').textContent).toMatch(/5302 Seguridad v2/))
  })

  it('misma entrada, misma presentación: la latencia no cambia el resultado', async () => {
    const qc = nuevoQc()
    render(envolver(
      <>
        <SugerenciaCuentaLinea {...base} indice={0} proveedorId="v1" categoria="obras" />
        <SugerenciaCuentaLinea {...base} indice={1} proveedorId="v1" categoria="obras" />
      </>, qc))
    // Una sola consulta compartida para la misma entrada.
    expect(m.pendientes.filter((p) => p.params.p_categoria === 'obras')).toHaveLength(1)
    await act(async () => { buscar('obras', 'v1')!.resolve(regla('5201', 'Obras') as never) })
    await waitFor(() => expect(screen.getByTestId('sugerencia-1').textContent).toMatch(/5201 Obras/))
    expect(screen.getByTestId('sugerencia-0').textContent?.replace('Renglón 1', ''))
      .toBe(screen.getByTestId('sugerencia-1').textContent?.replace('Renglón 2', ''))
  })

  it('quitar renglones: cada renglón conserva SU consulta y no hereda la del eliminado', async () => {
    const qc = nuevoQc()
    const { rerender } = render(envolver(
      <>
        <SugerenciaCuentaLinea {...base} indice={0} proveedorId="v1" categoria="obras" />
        <SugerenciaCuentaLinea {...base} indice={1} proveedorId="v1" categoria="seguridad" />
      </>, qc))
    await act(async () => {
      buscar('obras', 'v1')!.resolve(regla('5201', 'Obras') as never)
      buscar('seguridad', 'v1')!.resolve(regla('5301', 'Seguridad') as never)
    })
    await waitFor(() => expect(screen.getByTestId('sugerencia-1').textContent).toMatch(/5301/))

    // Se elimina el renglón 1 (obras): el que queda pasa a ser el 1, con SU cuenta.
    rerender(envolver(<SugerenciaCuentaLinea {...base} indice={0} proveedorId="v1" categoria="seguridad" />, qc))
    await waitFor(() => expect(screen.getByTestId('sugerencia-0').textContent).toMatch(/5301 Seguridad/))
    expect(screen.queryByTestId('sugerencia-1')).toBeNull()
    expect(screen.getByTestId('sugerencia-0').textContent).not.toMatch(/5201/)
  })
})
