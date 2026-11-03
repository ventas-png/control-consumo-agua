import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'

// Stub del cliente Supabase para evitar el throw de env vars al cargar el
// módulo. Los tests siempre pasan un cliente mock explícito vía
// `options.client`, así que el default importado no se ejercita aquí.
vi.mock('../supabase', () => ({
  supabase: { from: () => { throw new Error('default client should not be used in tests') } },
}))

import {
  validatedInsert,
  validatedInsertMany,
  validatedUpdate,
  isValidationError,
  esDuplicadoLlaveNatural,
  VALIDATION_FAILED_CODE,
  type ValidatedInsertOptions,
} from '../validatedInsert'

type MockClient = NonNullable<ValidatedInsertOptions['client']>

// Mock minimal del cliente Supabase. Solo necesitamos `.from(table).insert(p)`
// y `.from(table).update(p).eq(...)` para esta suite.
function makeMockClient(opts: {
  insertResult?: { data: unknown; error: unknown }
  updateResult?: { data: unknown; error: unknown }
  selectResult?: { data: unknown; error: unknown }
} = {}) {
  const insertResult = opts.insertResult ?? { data: [{ id: 'inserted' }], error: null }
  const updateResult = opts.updateResult ?? { data: [{ id: 'updated' }], error: null }
  const selectResult = opts.selectResult ?? insertResult

  const insertFn = vi.fn().mockImplementation(() => {
    const builder = {
      select: () => Promise.resolve(selectResult),
      then: (resolve: (v: unknown) => void) => Promise.resolve(insertResult).then(resolve),
    }
    return builder
  })

  const updateFn = vi.fn().mockImplementation(() => {
    const builder = {
      eq: vi.fn().mockReturnThis(),
      select: () => Promise.resolve(selectResult),
      then: (resolve: (v: unknown) => void) => Promise.resolve(updateResult).then(resolve),
    }
    return builder
  })

  const fromFn = vi.fn().mockImplementation((_table: string) => ({
    insert: insertFn,
    update: updateFn,
  }))

  return {
    client: { from: fromFn } as unknown as MockClient,
    fromFn,
    insertFn,
    updateFn,
  }
}

const schema = z.object({
  nombre: z.string().min(1),
  edad: z.coerce.number().int().positive(),
})

describe('validatedInsert', () => {
  it('valida con el schema y manda payload validado a Supabase', async () => {
    const mock = makeMockClient()
    const { error } = await validatedInsert(
      'usuarios',
      schema,
      { nombre: 'Juan', edad: '30' }, // coerce
      { client: mock.client },
    )
    expect(error).toBeNull()
    expect(mock.insertFn).toHaveBeenCalledWith({ nombre: 'Juan', edad: 30 })
  })

  it('retorna ValidationError sin tocar la DB cuando el payload es inválido', async () => {
    const mock = makeMockClient()
    const { data, error } = await validatedInsert(
      'usuarios',
      schema,
      { nombre: '', edad: -5 },
      { client: mock.client },
    )
    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(isValidationError(error)).toBe(true)
    if (isValidationError(error)) {
      expect(error.code).toBe(VALIDATION_FAILED_CODE)
      expect(error.fieldErrors.nombre).toBeDefined()
      expect(error.fieldErrors.edad).toBeDefined()
      // message es human-readable para callers legacy.
      expect(error.message).toBeTruthy()
    }
    // Crucial: la DB no se tocó.
    expect(mock.insertFn).not.toHaveBeenCalled()
  })

  it('propaga PostgrestError tal cual cuando Supabase devuelve error', async () => {
    const dbError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
      details: '',
      hint: '',
    }
    const mock = makeMockClient({ insertResult: { data: null, error: dbError } })
    const { data, error } = await validatedInsert(
      'usuarios',
      schema,
      { nombre: 'Juan', edad: 30 },
      { client: mock.client },
    )
    expect(data).toBeNull()
    expect(error).toBe(dbError)
    expect(isValidationError(error)).toBe(false)
  })

  it('returning: true encadena .select() y retorna las filas insertadas', async () => {
    const mock = makeMockClient({
      selectResult: { data: [{ id: 'new-row', nombre: 'Juan', edad: 30 }], error: null },
    })
    const { data, error } = await validatedInsert(
      'usuarios',
      schema,
      { nombre: 'Juan', edad: 30 },
      { client: mock.client, returning: true },
    )
    expect(error).toBeNull()
    expect(data).toEqual([{ id: 'new-row', nombre: 'Juan', edad: 30 }])
  })

  it('isValidationError discrimina entre Validation y Postgrest', () => {
    expect(isValidationError({ code: VALIDATION_FAILED_CODE })).toBe(true)
    expect(isValidationError({ code: '23505' })).toBe(false)
    expect(isValidationError(null)).toBe(false)
    expect(isValidationError(undefined)).toBe(false)
    expect(isValidationError('error')).toBe(false)
  })
})

