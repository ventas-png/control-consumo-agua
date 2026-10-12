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

import { guardarAsignacionesProyecto, escrituraAmbigua, AVISO_GUARDADO_PARCIAL, AVISO_RESULTADO_INCIERTO } from '../usuarios'

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

  it('una excepción de red en el upsert NO lanza: el resultado es AMBIGUO (la petición pudo aplicarse) → parcial e incierto, para que quien llama relea (V3-02)', async () => {
    h.respuestas = ['lanza']
    const r = await guardarAsignacionesProyecto('u1', ['a'], ['c'], ['a', 'c'])
    expect(r).toMatchObject({ parcial: true, incierto: true })
    expect(r.error).toMatch(/No se pudieron guardar las asignaciones/)
    expect(r.error).toContain(AVISO_RESULTADO_INCIERTO)
    expect(r.error).not.toContain(AVISO_GUARDADO_PARCIAL)              // no se confirmó ninguna escritura: no se dice «se aplicó una parte»
    expect(ops()).toEqual(['upsert'])                                   // y no se sigue escribiendo a ciegas
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

describe('guardarAsignacionesProyecto · fallos SIN respuesta de la base (V3-02)', () => {
  // @supabase/postgrest-js NO lanza ante un fallo de red: devuelve { error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 }. Sólo una respuesta de la base CON
  // código (RLS 42501, triggers 23514, 23505, 55P03…) deja claro que la sentencia se deshizo; todo lo demás pudo haberse aplicado antes de perderse la respuesta.
  const ERROR_DE_RED = { code: '', message: 'TypeError: Failed to fetch', details: '', hint: '' }

  it.each([
    ['postgrest-js devuelve el fallo de red (status 0, código vacío)', { data: null, error: ERROR_DE_RED, status: 0 }],
    ['un error sin código aunque no traiga status', { data: null, error: { message: 'TypeError: Failed to fetch' } }],
    ['un AbortError devuelto como error', { data: null, error: { code: '', message: 'AbortError: The operation was aborted.' }, status: 0 }],
    ['una pasarela que contesta 502 con HTML y sin código de la base', { data: null, error: { code: '', message: '<html>502 Bad Gateway</html>' }, status: 502 }],
    ['status 0 aunque el error traiga un código', { data: null, error: { code: '42501', message: 'x' }, status: 0 }],
    // H5 (ronda 4): un `code` que no es de la base —el de una pasarela, numérico o con palabras— tampoco es una respuesta definitiva de la base
    ['una pasarela que contesta 504 con un código NUMÉRICO propio', { data: null, error: { code: 504, message: 'Gateway Timeout' }, status: 504 }],
    ['una pasarela que contesta 504 con el código «504» como texto', { data: null, error: { code: '504', message: 'Gateway Timeout' }, status: 504 }],
    ['una pasarela con un código propio en palabras', { data: null, error: { code: 'upstream_timeout', message: 'x' }, status: 504 }],
  ])('el upsert que falla así (%s) es AMBIGUO: parcial e incierto, sin borrar nada', async (_caso, respuesta) => {
    h.respuestas = [respuesta]
    const r = await guardarAsignacionesProyecto('u1', ['a'], ['c'], ['a', 'c'])
    expect(r).toMatchObject({ parcial: true, incierto: true })
    expect(r.error).toContain(AVISO_RESULTADO_INCIERTO)
    expect(r.error).toMatch(/Revisa tu conexión/)
    expect(ops()).toEqual(['upsert'])
  })

  it.each([
    ['la RLS (42501)', { code: '42501', message: 'new row violates row-level security policy' }, 403],
    ['el trigger de autoasignación (42501)', { code: '42501', message: 'ASIGNACION_PROPIA_NO_PERMITIDA: nadie cambia sus propias asignaciones' }, 403],
    ['el trigger de integridad (23514)', { code: '23514', message: 'ASIGNACION_EMPRESA_DISTINTA: la persona y el proyecto deben pertenecer a la misma empresa' }, 400],
    ['el candado de bajas en cascada (55P03, lock timeout)', { code: '55P03', message: 'canceling statement due to lock timeout' }, 409],
    ['el tiempo agotado (57014)', { code: '57014', message: 'canceling statement due to statement timeout' }, 500],
  ])('CON respuesta de la base (%s) la sentencia se deshizo: NO es ambiguo ni parcial', async (_caso, error, status) => {
    h.respuestas = [{ data: null, error, status }]
    const r = await guardarAsignacionesProyecto('u1', ['a'], ['c'], ['a', 'c'])
    expect(r.parcial).toBe(false)
    expect(r.incierto).toBeUndefined()
    expect(r.error).not.toContain(AVISO_RESULTADO_INCIERTO)
    expect(r.error).not.toContain(AVISO_GUARDADO_PARCIAL)
  })

  it('un DELETE solo (sin insert previo) sin respuesta es igual de ambiguo: pudo borrar', async () => {
    h.respuestas = [{ data: null, error: ERROR_DE_RED, status: 0 }]
    const r = await guardarAsignacionesProyecto('u1', ['a', 'b'], ['a'], ['a', 'b'])
    expect(ops()).toEqual(['delete'])
    expect(r).toMatchObject({ parcial: true, incierto: true })
  })

  it('un DELETE que lanza tras un upsert que SÍ valió es «parcial» (hubo una escritura confirmada) y no «incierto»', async () => {
    h.respuestas = [{ data: null, error: null, status: 201 }, 'lanza']
    const r = await guardarAsignacionesProyecto('u1', ['a', 'b'], ['a', 'c'], ['a', 'b', 'c'])
    expect(r.parcial).toBe(true)
    expect(r.incierto).toBeUndefined()
    expect(r.error).toContain(AVISO_GUARDADO_PARCIAL)
  })

  it('una excepción en la lectura de comprobación (tras escribir bien) no lanza y es parcial', async () => {
    h.respuestas = [{ data: null, error: null, status: 201 }, 'lanza']      // 2ª petición = el SELECT posterior (no hay nada que borrar)
    const r = await guardarAsignacionesProyecto('u1', ['a'], ['a', 'c'], ['a', 'c'])
    expect(ops()).toEqual(['upsert', 'select'])
    expect(r.parcial).toBe(true)
    expect(r.error).toMatch(/No se pudo comprobar/)
  })
})

describe('escrituraAmbigua', () => {
  it.each([
    [null, 200, false],
    [undefined, undefined, false],
    [{ code: '42501', message: 'x' }, 403, false],
    [{ code: '23514', message: 'x' }, undefined, false],
    [{ code: 'PGRST301', message: 'JWT expired' }, 401, false],
    [{ code: '', message: 'TypeError: Failed to fetch' }, 0, true],
    [{ code: '', message: 'TypeError: Failed to fetch' }, undefined, true],
    [{ code: null, message: 'x' }, 502, true],
    [{ message: 'sin código' }, undefined, true],
    [{ code: '42501', message: 'x' }, 0, true],      // un status 0 no es una respuesta de la base
  ])('%j (status %s) → %s', (error, status, esperado) => {
    expect(escrituraAmbigua(error, status)).toBe(esperado)
  })

  // H5 (ronda 4): sólo es respuesta DEFINITIVA de la base un SQLSTATE (5 caracteres: dígitos y mayúsculas) o un código de PostgREST («PGRST» + 3 dígitos). Cualquier otro
  // `code` —el numérico o en palabras de una pasarela, un nombre de función…— no prueba que la sentencia llegara a la base y se deshiciera: es ambiguo.
  it.each([
    ['42501', false], ['23514', false], ['23505', false], ['55P03', false], ['57014', false], ['P0001', false], ['XX000', false], ['0A000', false],
    ['PGRST301', false], ['PGRST116', false], ['PGRST000', false],
  ])('el código %s es de la base → no ambiguo (%s)', (code, esperado) => {
    expect(escrituraAmbigua({ code, message: 'x' }, 400)).toBe(esperado)
    expect(escrituraAmbigua({ code, message: 'x' }, 500)).toBe(esperado)
  })

  it.each<[unknown, string]>([
    [504, 'un número'], [42501, 'un número con la forma de un SQLSTATE (postgrest-js siempre lo da como texto)'], ['504', 'tres dígitos como texto'], ['502', 'otro de pasarela'], ['upstream_timeout', 'palabras'], ['gateway', 'palabras'],
    ['4250', 'cuatro caracteres'], ['425011', 'seis caracteres'], ['4250!', 'cinco con un símbolo'], ['abcde', 'cinco en minúsculas'],
    ['PGRST30', 'PGRST con dos dígitos'], ['PGRST3011', 'PGRST con cuatro dígitos'], ['PGRSTabc', 'PGRST con letras'],
    ['pgrst301', 'PGRST en minúsculas'], [' 42501', 'con un espacio'], ['42501 ', 'con un espacio detrás'], [{ n: 1 }, 'un objeto'], [true, 'un booleano'],
  ])('el código %j (%s) NO es de la base → ambiguo', (code, _porque) => {
    expect(escrituraAmbigua({ code: code as never, message: 'x' }, 504)).toBe(true)
    expect(escrituraAmbigua({ code: code as never, message: 'x' }, 400)).toBe(true)
    expect(escrituraAmbigua({ code: code as never, message: 'x' }, undefined)).toBe(true)
  })
})
