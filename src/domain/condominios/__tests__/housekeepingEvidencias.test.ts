import { describe, it, expect, vi } from 'vitest'

// El módulo importa el cliente de Supabase, que exige env vars al cargarse.
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))

import { cupoDisponible, MAX_FOTOS_POR_FASE } from '../housekeepingEvidencias'

describe('cupoDisponible', () => {
  it('deja pasar todo si cabe', () => expect(cupoDisponible(0, 5)).toBe(5))
  it('recorta al tope por fase', () => expect(cupoDisponible(18, 5)).toBe(2))
  it('no devuelve negativos con la fase llena', () => expect(cupoDisponible(MAX_FOTOS_POR_FASE, 3)).toBe(0))
  it('el tope es 20', () => expect(MAX_FOTOS_POR_FASE).toBe(20))
})
