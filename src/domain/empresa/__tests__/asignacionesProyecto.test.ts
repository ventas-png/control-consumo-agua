// Reglas puras de la pantalla de asignación de proyectos (domain/empresa/usuarios): quién edita a quién (sólo el PRINCIPAL de la empresa: propietario o
// superadministrador; decisión del dueño del negocio, 2026-10-11), cómo se traducen los errores del servidor (migraciones 20261026000600 y 20261026000700) y qué se
// inserta / borra al pasar de las asignaciones actuales a las deseadas.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}), auth: { getSession: vi.fn() } } }))

import {
  esPrincipalEmpresa,
  puedeCrearProyectos,
  puedeEditarAsignaciones,
  mensajeErrorAsignacion,
  diferenciaAsignaciones,
  veAsistentePrimerProyecto,
  MOTIVO_AUTOASIGNACION,
  MOTIVO_SOLO_PRINCIPAL,
} from '../usuarios'

describe('esPrincipalEmpresa · el principal es el propietario o el superadministrador, nunca un administrador', () => {
  it.each(['company_owner', 'super_admin', 'superadmin'])('%s es principal', rol => {
    expect(esPrincipalEmpresa(rol)).toBe(true)
  })
  it.each(['admin', 'operator', 'operador', 'viewer', 'visor', 'collector', 'cliente', 'user', '', 'Company_Owner', 'ADMIN'])('«%s» NO es principal', rol => {
    expect(esPrincipalEmpresa(rol)).toBe(false)
  })
  it('sin rol (null, undefined) tampoco: una sesión sin fila en app_users no es nadie', () => {
    expect(esPrincipalEmpresa(null)).toBe(false)
    expect(esPrincipalEmpresa(undefined)).toBe(false)
  })
})

describe('puedeEditarAsignaciones · sólo el principal edita asignaciones', () => {
  it.each([
    ['company_owner', 'u1', 'u1'],   // el propietario, sobre sí mismo (es exento: su alcance no cambia)
    ['company_owner', 'u1', 'u2'],
    ['super_admin', 'u1', 'u1'],
    ['super_admin', 'u1', 'u2'],
    ['superadmin', 'u1', 'u1'],
    ['superadmin', 'u1', 'u2'],
  ])('%s edita a %s→%s: sí', (rol, actor, objetivo) => {
    expect(puedeEditarAsignaciones({ id: actor, role: rol }, { id: objetivo })).toEqual({ permitido: true, motivo: null })
  })

  it.each(['admin', 'operator', 'operador', 'viewer', 'visor', 'collector', 'cliente', ''])('%s NO edita a nadie: en su propia fila el motivo es la autoedición', rol => {
    expect(puedeEditarAsignaciones({ id: 'u1', role: rol }, { id: 'u1' })).toEqual({ permitido: false, motivo: MOTIVO_AUTOASIGNACION })
  })

  it.each(['admin', 'operator', 'operador', 'viewer', 'visor', 'collector', 'cliente', ''])('%s NO edita a otra persona: el motivo es que sólo lo hace el propietario', rol => {
    expect(puedeEditarAsignaciones({ id: 'u1', role: rol }, { id: 'u2' })).toEqual({ permitido: false, motivo: MOTIVO_SOLO_PRINCIPAL })
  })

  it('un administrador NO edita a otro administrador ni a un operador (antes sí: D-2 de la decisión del 2026-10-11)', () => {
    expect(puedeEditarAsignaciones({ id: 'a1', role: 'admin' }, { id: 'a2' }).permitido).toBe(false)
    expect(puedeEditarAsignaciones({ id: 'a1', role: 'admin' }, { id: 'op' }).permitido).toBe(false)
  })

  it('los motivos explican quién sí puede', () => {
    expect(MOTIVO_SOLO_PRINCIPAL).toMatch(/propietario/)
    expect(MOTIVO_AUTOASIGNACION).toMatch(/propietario/)
    expect(MOTIVO_AUTOASIGNACION).toMatch(/No puedes cambiar tus propios proyectos/)
  })
})

describe('puedeCrearProyectos · sólo el principal crea proyectos (projects_insert, migración 20261026000700)', () => {
  it.each([['company_owner', true], ['super_admin', true], ['superadmin', true], ['admin', false], ['operator', false], ['viewer', false], ['collector', false], ['cliente', false], ['', false]])(
    '%s → %s', (rol, esperado) => { expect(puedeCrearProyectos(rol)).toBe(esperado) })
})

describe('veAsistentePrimerProyecto · el asistente del primer proyecto es del propietario', () => {
  it.each([['company_owner', true], ['admin', false], ['super_admin', false], ['superadmin', false], ['operator', false], ['viewer', false], ['', false]])(
    '%s → %s', (rol, esperado) => { expect(veAsistentePrimerProyecto(rol)).toBe(esperado) })
  it('sin rol no se ve', () => {
    expect(veAsistentePrimerProyecto(null)).toBe(false)
    expect(veAsistentePrimerProyecto(undefined)).toBe(false)
  })
  it('CABLEADO (la decisión está probada por comportamiento en usuarios.paridadServidor.test.ts): App.tsx se la deja a necesitaAsistentePrimerProyecto con el rol de la sesión y no añade una condición propia', () => {
    const src = readFileSync(resolve('src/App.tsx'), 'utf-8')
    const ini = src.indexOf('const necesitaOnboarding')
    const bloque = src.slice(ini, src.indexOf('\n  })', ini) + 5)
    expect(bloque).toMatch(/necesitaAsistentePrimerProyecto\(\{/)
    for (const campo of [
      'cargando: agua.dataLoading,', 'role: currentUser.role,', 'veEmpresaEntera: agua.projectScope.exempt,',
      'companyId: currentUser.company_id,', 'totalProyectos: agua.proyectos.length,',
    ]) expect(bloque).toContain(campo)
    expect(bloque).not.toMatch(/'admin'|\|\||startsWith|&&/)
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
    expect(mensajeErrorAsignacion({ code: '42501', message: 'x' })).toMatch(/propietario/)      // dice quién sí puede (ya no «los proyectos que tú ves»)
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