describe('validatedInsertMany', () => {
  it('valida y manda array completo a Supabase cuando todas las filas pasan', async () => {
    const mock = makeMockClient()
    const { error } = await validatedInsertMany(
      'usuarios',
      schema,
      [
        { nombre: 'Juan', edad: 30 },
        { nombre: 'Ana', edad: '25' }, // coerce
      ],
      { client: mock.client },
    )
    expect(error).toBeNull()
    expect(mock.insertFn).toHaveBeenCalledWith([
      { nombre: 'Juan', edad: 30 },
      { nombre: 'Ana', edad: 25 },
    ])
  })

  it('si CUALQUIER fila falla validación, aborta el batch (atómico) sin tocar DB', async () => {
    const mock = makeMockClient()
    const { data, error } = await validatedInsertMany(
      'usuarios',
      schema,
      [
        { nombre: 'Juan', edad: 30 },
        { nombre: '', edad: -1 }, // fila inválida
        { nombre: 'Ana', edad: 25 },
      ],
      { client: mock.client },
    )
    expect(data).toBeNull()
    expect(isValidationError(error)).toBe(true)
    if (isValidationError(error)) {
      // Hay errores en el árbol — sea como formErrors o fieldErrors
      // (Zod los reporta como issues con path `[1, 'nombre']` etc.).
      const totalErrors =
        error.formErrors.length + Object.values(error.fieldErrors).flat().length
      expect(totalErrors).toBeGreaterThan(0)
    }
    expect(mock.insertFn).not.toHaveBeenCalled()
  })

  it('array vacío pasa validación y no manda nada a la DB', async () => {
    const mock = makeMockClient({ insertResult: { data: [], error: null } })
    const { error } = await validatedInsertMany('usuarios', schema, [], { client: mock.client })
    expect(error).toBeNull()
    expect(mock.insertFn).toHaveBeenCalledWith([])
  })

  // zod 4 conserva en `.passthrough()` las llaves no declaradas que valen
  // `undefined`, y zod 3 las omitía. En un lote, postgrest-js lista en
  // `?columns=` las llaves de todas las filas, y una columna listada que la fila
  // no trae se inserta como NULL en vez de tomar su DEFAULT. Es lo que manda
  // ImportContadoresModal con las celdas vacías (medida, material…).
  it('con .passthrough(), no lista columnas no declaradas que vienen undefined (como zod 3)', async () => {
    const mock = makeMockClient()
    const conApodo = schema.extend({ apodo: z.string().optional() }).passthrough()
    const { error } = await validatedInsertMany(
      'contadores',
      conApodo,
      [
        { nombre: 'Juan', edad: 30, medida: undefined, material: 'PVC', apodo: undefined },
        { nombre: 'Ana', edad: 25, medida: undefined },
      ],
      { client: mock.client },
    )
    expect(error).toBeNull()
    const filas = mock.insertFn.mock.calls[0][0] as Record<string, unknown>[]
    // Lo mismo que calcula postgrest-js para `?columns=`.
    const columnas = [...new Set(filas.flatMap((f) => Object.keys(f)))]
    expect(columnas).not.toContain('medida')
    expect(columnas).toContain('material')
    // Una llave DECLARADA se queda aunque venga undefined: así era en zod 3.
    expect(Object.keys(filas[0])).toEqual(['nombre', 'edad', 'apodo', 'material'])
    expect(Object.keys(filas[1])).toEqual(['nombre', 'edad'])
  })
})

