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
