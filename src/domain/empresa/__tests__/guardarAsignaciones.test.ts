// guardarAsignacionesProyecto (domain/empresa/usuarios): el guardado por diferencias de TRES vías, sin tocar la red más de lo necesario.
//
//   insertar = deseadas \ inicial          borrar = (inicial \ deseadas) ∩ editables
//
// `inicial` es lo que había al ABRIR la pantalla: la función NO lee antes de escribir (una lectura nueva al guardar deshacía el trabajo de otro
// administrador: sondas S4 y S5 del verificador) y SÓLO lee después, para comprobar. Se prueba contra un cliente simulado que anota cada
// petición, con sus opciones.
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface Peticion { op: 'select' | 'upsert' | 'delete'; filas?: Array<Record<string, unknown>>; opts?: Record<string, unknown>; filtros: Array<[string, unknown]> }
const h = vi.hoisted(() => ({
  peticiones: [] as Array<{ op: 'select' | 'upsert' | 'delete'; filas?: Array<Record<string, unknown>>; opts?: Record<string, unknown>; filtros: Array<[string, unknown]> }>,
  respuestas: [] as Array<unknown>,        // una por petición, en orden; 'lanza' = excepción de red
  lectura: [] as string[],                  // lo que devuelve el SELECT posterior
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const p: Peticion = { op: 'select', filtros: [] }
      const api: Record<string, unknown> = {
        select: () => api,
        upsert: (filas: Array<Record<string, unknown>>, opts?: Record<string, unknown>) => { p.op = 'upsert'; p.filas = filas; p.opts = opts; return api },
        delete: () => { p.op = 'delete'; return api },
        eq: (c: string, v: unknown) => { p.filtros.push([c, v]); return api },
        in: (c: string, v: unknown) => { p.filtros.push([c, v]); return api },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          h.peticiones.push(p)
          const r = h.respuestas.shift()
          if (r === 'lanza') return Promise.reject(new TypeError('Failed to fetch')).then(ok, ko)
          if (p.op === 'select') return Promise.resolve({ data: h.lectura.map(project_id => ({ project_id })), error: null, ...(r as object | undefined) }).then(ok, ko)
          return Promise.resolve(r ?? { data: null, error: null }).then(ok, ko)
        },
      }
      return api
    },
    auth: { getSession: vi.fn() },
  },
}))

import { guardarAsignacionesProyecto, AVISO_GUARDADO_PARCIAL } from '../usuarios'

const ops = () => h.peticiones.map(p => p.op)
beforeEach(() => { h.peticiones = []; h.respuestas = []; h.lectura = [] })

describe('guardarAsignacionesProyecto · tres vías', () => {
  it('sin cambios no hace NINGUNA petición (ni siquiera lee)', async () => {
    expect(await guardarAsignacionesProyecto('u1', ['a', 'b'], ['b', 'a'], ['a', 'b', 'c'])).toEqual({ error: null, parcial: false })
    expect(h.peticiones).toEqual([])
  })

  it('NO lee antes de escribir: primero el upsert, luego el delete y SÓLO al final un select de comprobación', async () => {
    h.lectura = ['a', 'c']
    const r = await guardarAsignacionesProyecto('u1', ['a', 'b'], ['a', 'c'], ['a', 'b', 'c'])
    expect(r).toEqual({ error: null, parcial: false })
    expect(ops()).toEqual(['upsert', 'delete', 'select'])
  })

  it('el upsert inserta SÓLO deseadas \\ inicial, con onConflict user_id,project_id e ignoreDuplicates (DO NOTHING)', async () => {
    h.lectura = ['a', 'c', 'd']
    await guardarAsignacionesProyecto('u1', ['a'], ['a', 'c', 'd'], ['a', 'c', 'd'])
    const up = h.peticiones.find(p => p.op === 'upsert')!
    expect(up.filas).toEqual([
      { user_id: 'u1', project_id: 'c', permission_type: 'total' },
      { user_id: 'u1', project_id: 'd', permission_type: 'total' },
    ])
    expect(up.opts).toEqual({ onConflict: 'user_id,project_id', ignoreDuplicates: true })
  })

  it('el delete borra SÓLO (inicial \\ deseadas) ∩ editables, de ESA persona', async () => {
    h.lectura = ['a', 'oculto']
    await guardarAsignacionesProyecto('u1', ['a', 'b', 'oculto'], ['a'], ['a', 'b'])
    const del = h.peticiones.find(p => p.op === 'delete')!
    expect(del.filtros).toEqual([['user_id', 'u1'], ['project_id', ['b']]])      // 'oculto' no está en editables: no se toca
  })

  it('S4 · lo que otro administrador añadió mientras tanto (no está en inicial ni en deseadas) NO se borra: el delete no lo menciona', async () => {
    h.lectura = ['a', 'otro']
    await guardarAsignacionesProyecto('u1', ['a', 'b'], ['a'], ['a', 'b', 'otro'])
    expect(h.peticiones.find(p => p.op === 'delete')!.filtros).toEqual([['user_id', 'u1'], ['project_id', ['b']]])
  })

  it('S5 · lo que otro administrador quitó mientras tanto no se vuelve a insertar si el usuario no lo tocó', async () => {
    h.lectura = ['a', 'c']
    await guardarAsignacionesProyecto('u1', ['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c'])
    expect(h.peticiones.find(p => p.op === 'upsert')!.filas).toEqual([{ user_id: 'u1', project_id: 'c', permission_type: 'total' }])
  })
})

