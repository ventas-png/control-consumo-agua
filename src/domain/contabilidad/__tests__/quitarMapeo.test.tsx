// Desasignar un evento borra la fila del LEDGER ACTIVO, y sólo esa.
//
// `conta_mapeo_cuentas.project_id` es NULLABLE: NULL = contabilidad de la
// empresa, con valor = la de ese proyecto. En PostgREST `.eq('project_id',
// null)` NO es `IS NULL` — no filtra lo que uno cree—, así que un borrado que
// confunda las dos formas puede alcanzar la fila equivocada, o ninguna.
//
// Lo que se fija aquí es la FORMA EXACTA de la consulta: empresa + evento +
// ledger, con `.is()` para la empresa y `.eq()` para el proyecto, y nunca un
// delete con menos filtros de los debidos.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// Cada eslabón del chain queda registrado como [método, columna, valor], que es
// lo que de verdad decide a qué filas llega el DELETE.
const llamadas = vi.hoisted(() => [] as Array<[string, string, unknown]>)

vi.mock('../../../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  const registrar = (metodo: string) => (col: string, val: unknown) => {
    llamadas.push([metodo, col, val])
    return chain
  }
  chain.eq = registrar('eq')
  chain.is = registrar('is')
  chain.abortSignal = () => Promise.resolve({ data: null, error: null })
  return {
    supabase: {
      from: (tabla: string) => {
        llamadas.push(['from', tabla, null])
        return {
          delete: () => {
            llamadas.push(['delete', '', null])
            return chain
          },
        }
      },
    },
  }
})

import { useQuitarMapeoMutation } from '../mutations'

function envoltura({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => { llamadas.length = 0 })

describe('useQuitarMapeoMutation', () => {
  it('en el ledger de EMPRESA filtra project_id IS NULL, no eq(null)', async () => {
    const { result } = renderHook(() => useQuitarMapeoMutation('c1'), { wrapper: envoltura })
    await result.current.mutateAsync({ evento: 'resultado_ejercicio', projectId: null })

    expect(llamadas).toContainEqual(['from', 'conta_mapeo_cuentas', null])
    expect(llamadas).toContainEqual(['delete', '', null])
    expect(llamadas).toContainEqual(['eq', 'company_id', 'c1'])
    expect(llamadas).toContainEqual(['eq', 'evento', 'resultado_ejercicio'])
    // La condición del ledger: IS NULL. Un `eq('project_id', null)` aquí sería
    // el bug — no alcanza ninguna fila.
    expect(llamadas).toContainEqual(['is', 'project_id', null])
    expect(llamadas.some(([m, c]) => m === 'eq' && c === 'project_id')).toBe(false)
  })

  it('en el ledger de un PROYECTO filtra por ese project_id exacto', async () => {
    const { result } = renderHook(() => useQuitarMapeoMutation('c1'), { wrapper: envoltura })
    await result.current.mutateAsync({ evento: 'resultado_ejercicio', projectId: 'p1' })

    expect(llamadas).toContainEqual(['eq', 'project_id', 'p1'])
    // Y NUNCA el IS NULL de la empresa: desasignar en un proyecto no puede
    // tocar la configuración de la empresa.
    expect(llamadas.some(([m, c]) => m === 'is' && c === 'project_id')).toBe(false)
  })

  it('el DELETE lleva SIEMPRE las tres condiciones (empresa, evento, ledger)', async () => {
    for (const projectId of [null, 'p1']) {
      llamadas.length = 0
      const { result } = renderHook(() => useQuitarMapeoMutation('c1'), { wrapper: envoltura })
      await result.current.mutateAsync({ evento: 'iva_credito', projectId })

      const filtros = llamadas.filter(([m]) => m === 'eq' || m === 'is').map(([, c]) => c)
      expect(new Set(filtros)).toEqual(new Set(['company_id', 'evento', 'project_id']))
    }
  })

  it('sin companyId no se emite ningún DELETE', async () => {
    const { result } = renderHook(() => useQuitarMapeoMutation(undefined), { wrapper: envoltura })
    await expect(
      result.current.mutateAsync({ evento: 'resultado_ejercicio', projectId: null }),
    ).rejects.toThrow(/companyId/)
    expect(llamadas.some(([m]) => m === 'delete')).toBe(false)
  })

  it('invalida el cache de mapeos y el de cuentas especiales de la empresa', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidadas: unknown[] = []
    vi.spyOn(qc, 'invalidateQueries').mockImplementation((args) => {
      invalidadas.push((args as { queryKey: unknown }).queryKey)
      return Promise.resolve()
    })
    const { result } = renderHook(() => useQuitarMapeoMutation('c1'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    })
    await result.current.mutateAsync({ evento: 'resultado_ejercicio', projectId: 'p1' })

    await waitFor(() => expect(invalidadas).toHaveLength(2))
    // Prefijos SIN el ledger: refrescan la empresa y todos sus proyectos.
    expect(invalidadas).toContainEqual(['contabilidad', 'mapeo', 'c1'])
    expect(invalidadas).toContainEqual(['contabilidad', 'cuentas-especiales', 'c1'])
  })
})
