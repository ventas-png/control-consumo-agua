import { describe, it, expect, vi } from 'vitest'
import type { PropiedadRenta } from '../../../types'

vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
const { resolverPropiedad } = await import('../finanzas/ImportarReservasModal')

const p = (id: string, nombre: string, codigo: string | null = null) => ({ id, nombre, codigo }) as PropiedadRenta
const LISTA = [p('1', 'Apto 1A', 'SQ-1A'), p('2', 'Apto. 3C'), p('3', 'Casa Lago'), p('4', 'Casa Lago', 'CL-2')]

describe('resolverPropiedad (carga masiva de varias propiedades)', () => {
  it('por nombre o por código, sin distinguir acentos, puntos ni mayúsculas', () => {
    expect(resolverPropiedad('apto 1a', LISTA)).toBe(LISTA[0])
    expect(resolverPropiedad('sq-1a', LISTA)).toBe(LISTA[0])
    expect(resolverPropiedad(' APTO 3C ', LISTA)).toBe(LISTA[1])
  })
  it('nombre repetido → «varias» (se resuelve con el código); desconocido o vacío → «ninguna»', () => {
    expect(resolverPropiedad('Casa Lago', LISTA)).toBe('varias')
    expect(resolverPropiedad('CL-2', LISTA)).toBe(LISTA[3])
    expect(resolverPropiedad('Apto 9Z', LISTA)).toBe('ninguna')
    expect(resolverPropiedad('', LISTA)).toBe('ninguna')
  })
})
