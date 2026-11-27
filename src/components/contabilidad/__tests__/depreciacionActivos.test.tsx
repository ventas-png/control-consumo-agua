// Depreciación mensual de activos fijos: previsualizar, aplicar y avisos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DepreciacionFila } from '../../../types/contabilidad'

const h = vi.hoisted(() => ({
  llamadas: [] as { periodo: string; aplicar: boolean; projectId: string | null }[],
  respuesta: (_aplicar: boolean): unknown[] => [],
  error: null as Error | null,
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify }))
vi.mock('../../../domain/contabilidad/mutations', () => ({
  useDepreciarActivosMutation: () => ({
    isPending: false,
    mutateAsync: async (vars: { periodo: string; aplicar: boolean; projectId: string | null }) => {
      h.llamadas.push(vars)
      if (h.error) throw h.error
      return h.respuesta(vars.aplicar)
    },
  }),
}))

import { DepreciacionActivosModal, totalDepreciacion } from '../DepreciacionActivosModal'

const fila = (c: Partial<DepreciacionFila>): DepreciacionFila => ({
  activo_id: 'a1', codigo: 'AF-0001', nombre: 'Bomba sumergible', fecha_alta: '2026-01-15', costo: 12000,
  valor_residual: 0, vida_util_meses: 60, acumulada_antes: 400, depreciacion: 200, valor_en_libros: 11400,
  meses_previos_sin_depreciar: 0, resultado: 'previsualizacion', motivo: null, asiento_id: null, ...c,
})

describe('totalDepreciacion', () => {
  it('suma a centavos solo las filas del resultado pedido', () => {
    const filas = [fila({ depreciacion: 0.1 }), fila({ activo_id: 'a2', depreciacion: 0.2 }), fila({ activo_id: 'a3', depreciacion: 99, resultado: 'ya_depreciado' })]
    expect(totalDepreciacion(filas, 'previsualizacion')).toBe(0.3)
    expect(totalDepreciacion(filas, 'aplicado')).toBe(0)
  })
})

describe('DepreciacionActivosModal', () => {
  beforeEach(() => {
    h.llamadas = []; h.error = null; h.notify.mockReset()
    h.respuesta = (aplicar) => [
      fila({ resultado: aplicar ? 'aplicado' : 'previsualizacion', asiento_id: aplicar ? 'as1' : null }),
      fila({ activo_id: 'a2', codigo: 'AF-0002', nombre: 'Planta eléctrica', depreciacion: 0, resultado: 'no_iniciado', motivo: 'Empieza a depreciarse en 2026-12.' }),
    ]
  })
  afterEach(cleanup)

  const abrir = (puedeAplicar = true) =>
    render(<DepreciacionActivosModal projectId="p1" monedaBase="GTQ" puedeAplicar={puedeAplicar} onClose={vi.fn()} />)

  it('previsualiza sin escribir y habilita «Aplicar» solo si hay algo por depreciar', async () => {
    abrir()
    const aplicar = screen.getByRole('button', { name: /Aplicar depreciación/ }) as HTMLButtonElement
    expect(aplicar.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Mes a depreciar'), { target: { value: '2026-03' } })
    fireEvent.click(screen.getByRole('button', { name: /Previsualizar/ }))
    await waitFor(() => expect(screen.getByText('AF-0001')).toBeTruthy())
    expect(h.llamadas).toEqual([{ periodo: '2026-03', aplicar: false, projectId: 'p1' }])
    expect(screen.getByText('Por depreciar')).toBeTruthy()
    expect(screen.getByText('Aún no inicia')).toBeTruthy()
    expect(screen.getByText('Empieza a depreciarse en 2026-12.')).toBeTruthy()
    expect(screen.getByText('Total por depreciar')).toBeTruthy()
    expect(aplicar.disabled).toBe(false)
  })

  it('aplica el mes elegido, avisa el total y no deja aplicar dos veces', async () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Mes a depreciar'), { target: { value: '2026-03' } })
    fireEvent.click(screen.getByRole('button', { name: /Previsualizar/ }))
    await waitFor(() => expect(screen.getByText('Por depreciar')).toBeTruthy())
    const aplicar = screen.getByRole('button', { name: /Aplicar depreciación/ }) as HTMLButtonElement
    fireEvent.click(aplicar)
    await waitFor(() => expect(screen.getByText('Depreciado')).toBeTruthy())
    expect(h.llamadas[1]).toEqual({ periodo: '2026-03', aplicar: true, projectId: 'p1' })
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', text: expect.stringMatching(/1 activo\(s\).*200\.00/) }))
    expect(screen.getByText('Total depreciado en esta corrida')).toBeTruthy()
    expect(aplicar.disabled).toBe(true)
  })

  it('cambiar de mes descarta la vista previa anterior', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /Previsualizar/ }))
    await waitFor(() => expect(screen.getByText('AF-0001')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Mes a depreciar'), { target: { value: '2026-02' } })
    expect(screen.queryByText('AF-0001')).toBeNull()
    expect((screen.getByRole('button', { name: /Aplicar depreciación/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('avisa cuando hay meses anteriores sin depreciar y cuando faltan cuentas', async () => {
    h.respuesta = () => [
      fila({ meses_previos_sin_depreciar: 2 }),
      fila({ activo_id: 'a3', codigo: 'AF-0003', depreciacion: 0, resultado: 'sin_cuentas', motivo: 'Configure la cuenta especial «Gasto por depreciación».' }),
    ]
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /Previsualizar/ }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/1 activo\(s\) tienen meses anteriores/))
    expect(screen.getByText('Faltan cuentas')).toBeTruthy()
  })

  it('sin permiso de aplicar solo se puede previsualizar', () => {
    abrir(false)
    expect(screen.queryByRole('button', { name: /Aplicar depreciación/ })).toBeNull()
    expect(screen.getByText(/Solo puede previsualizar/)).toBeTruthy()
  })

  it('el error del servidor se muestra tal cual (mes futuro, año cerrado)', async () => {
    h.error = new Error('El ejercicio 2025 está cerrado.')
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /Previsualizar/ }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'El ejercicio 2025 está cerrado.' })))
  })
})