describe('validatedUpdate', () => {
  it('valida + aplica filtros .eq antes de update', async () => {
    const mock = makeMockClient()
    const { error } = await validatedUpdate(
      'usuarios',
      schema,
      { nombre: 'Pedro', edad: 25 },
      { client: mock.client, match: { id: 'abc-123', activo: true } },
    )
    expect(error).toBeNull()
    expect(mock.updateFn).toHaveBeenCalledWith({ nombre: 'Pedro', edad: 25 })
    // Verifica que se aplicaron los 2 filtros via .eq()
    const builder = mock.updateFn.mock.results[0].value
    expect(builder.eq).toHaveBeenCalledWith('id', 'abc-123')
    expect(builder.eq).toHaveBeenCalledWith('activo', true)
  })

  it('falla validación → no toca DB', async () => {
    const mock = makeMockClient()
    const { error } = await validatedUpdate(
      'usuarios',
      schema,
      { nombre: '', edad: -1 },
      { client: mock.client, match: { id: 'abc' } },
    )
    expect(isValidationError(error)).toBe(true)
    expect(mock.updateFn).not.toHaveBeenCalled()
  })
})

// GHSA-mrhx-c7xc-m3w5 (high): en zod < 4.6.6, `.max()` y `.length()` de un
// arreglo se aplicaban DESPUÉS de validar cada elemento, así que un arreglo
// enorme se recorría completo antes de rechazarse (agotamiento de memoria). El
// fix existe solo en el código v4, no hay backport a 3.x. Ver SECURITY.md.
describe('zod · regresión del advisory GHSA-mrhx-c7xc-m3w5', () => {
  it('la versión instalada quedó fuera del rango afectado (< 4.6.6)', () => {
    const { major, minor, patch } = z.core.version
    const fueraDelRango = major > 4 || (major === 4 && (minor > 6 || (minor === 6 && patch >= 6)))
    expect(fueraDelRango,
      `zod@${major}.${minor}.${patch} está dentro del rango vulnerable de GHSA-mrhx-c7xc-m3w5`,
    ).toBe(true)
  })

  it('un arreglo que excede .max() se rechaza sin validar sus elementos', () => {
    let validados = 0
    const elemento = z.number().refine(() => { validados++; return true })
    const enorme = Array.from({ length: 100_000 }, () => 1)
    for (const tope of [z.array(elemento).max(10), z.array(elemento).length(10)]) {
      const r = tope.safeParse(enorme)
      expect(r.success).toBe(false)
      if (!r.success) expect(r.error.issues[0].code).toBe('too_big')
    }
    // Con zod 3.25.76 esto da 200 000: recorría el arreglo entero dos veces.
    expect(validados).toBe(0)
  })

  // zod 4 valida el UUID según RFC 9562: el nibble de versión (1-8) y el de
  // variante (8-b). '11111111-1111-1111-1111-111111111111' pasaba con zod 3 y
  // ya no pasa. Las filas reales (gen_random_uuid, auth.users) son v4 y no
  // cambian. Los fixtures de prueba deben ser UUIDs reales.
  it('z.string().uuid() exige un UUID RFC 9562 (no solo la forma 8-4-4-4-12)', () => {
    const uuid = z.string().uuid()
    expect(uuid.safeParse(crypto.randomUUID()).success).toBe(true)
    expect(uuid.safeParse('11111111-1111-4111-8111-111111111111').success).toBe(true)
    expect(uuid.safeParse('11111111-1111-1111-1111-111111111111').success).toBe(false)
    // Los IDs fijos de los roles del sistema (src/lib/systemRoleIds.ts)
    // tampoco son RFC. Hoy ningún schema valida un role_id; si alguno llega
    // a hacerlo, tendrá que usar z.guid().
    expect(uuid.safeParse('00000000-0000-0000-0000-000000000001').success).toBe(false)
    expect(z.guid().safeParse('00000000-0000-0000-0000-000000000001').success).toBe(true)
  })
})

describe('esDuplicadoLlaveNatural (E1)', () => {
  it('true solo para PostgrestError con code 23505', () => {
    expect(esDuplicadoLlaveNatural({ code: '23505', message: 'duplicate key' })).toBe(true)
    expect(esDuplicadoLlaveNatural({ code: '42703', message: 'columna no existe' })).toBe(false)
    expect(esDuplicadoLlaveNatural({ code: 'VALIDATION_FAILED', message: 'zod' })).toBe(false)
    expect(esDuplicadoLlaveNatural(null)).toBe(false)
    expect(esDuplicadoLlaveNatural(undefined)).toBe(false)
    expect(esDuplicadoLlaveNatural('23505')).toBe(false)
  })
})
