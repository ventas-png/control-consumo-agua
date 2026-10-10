// Fase 6 — Contrato de runQueryAll: listados completos por chunks con el mismo
// manejo de errores de runQuery (lanza QueryError → react-query isError).
import { describe, it, expect, vi } from 'vitest'
import type { PostgrestError } from '@supabase/supabase-js'
import { runQueryAll, runAfectando, QueryError, SinFilasAfectadasError } from '../queryFetch'

function page<T>(rows: T[]): { data: T[]; error: null } {
  return { data: rows, error: null }
}

describe('runQueryAll', () => {
  it('una página parcial → devuelve las filas', async () => {
    const rows = await runQueryAll<{ id: number }>((from, _to) =>
      Promise.resolve(page(from === 0 ? [{ id: 1 }, { id: 2 }] : [])),
    )
    expect(rows).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('varias páginas: concatena hasta la ventana incompleta', async () => {
    // chunk default = 1000; simulamos 1000 llenas + 500
    const rows = await runQueryAll<{ id: number }>((from, to) => {
      const n = from === 0 ? to - from + 1 : 500
      return Promise.resolve(page(Array.from({ length: n }, (_, i) => ({ id: from + i }))))
    })
    expect(rows).toHaveLength(1500)
    expect(rows[0].id).toBe(0)
    expect(rows[1499].id).toBe(1499)
  })

  it('pasa un AbortSignal fresco a cada chunk', async () => {
    const signals: AbortSignal[] = []
    await runQueryAll<{ id: number }>((from, _to, signal) => {
      signals.push(signal)
      return Promise.resolve(page(from === 0 ? Array.from({ length: 1000 }, (_, i) => ({ id: i })) : []))
    })
    expect(signals).toHaveLength(2)
    expect(signals[0]).toBeInstanceOf(AbortSignal)
    expect(signals[0]).not.toBe(signals[1]) // timeout independiente por ventana
  })

  it('error → lanza QueryError (contrato de runQuery)', async () => {
    const err = { message: 'rls denied' } as PostgrestError
    await expect(
      runQueryAll(() => Promise.resolve({ data: null, error: err })),
    ).rejects.toThrow(QueryError)
    await expect(
      runQueryAll(() => Promise.resolve({ data: null, error: err })),
    ).rejects.toThrow('rls denied')
  })

  it('techo de seguridad: avisa por consola y devuelve lo acumulado', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // Fuente "infinita": toda ventana vuelve llena → corta en el techo (100k).
      const rows = await runQueryAll<{ id: number }>((from, to) =>
        Promise.resolve(page(Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i })))),
      )
      expect(rows.length).toBeGreaterThanOrEqual(100_000)
      expect(warn).toHaveBeenCalledOnce()
      expect(String(warn.mock.calls[0][0])).toContain('techo de seguridad')
    } finally {
      warn.mockRestore()
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// reportDegradedQuery — auditoría 2026-07-28 · PR-28
//
// El informe proponía convertir a `runQuery` los 59 sitios que descartaban el
// `error` de Supabase. No es seguro: ninguno se consume como `queryFn` de React
// Query, así que hacerlos LANZAR produciría rechazos no capturados en vez de UI
// de error. Este helper separa **degradar** (que se conserva) de **callar** (que
// era el bug): el valor por defecto sigue saliendo y el error va a Sentry.
//
// Lo que estos tests fijan es exactamente esa doble propiedad: que REPORTA y que
// NO LANZA. Si alguien "mejora" el helper haciéndolo lanzar, 59 call sites
// empiezan a producir unhandled rejections y estos tests lo dicen antes.
// ════════════════════════════════════════════════════════════════════════════
vi.mock('../../lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

describe('reportDegradedQuery', () => {
  it('sin error no reporta nada y devuelve false', async () => {
    const { reportDegradedQuery } = await import('../queryFetch')
    const { logger } = await import('../../lib/logger')
    vi.mocked(logger.error).mockClear()

    expect(reportDegradedQuery('mod.fn', null)).toBe(false)
    expect(reportDegradedQuery('mod.fn', undefined)).toBe(false)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('con error reporta a logger.error con el scope y devuelve true', async () => {
    const { reportDegradedQuery } = await import('../queryFetch')
    const { logger } = await import('../../lib/logger')
    vi.mocked(logger.error).mockClear()

    const err = {
      message: 'permission denied for table cuotas_condominio',
      code: '42501', details: 'd', hint: 'h',
    }
    expect(reportDegradedQuery('condominios.fetchCuotas', err)).toBe(true)

    expect(logger.error).toHaveBeenCalledTimes(1)
    const [msg, ctx, passed] = vi.mocked(logger.error).mock.calls[0]
    // El scope debe ir en el mensaje Y en el contexto: en Sentry el primero es
    // lo que se lee y el segundo lo que se filtra.
    expect(msg).toContain('condominios.fetchCuotas')
    expect(ctx).toMatchObject({ scope: 'condominios.fetchCuotas', code: '42501' })
    // El error original se pasa como tercer argumento — es lo que hace que
    // logger.error lo mande a Sentry como excepción y no como mero breadcrumb.
    expect(passed).toBe(err)
  })

  it('NO lanza: los 59 call sites conservan su contrato de degradación', async () => {
    const { reportDegradedQuery } = await import('../queryFetch')
    // Esta es LA invariante del PR. Un throw aquí = 59 promesas flotantes
    // rechazadas sin `.catch()` en producción.
    expect(() => reportDegradedQuery('x.y', { message: 'boom' })).not.toThrow()
  })

  it('acepta también el error de supabase.auth (sin code/details/hint)', async () => {
    // 2 de los 59 sitios son de `supabase.auth.*`, cuyo error es un AuthError y
    // no un PostgrestError. Se tipó estructuralmente para no dejarlos fuera.
    const { reportDegradedQuery } = await import('../queryFetch')
    expect(reportDegradedQuery('auth.getSession', { message: 'invalid JWT' })).toBe(true)
  })
})

// Un UPDATE/DELETE que la política de filas no deja tocar NO falla en PostgREST: devuelve éxito con cero filas.
// Mostrar «Listo» en ese caso es un éxito falso sobre un documento o un movimiento de dinero que no se movió.
describe('runAfectando', () => {
  it('con filas devueltas: éxito y cuántas cambió', async () => {
    const n = await runAfectando(() => Promise.resolve({ data: [{ id: 'a' }], error: null }))
    expect(n).toBe(1)
  })

  it('con cero filas (RLS que no deja tocar): lanza SinFilasAfectadasError en vez de devolver éxito', async () => {
    await expect(runAfectando(() => Promise.resolve({ data: [], error: null }))).rejects.toBeInstanceOf(SinFilasAfectadasError)
  })

  it('con data null también es cero filas', async () => {
    await expect(runAfectando(() => Promise.resolve({ data: null, error: null }))).rejects.toBeInstanceOf(SinFilasAfectadasError)
  })

  it('un error del servidor sigue siendo un QueryError con su mensaje (no se enmascara como «sin filas»)', async () => {
    const err = { message: 'COMPRAS_PERMISO_ACCION: para aprobar tu perfil necesita «Autorizar»', code: 'P0001', details: '', hint: '', name: 'PostgrestError' } as PostgrestError
    const p = runAfectando(() => Promise.resolve({ data: null, error: err }))
    await expect(p).rejects.toBeInstanceOf(QueryError)
    await expect(p).rejects.toThrow(/COMPRAS_PERMISO_ACCION/)
  })

  it('el mensaje de «sin filas» dice qué pudo pasar y qué hacer', () => {
    expect(new SinFilasAfectadasError().message).toMatch(/no aplicó el cambio.*permiso.*Actualiza la pantalla/s)
  })
})
