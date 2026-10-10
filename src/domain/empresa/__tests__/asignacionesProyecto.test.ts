// Reglas puras de la pantalla de asignación de proyectos (domain/empresa/usuarios): quién edita a quién, cómo se traducen los errores
// del servidor (migración 20261026000600) y qué se inserta / borra al pasar de las asignaciones actuales a las deseadas.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}), auth: { getSession: vi.fn() } } }))

import {
  puedeEditarAsignaciones,
  mensajeErrorAsignacion,
  diferenciaAsignaciones,
  MOTIVO_AUTOASIGNACION,
} from '../usuarios'

describe('puedeEditarAsignaciones', () => {
  it.each([
    ['admin', 'u1', 'u2', true],      // administrador sobre otra persona
    ['admin', 'u1', 'u1', false],     // … y sobre sí mismo: no (ampliaría su alcance o quedaría exento borrando)
    ['company_owner', 'u1', 'u1', true],
    ['super_admin', 'u1', 'u1', true],
    ['superadmin', 'u1', 'u1', true],
    ['operator', 'u1', 'u1', false],  // (la pantalla no se les ofrece; si llegaran, el servidor rechaza igual)
    ['viewer', 'u1', 'u1', false],
    ['operator', 'u1', 'u2', true],   // sobre otra persona la decisión es del servidor: la pantalla no inventa un permiso que no sabe
  ])('%s edita a %s→%s: %s', (rol, actor, objetivo, esperado) => {
    const r = puedeEditarAsignaciones({ id: actor, role: rol }, { id: objetivo })
    expect(r.permitido).toBe(esperado)
    expect(r.motivo).toBe(esperado ? null : MOTIVO_AUTOASIGNACION)
  })
})

describe('mensajeErrorAsignacion', () => {
  it('sin error → null', () => {
    expect(mensajeErrorAsignacion(null)).toBeNull()
    expect(mensajeErrorAsignacion(undefined)).toBeNull()
  })
  it('ASIGNACION_PROPIA_NO_PERMITIDA → no se cambian los propios proyectos', () => {
    expect(mensajeErrorAsignacion({ code: '42501', message: 'ASIGNACION_PROPIA_NO_PERMITIDA: nadie cambia sus propias asignaciones' }))
      .toBe(MOTIVO_AUTOASIGNACION)
  })
  it('ASIGNACION_EMPRESA_DISTINTA → misma empresa', () => {
    expect(mensajeErrorAsignacion({ code: '23514', message: 'ASIGNACION_EMPRESA_DISTINTA: la persona y el proyecto deben pertenecer a la misma empresa' }))
      .toMatch(/misma empresa/)
  })
  it('42501 de la RLS (por código o por texto) → permiso', () => {
    expect(mensajeErrorAsignacion({ code: '42501', message: 'x' })).toMatch(/No tienes permiso/)
    expect(mensajeErrorAsignacion({ message: 'new row violates row-level security policy for table "user_project_assignments"' })).toMatch(/No tienes permiso/)
    expect(mensajeErrorAsignacion({ message: 'permission denied for table user_project_assignments' })).toMatch(/No tienes permiso/)
  })
  it('lo demás → mensaje genérico en español, sin filtrar el texto técnico', () => {
    const m = mensajeErrorAsignacion({ code: '57014', message: 'canceling statement due to statement timeout' })
    expect(m).toBe('No se pudieron guardar las asignaciones. Intenta de nuevo.')
  })
  it('el código estable gana sobre el 42501 genérico (ASIGNACION_PROPIA también viaja como 42501)', () => {
    expect(mensajeErrorAsignacion({ code: '42501', message: 'ASIGNACION_PROPIA_NO_PERMITIDA' })).toBe(MOTIVO_AUTOASIGNACION)
  })
})

describe('diferenciaAsignaciones', () => {
  it('sin cambios → nada que escribir', () => {
    expect(diferenciaAsignaciones(['a', 'b'], ['b', 'a'])).toEqual({ insertar: [], borrar: [] })
  })
  it('agregar → inserta sólo lo que falta; quitar → borra sólo lo que sobra', () => {
    expect(diferenciaAsignaciones(['a'], ['a', 'b'])).toEqual({ insertar: ['b'], borrar: [] })
    expect(diferenciaAsignaciones(['a', 'b'], ['a'])).toEqual({ insertar: [], borrar: ['b'] })
    expect(diferenciaAsignaciones(['a', 'b'], ['b', 'c'])).toEqual({ insertar: ['c'], borrar: ['a'] })
  })
  it('vaciar → borra todo lo editable; llenar desde cero → inserta todo', () => {
    expect(diferenciaAsignaciones(['a', 'b'], [])).toEqual({ insertar: [], borrar: ['a', 'b'] })
    expect(diferenciaAsignaciones([], ['a', 'b'])).toEqual({ insertar: ['a', 'b'], borrar: [] })
  })
  it('no repite ids de la selección', () => {
    expect(diferenciaAsignaciones([], ['a', 'a', 'b'])).toEqual({ insertar: ['a', 'b'], borrar: [] })
  })
  it('con `editables` NO borra lo que la pantalla no muestra (un proyecto que quien edita no ve)', () => {
    expect(diferenciaAsignaciones(['a', 'oculto'], [], ['a', 'b'])).toEqual({ insertar: [], borrar: ['a'] })
    expect(diferenciaAsignaciones(['oculto'], ['b'], ['a', 'b'])).toEqual({ insertar: ['b'], borrar: [] })
  })
})
