import { describe, it, expect } from 'vitest'
import { areaDuplicada, nombreAreaDe, normalizarNombreArea } from '../areas'
import type { AreaCondominio } from '../../../types'

function area(over: Partial<AreaCondominio> = {}): AreaCondominio {
  return {
    id: 'a1', company_id: 'co1', project_id: 'p1', nombre: 'Piscina',
    descripcion: null, icono: '🏊', orden: 0, activo: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('normalizarNombreArea — espejo de public.areas_normalizar_nombre', () => {
  it('colapsa espacios, mayúsculas, signos y acentos', () => {
    expect(normalizarNombreArea('  Terraza BBQ ')).toBe('terrazabbq')
    expect(normalizarNombreArea('PISCINA')).toBe('piscina')
    expect(normalizarNombreArea('Jardín')).toBe('jardin')
    // Acentos en MAYÚSCULA: mismo resultado que el normalizador SQL, que los
    // mapea explícitamente por si lc_ctype=C deja la Í sin minusculizar.
    expect(normalizarNombreArea('JARDÍN')).toBe('jardin')
    expect(normalizarNombreArea('Salón de usos-múltiples')).toBe('salondeusosmultiples')
  })

  it('lo que no deja nada comparable es null, no cadena vacía', () => {
    expect(normalizarNombreArea('   ')).toBeNull()
    expect(normalizarNombreArea('')).toBeNull()
    expect(normalizarNombreArea(null)).toBeNull()
    expect(normalizarNombreArea(undefined)).toBeNull()
    expect(normalizarNombreArea('—··—')).toBeNull()
  })
})

describe('areaDuplicada', () => {
  const catalogo = [area(), area({ id: 'a2', nombre: 'Lobby', activo: false })]

  it('detecta el duplicado normalizado aunque cambien espacios/acentos/mayúsculas', () => {
    expect(areaDuplicada(' PISCINA ', catalogo)?.id).toBe('a1')
    // También contra áreas inactivas: reactivar gana sobre duplicar.
    expect(areaDuplicada('lobby', catalogo)?.id).toBe('a2')
  })

  it('renombrar un área no choca consigo misma', () => {
    expect(areaDuplicada('Piscina', catalogo, 'a1')).toBeNull()
  })

  it('nombre nuevo o vacío → sin choque', () => {
    expect(areaDuplicada('Gimnasio', catalogo)).toBeNull()
    expect(areaDuplicada('   ', catalogo)).toBeNull()
  })
})

describe('nombreAreaDe', () => {
  const catalogo = [area({ nombre: 'Piscina principal' })]

  it('con vínculo manda el catálogo', () => {
    expect(nombreAreaDe('a1', catalogo, 'piscina (texto viejo)')).toBe('Piscina principal')
  })

  it('sin vínculo (legado) manda el snapshot', () => {
    expect(nombreAreaDe(null, catalogo, 'piscina (texto viejo)')).toBe('piscina (texto viejo)')
    expect(nombreAreaDe(undefined, catalogo, 'x')).toBe('x')
  })

  it('vínculo a un área que no vino en el catálogo cargado degrada al snapshot', () => {
    expect(nombreAreaDe('fantasma', catalogo, 'texto histórico')).toBe('texto histórico')
  })
})
