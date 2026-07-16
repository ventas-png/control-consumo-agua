import { describe, it, expect, vi } from 'vitest'

// queries.ts importa `db` de lib/supabase (throw sin env vars). rangoUltimosMeses
// es puro; mockeamos el módulo para poder importarlo sin tocar Supabase.
vi.mock('../../../lib/supabase', () => ({ db: {}, supabase: {} }))

import { rangoUltimosMeses } from '../queries'

describe('rangoUltimosMeses', () => {
  it('devuelve [desde, hasta] en YYYY-MM incluyendo el mes actual', () => {
    // 15 de julio de 2026 (UTC).
    const hoy = new Date(Date.UTC(2026, 6, 15, 10))
    expect(rangoUltimosMeses(6, hoy)).toEqual({ desde: '2026-02', hasta: '2026-07' })
  })

  it('cruza el cambio de año hacia atrás', () => {
    const hoy = new Date(Date.UTC(2026, 1, 3)) // febrero 2026
    expect(rangoUltimosMeses(6, hoy)).toEqual({ desde: '2025-09', hasta: '2026-02' })
  })

  it('meses=1 devuelve solo el mes actual', () => {
    const hoy = new Date(Date.UTC(2026, 11, 20)) // diciembre 2026
    expect(rangoUltimosMeses(1, hoy)).toEqual({ desde: '2026-12', hasta: '2026-12' })
  })

  it('12 meses cubre exactamente un año hasta el mes actual', () => {
    const hoy = new Date(Date.UTC(2026, 6, 1))
    expect(rangoUltimosMeses(12, hoy)).toEqual({ desde: '2025-08', hasta: '2026-07' })
  })
})
