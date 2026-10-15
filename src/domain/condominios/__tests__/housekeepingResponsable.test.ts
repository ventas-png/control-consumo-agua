import { describe, it, expect, vi } from 'vitest'

// El módulo importa el cliente de Supabase (que exige variables de entorno); aquí
// solo se prueban los helpers puros.
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: () => ({}) } }))

import {
  estadoResponsable, filtrarElegibles, lineaResponsablePdf, mensajeErrorResponsable, preseleccionResponsable,
} from '../housekeepingResponsable'
import type { AppUser } from '../../usuarios/queries'

const ana: AppUser = { id: 'u1', full_name: 'Ana Pérez', role: 'operator', activo: true }
const beto: AppUser = { id: 'u2', full_name: 'Beto López', role: 'admin', activo: true }
const ELEGIBLES = [ana, beto]

describe('estadoResponsable — qué se muestra', () => {
  it('vinculado cuando el usuario sigue siendo elegible, con el nombre que trae el catálogo', () => {
    expect(estadoResponsable({ responsable_user_id: 'u1', responsable: null }, ELEGIBLES)).toEqual({ kind: 'vinculado', userId: 'u1', nombre: 'Ana Pérez' })
  })
  it('requiere reasignación cuando el usuario ya no está entre los elegibles (acceso revocado, deshabilitado…)', () => {
    expect(estadoResponsable({ responsable_user_id: 'u9', responsable: null }, ELEGIBLES)).toEqual({ kind: 'requiere_reasignacion', userId: 'u9' })
  })
  it('no afirma «requiere reasignación» mientras el catálogo no se ha cargado', () => {
    expect(estadoResponsable({ responsable_user_id: 'u9', responsable: null }, null)).toEqual({ kind: 'vinculado', userId: 'u9' })
  })
  it('el texto heredado se muestra como «anterior sin vincular», aunque coincida con un nombre', () => {
    expect(estadoResponsable({ responsable_user_id: null, responsable: 'Ana Pérez' }, ELEGIBLES)).toEqual({ kind: 'anterior_sin_vincular', texto: 'Ana Pérez' })
  })
  it('el usuario vinculado manda sobre el texto heredado', () => {
    expect(estadoResponsable({ responsable_user_id: 'u2', responsable: 'Ana Pérez' }, ELEGIBLES).kind).toBe('vinculado')
  })
  it('sin nada → sin responsable (texto vacío o solo espacios cuenta como nada)', () => {
    expect(estadoResponsable({ responsable_user_id: null, responsable: '   ' }, ELEGIBLES)).toEqual({ kind: 'sin_responsable' })
    expect(estadoResponsable({ responsable_user_id: undefined, responsable: undefined }, null)).toEqual({ kind: 'sin_responsable' })
  })
})

describe('preseleccionResponsable — el conectado solo si es elegible', () => {
  it('preselecciona al conectado cuando está en el catálogo', () => {
    expect(preseleccionResponsable('u1', ELEGIBLES)).toBe('u1')
  })
  it('no preselecciona a quien no es elegible, ni sin catálogo, ni sin sesión', () => {
    expect(preseleccionResponsable('u9', ELEGIBLES)).toBeNull()
    expect(preseleccionResponsable('u1', null)).toBeNull()
    expect(preseleccionResponsable(undefined, ELEGIBLES)).toBeNull()
  })
})

describe('filtrarElegibles — buscador', () => {
  it('filtra por nombre o rol sin distinguir mayúsculas ni acentos', () => {
    expect(filtrarElegibles(ELEGIBLES, 'perez').map(u => u.id)).toEqual(['u1'])
    expect(filtrarElegibles(ELEGIBLES, 'ADMIN').map(u => u.id)).toEqual(['u2'])
    expect(filtrarElegibles(ELEGIBLES, '  ').map(u => u.id)).toEqual(['u1', 'u2'])
    expect(filtrarElegibles(ELEGIBLES, 'zzz')).toEqual([])
  })
  it('no muta la lista original', () => {
    const copia = [...ELEGIBLES]
    filtrarElegibles(ELEGIBLES, 'ana')
    expect(ELEGIBLES).toEqual(copia)
  })
})

describe('lineaResponsablePdf — el responsable no es el autor de las evidencias', () => {
  const nombre = (id: string) => ({ u1: 'Ana Pérez' } as Record<string, string>)[id]
  it('vinculado → nombre', () => {
    expect(lineaResponsablePdf({ kind: 'vinculado', userId: 'u1' }, nombre)).toBe('Responsable: Ana Pérez')
  })
  it('requiere reasignación → lo dice; id desconocido → prefijo del uuid', () => {
    expect(lineaResponsablePdf({ kind: 'requiere_reasignacion', userId: 'u1' }, nombre)).toBe('Responsable: Ana Pérez (requiere reasignación)')
    expect(lineaResponsablePdf({ kind: 'vinculado', userId: 'deadbeef-0000' }, nombre)).toBe('Responsable: Usuario deadbeef')
    // el directorio no lo tiene pero el catálogo sí (otro operador de la empresa)
    expect(lineaResponsablePdf({ kind: 'vinculado', userId: 'u2', nombre: 'Beto López' }, nombre)).toBe('Responsable: Beto López')
  })
  it('texto heredado → «anterior sin vincular»; nada → guion', () => {
    expect(lineaResponsablePdf({ kind: 'anterior_sin_vincular', texto: 'Juan Viejo' }, nombre)).toBe('Responsable anterior sin vincular: Juan Viejo')
    expect(lineaResponsablePdf({ kind: 'sin_responsable' }, nombre)).toBe('Responsable: —')
  })
})

describe('mensajeErrorResponsable', () => {
  it('traduce el rechazo de la base y deja pasar los demás', () => {
    expect(mensajeErrorResponsable('HK_RESPONSABLE_NO_ELEGIBLE: el responsable debe…')).toMatch(/habilitado de la empresa/)
    expect(mensajeErrorResponsable('otro error')).toBe('otro error')
  })
})
