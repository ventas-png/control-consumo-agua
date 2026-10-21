// Con fugas y medidores parados a la vez, el resumen junto al título no cabe en
// un teléfono: la cabecera debe envolver en vez de apretarlo a ~100px.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { AnomaliaConsumo } from '../../../domain/agua/anomalias'

const mocks = vi.hoisted(() => ({ anomalias: [] as unknown[] }))

vi.mock('../../../domain/agua/anomalias', () => ({
  useAnomaliasConsumoQuery: () => ({ data: mocks.anomalias, isLoading: false }),
  TIPO_ANOMALIA_META: {
    fuga_probable: { label: 'Fuga probable', icon: '💧' },
    medidor_parado: { label: 'Medidor parado', icon: '⏸' },
  },
}))

const { AlertasConsumoCard } = await import('../AlertasConsumoCard')

function anomalia(over: Partial<AnomaliaConsumo>): AnomaliaConsumo {
  return {
    contador_id: 'k1', cliente_id: 'c1', cliente_nombre: 'Ana', project_id: 'p1', ultima_fecha: '2026-10-01',
    ultimo_consumo: 90, promedio: 20, desviacion: 5, z_score: 14, ceros_consecutivos: 0, n_lecturas: 8,
    tipo_anomalia: 'fuga_probable', severidad: 'alta', ...over,
  }
}

afterEach(cleanup)

describe('AlertasConsumoCard', () => {
  it('la cabecera envuelve y el resumen cuenta ambos tipos', () => {
    mocks.anomalias = [
      anomalia({}),
      anomalia({ contador_id: 'k2', cliente_nombre: 'Beto', tipo_anomalia: 'medidor_parado', ceros_consecutivos: 3, severidad: 'media' }),
    ]
    render(<AlertasConsumoCard companyId="co1" />)
    const cabecera = screen.getByRole('heading', { name: 'Alertas de consumo' }).parentElement!
    expect(cabecera.style.flexWrap).toBe('wrap')
    expect(cabecera.textContent).toContain('1 fuga probable · 1 medidor parado')
  })

  it('sin anomalías no ocupa espacio', () => {
    mocks.anomalias = []
    const { container } = render(<AlertasConsumoCard companyId="co1" />)
    expect(container.firstChild).toBeNull()
  })
})
