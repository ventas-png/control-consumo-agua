// Retiro de un respaldo de recepción: el registro primero, el archivo después, y NUNCA un éxito falso.
// El servidor impide retirar con la recepción registrada (assert_correcciones_c.sql, B9/B10 y P).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  borrado: { data: [{ id: 'x1' }] as { id: string }[] | null, error: null as { message: string } | null },
  remove: vi.fn(),
  list: vi.fn(),
  llamadas: [] as string[],
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      delete: () => ({ eq: () => ({ select: async () => { m.llamadas.push('registro'); return m.borrado } }) }),
    }),
    storage: { from: () => ({
      remove: async (rutas: string[]) => { m.llamadas.push('remove'); return m.remove(rutas) },
      list: async (c: string, o: unknown) => { m.llamadas.push('list'); return m.list(c, o) },
    }) },
  },
  warmUpSupabase: vi.fn(),
}))

import { RetiroRespaldoError, retirarRespaldoRecepcion } from '../respaldos'

const R = { id: 'x1', recepcion_id: 'r1', nombre: 'Remisión 123.pdf', ruta: 'c/p/r1/remision-ab.pdf' }

beforeEach(() => {
  m.borrado = { data: [{ id: 'x1' }], error: null }
  m.remove = vi.fn().mockResolvedValue({ data: [{ name: 'remision-ab.pdf' }], error: null })
  m.list = vi.fn().mockResolvedValue({ data: [], error: null })
  m.llamadas = []
})

describe('retirarRespaldoRecepcion', () => {
  it('éxito: retira el registro, luego el archivo, y comprueba que ya no está', async () => {
    await expect(retirarRespaldoRecepcion(R)).resolves.toBeUndefined()
    expect(m.llamadas).toEqual(['registro', 'remove', 'list'])
    expect(m.remove).toHaveBeenCalledWith(['c/p/r1/remision-ab.pdf'])
    expect(m.list).toHaveBeenCalledWith('c/p/r1', { search: 'remision-ab.pdf' })
  })

  it('el registro va PRIMERO: si el servidor lo rechaza no se toca el archivo', async () => {
    m.borrado = { data: null, error: { message: 'COMPRAS_RESPALDO_INMUTABLE: la recepción ya salió de borrador' } }
    await expect(retirarRespaldoRecepcion(R)).rejects.toMatchObject({ fase: 'registro', message: expect.stringMatching(/INMUTABLE/) })
    expect(m.remove).not.toHaveBeenCalled()
  })

  it('una recepción registrada filtra el DELETE (0 filas): error de registro, sin tocar el archivo', async () => {
    m.borrado = { data: [], error: null }
    const e = await retirarRespaldoRecepcion(R).catch((x) => x)
    expect(e).toBeInstanceOf(RetiroRespaldoError)
    expect(e.fase).toBe('registro')
    expect(e.message).toMatch(/salió de borrador/)
    expect(m.remove).not.toHaveBeenCalled()
  })

  it('si Storage falla NO es éxito: error de almacenamiento con la ruta que quedó sin referencia', async () => {
    m.remove = vi.fn().mockResolvedValue({ data: null, error: { message: 'Storage no disponible' } })
    const e = await retirarRespaldoRecepcion(R).catch((x) => x)
    expect(e).toBeInstanceOf(RetiroRespaldoError)
    expect(e.fase).toBe('almacenamiento')
    expect(e.rutaHuerfana).toBe(R.ruta)
    expect(e.message).toMatch(/Se retiró el registro/)
    expect(e.message).toMatch(/NO se eliminó/)
    expect(e.message).toMatch(/Storage no disponible/)
  })

  it('Storage responde «éxito» pero NO borró (policy): se detecta con la lectura posterior', async () => {
    m.remove = vi.fn().mockResolvedValue({ data: [], error: null })
    m.list = vi.fn().mockResolvedValue({ data: [{ name: 'remision-ab.pdf' }], error: null })
    const e = await retirarRespaldoRecepcion(R).catch((x) => x)
    expect(e).toBeInstanceOf(RetiroRespaldoError)
    expect(e.fase).toBe('almacenamiento')
    expect(e.message).toMatch(/no lo borró/)
  })

  it('si no se puede comprobar la eliminación tampoco se informa éxito', async () => {
    m.list = vi.fn().mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const e = await retirarRespaldoRecepcion(R).catch((x) => x)
    expect(e).toBeInstanceOf(RetiroRespaldoError)
    expect(e.fase).toBe('almacenamiento')
    expect(e.message).toMatch(/no se pudo comprobar/)
  })
})