describe('guardarAsignacionesProyecto · fallos', () => {
  it('error del upsert → no borra nada y NO es parcial', async () => {
    h.respuestas = [{ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }]
    const r = await guardarAsignacionesProyecto('u1', ['a'], ['c'], ['a', 'c'])
    expect(r.parcial).toBe(false)
    expect(r.error).toMatch(/No tienes permiso/)
    expect(ops()).toEqual(['upsert'])
  })

  it('upsert bien y delete con error → PARCIAL, con el aviso «se aplicó una parte» y la causa', async () => {
    h.respuestas = [{ data: null, error: null }, { data: null, error: { code: '42501', message: 'permission denied for table user_project_assignments' } }]
    const r = await guardarAsignacionesProyecto('u1', ['a'], ['c'], ['a', 'c'])
    expect(r.parcial).toBe(true)
    expect(r.error).toContain('No tienes permiso')
    expect(r.error).toContain(AVISO_GUARDADO_PARCIAL)
  })

  it('una excepción de red en el upsert NO lanza: error claro y no parcial', async () => {
    h.respuestas = ['lanza']
    const r = await guardarAsignacionesProyecto('u1', ['a'], ['c'], ['a', 'c'])
    expect(r).toMatchObject({ parcial: false })
    expect(r.error).toMatch(/No se pudieron guardar las asignaciones/)
  })

  it('una excepción de red en el delete tras un upsert que valió → parcial', async () => {
    h.respuestas = [{ data: null, error: null }, 'lanza']
    const r = await guardarAsignacionesProyecto('u1', ['a'], ['c'], ['a', 'c'])
    expect(r.parcial).toBe(true)
    expect(r.error).toContain(AVISO_GUARDADO_PARCIAL)
  })

  it('la lectura de comprobación que lanza → parcial (ya se había escrito)', async () => {
    h.respuestas = [{ data: null, error: null }, 'lanza']
    const r = await guardarAsignacionesProyecto('u1', ['a'], ['a', 'c'], ['a', 'c'])
    expect(r.parcial).toBe(true)
  })

  it('un upsert que «vale» pero cuya fila NO aparece en la lectura de comprobación (la quitó otro administrador, o no se insertó) → no se presenta como guardado y es parcial', async () => {
    h.lectura = ['a']               // 'c' debía aparecer y no está; no hay nada que borrar: sólo la comprobación de lo INSERTADO puede verlo
    const r = await guardarAsignacionesProyecto('u1', ['a'], ['a', 'c'], ['a', 'c'])
    expect(r.error).toMatch(/No se aplicaron todos los cambios/)
    expect(r.parcial).toBe(true)
    expect(ops()).toEqual(['upsert', 'select'])
  })

  it('insertar y borrar a la vez: si falta lo insertado aunque lo borrado sí desapareció, tampoco es guardado', async () => {
    h.lectura = ['a']               // 'b' se borró bien; 'c' no está
    const r = await guardarAsignacionesProyecto('u1', ['a', 'b'], ['a', 'c'], ['a', 'b', 'c'])
    expect(r.error).toMatch(/No se aplicaron todos los cambios/)
    expect(r.parcial).toBe(true)
  })

  it('un DELETE que la RLS filtró (la fila sigue ahí) → no se presenta como guardado y es parcial/mixto', async () => {
    h.lectura = ['a', 'b']          // 'b' debía desaparecer y sigue
    const r = await guardarAsignacionesProyecto('u1', ['a', 'b'], ['a'], ['a', 'b'])
    expect(r.error).toMatch(/No se aplicaron todos los cambios/)
    expect(r.parcial).toBe(true)
  })
})
