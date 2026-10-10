// VER-09 · Un doble clic o un reintento tras un corte NO crea ni paga dos veces: el servidor guarda la clave de
// idempotencia de la orden de pago y de la contraseña (índice único parcial por empresa) y la pantalla trata el
// choque con ESA clave como «ya se guardó» y devuelve el documento existente, sin repetir partidas ni avisar error.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

type Resp = { data: unknown; error: { message: string; code?: string; details?: string } | null }
const h = vi.hoisted(() => ({
  respuestas: [] as Array<{ tabla: string; op: string; resp: unknown }>,
  llamadas: [] as string[],
  insertados: [] as Array<{ tabla: string; fila: unknown }>,
}))

vi.mock('../../../lib/supabase', () => {
  const cadena = (tabla: string) => {
    let op = 'select'
    const c: Record<string, unknown> = {}
    c.insert = (fila: unknown) => { op = 'insert'; h.insertados.push({ tabla, fila }); return c }
    c.select = () => c
    c.eq = (col: string, val: unknown) => { h.llamadas.push(`${tabla}.eq(${col},${String(val)})`); return c }
    c.abortSignal = () => {
      h.llamadas.push(`${tabla}.${op}`)
      const i = h.respuestas.findIndex((r) => r.tabla === tabla && r.op === op)
      const resp = (i >= 0 ? h.respuestas.splice(i, 1)[0].resp : { data: [], error: null }) as Resp
      return Promise.resolve(resp)
    }
    return c
  }
  return {
    supabase: { from: (t: string) => cadena(t), auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) } },
    warmUpSupabase: vi.fn(),
  }
})

import { esClaveDuplicada, QueryError } from '../../queryFetch'
import { useCrearOrdenPagoMutation } from '../mutations'
import { useCrearContrasenaMutation, useCrearOrdenPagoDeContrasenaMutation } from '../../compras/mutations'

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
)

const CLAVE = '8f14e45f-ceea-467a-9575-1d0a1b2c3d4e'
const duplicado = (indice: string): Resp => ({
  data: null,
  error: { message: `duplicate key value violates unique constraint "${indice}"`, code: '23505', details: `Key (company_id, clave_idempotencia)=(c1, ${CLAVE}) already exists.` },
})

beforeEach(() => { h.respuestas = []; h.llamadas = []; h.insertados = [] })

describe('esClaveDuplicada', () => {
  it('reconoce el choque con el índice de la clave y no otro', () => {
    const causa = { code: '23505', message: 'duplicate key value violates unique constraint "uq_ordenes_pago_clave"', details: '', hint: '', name: 'PostgrestError' }
    const e = new QueryError(causa.message, { ...causa, toJSON: () => causa })
    expect(esClaveDuplicada(e, 'uq_ordenes_pago_clave')).toBe(true)
    expect(esClaveDuplicada(e, 'uq_contrasenas_pago_clave')).toBe(false)
  })

  it('un error cualquiera, o uno que no es de clave duplicada, no cuenta', () => {
    expect(esClaveDuplicada(new Error('COMPRAS_PAGO_EXCEDE_SALDO'), 'uq_ordenes_pago_clave')).toBe(false)
    expect(esClaveDuplicada(null, 'uq_ordenes_pago_clave')).toBe(false)
    expect(esClaveDuplicada('uq_ordenes_pago_clave', 'uq_ordenes_pago_clave')).toBe(false)
  })
})

describe('orden de pago: el reintento con la misma clave devuelve la orden ya creada', () => {
  const input = { factura_id: 'f1', monto: 400, metodo_pago: 'transferencia' as const, fecha_pago: null, referencia: 'SPEI-123', notas: null, clave_idempotencia: CLAVE }

  it('manda la clave de idempotencia al servidor', async () => {
    h.respuestas = [{ tabla: 'ordenes_pago', op: 'insert', resp: { data: [{ id: 'o1' }], error: null } }]
    const { result } = renderHook(() => useCrearOrdenPagoMutation('c1'), { wrapper })
    await result.current.mutateAsync({ input, proveedorId: 'p1', projectId: null })
    expect((h.insertados[0].fila as { clave_idempotencia: string }).clave_idempotencia).toBe(CLAVE)
  })

  it('si la clave ya existe, no es un error: se busca y se devuelve la misma orden', async () => {
    h.respuestas = [
      { tabla: 'ordenes_pago', op: 'insert', resp: duplicado('uq_ordenes_pago_clave') },
      { tabla: 'ordenes_pago', op: 'select', resp: { data: [{ id: 'o-previa', clave_idempotencia: CLAVE }], error: null } },
    ]
    const { result } = renderHook(() => useCrearOrdenPagoMutation('c1'), { wrapper })
    const orden = await result.current.mutateAsync({ input, proveedorId: 'p1', projectId: null })
    expect(orden).toMatchObject({ id: 'o-previa' })
    expect(h.llamadas).toContain(`ordenes_pago.eq(clave_idempotencia,${CLAVE})`)
    expect(h.insertados).toHaveLength(1)
  })

  // VER-09c · el control de saldo cuenta la orden YA guardada como «reservada» antes de que el índice único actúe: el
  // reintento de una orden por el SALDO TOTAL (el monto por omisión del formulario) llega como COMPRAS_PAGO_EXCEDE_SALDO.
  const excedeSaldo: Resp = { data: null, error: { message: 'COMPRAS_PAGO_EXCEDE_SALDO: la factura F-1 tiene un saldo de 400.00 y ya hay 400.00 reservado en otras órdenes de pago o contraseñas vivas; esta orden es por 400.00.' } }

  it('reintento por el saldo total: el rechazo por saldo con la orden ya guardada con ESA clave devuelve esa orden, sin error', async () => {
    h.respuestas = [
      { tabla: 'ordenes_pago', op: 'insert', resp: excedeSaldo },
      { tabla: 'ordenes_pago', op: 'select', resp: { data: [{ id: 'o-previa', factura_id: 'f1', monto: 400, clave_idempotencia: CLAVE }], error: null } },
    ]
    const { result } = renderHook(() => useCrearOrdenPagoMutation('c1'), { wrapper })
    const orden = await result.current.mutateAsync({ input, proveedorId: 'p1', projectId: null })
    expect(orden).toMatchObject({ id: 'o-previa' })
    expect(h.llamadas).toContain(`ordenes_pago.eq(clave_idempotencia,${CLAVE})`)
    expect(h.insertados).toHaveLength(1)
  })

  it('el monto guardado puede llegar como texto (numeric de PostgREST) y sigue siendo el mismo intento', async () => {
    h.respuestas = [
      { tabla: 'ordenes_pago', op: 'insert', resp: excedeSaldo },
      { tabla: 'ordenes_pago', op: 'select', resp: { data: [{ id: 'o-previa', factura_id: 'f1', monto: '400.00', clave_idempotencia: CLAVE }], error: null } },
    ]
    const { result } = renderHook(() => useCrearOrdenPagoMutation('c1'), { wrapper })
    await expect(result.current.mutateAsync({ input, proveedorId: 'p1', projectId: null })).resolves.toMatchObject({ id: 'o-previa' })
  })

  it.each([
    ['de otra factura', { id: 'o-otra', factura_id: 'f2', monto: 400 }],
    ['por otro monto', { id: 'o-otra', factura_id: 'f1', monto: 150 }],
  ])('si la orden guardada con esa clave es %s, NO es el mismo intento: el exceso se muestra', async (_n, previa) => {
    h.respuestas = [
      { tabla: 'ordenes_pago', op: 'insert', resp: excedeSaldo },
      { tabla: 'ordenes_pago', op: 'select', resp: { data: [{ ...previa, clave_idempotencia: CLAVE }], error: null } },
    ]
    const { result } = renderHook(() => useCrearOrdenPagoMutation('c1'), { wrapper })
    await expect(result.current.mutateAsync({ input, proveedorId: 'p1', projectId: null })).rejects.toThrow(/COMPRAS_PAGO_EXCEDE_SALDO/)
  })

  it('un exceso de verdad (ninguna orden guardada con esa clave) se muestra tal cual', async () => {
    h.respuestas = [
      { tabla: 'ordenes_pago', op: 'insert', resp: excedeSaldo },
      { tabla: 'ordenes_pago', op: 'select', resp: { data: [], error: null } },
    ]
    const { result } = renderHook(() => useCrearOrdenPagoMutation('c1'), { wrapper })
    await expect(result.current.mutateAsync({ input, proveedorId: 'p1', projectId: null })).rejects.toThrow(/COMPRAS_PAGO_EXCEDE_SALDO/)
  })

  it('sin clave (formulario antiguo) el exceso se muestra y ni siquiera se busca por clave', async () => {
    h.respuestas = [{ tabla: 'ordenes_pago', op: 'insert', resp: excedeSaldo }]
    const { result } = renderHook(() => useCrearOrdenPagoMutation('c1'), { wrapper })
    await expect(result.current.mutateAsync({ input: { ...input, clave_idempotencia: null }, proveedorId: 'p1', projectId: null })).rejects.toThrow(/COMPRAS_PAGO_EXCEDE_SALDO/)
    expect(h.llamadas).not.toContain('ordenes_pago.select')
  })

  it('un rechazo que NO es de la clave (p. ej. excede el saldo) se muestra tal cual', async () => {
    h.respuestas = [{ tabla: 'ordenes_pago', op: 'insert', resp: { data: null, error: { message: 'COMPRAS_PAGO_EXCEDE_SALDO: la factura tiene un saldo de 100' } } }]
    const { result } = renderHook(() => useCrearOrdenPagoMutation('c1'), { wrapper })
    await expect(result.current.mutateAsync({ input, proveedorId: 'p1', projectId: null })).rejects.toThrow(/COMPRAS_PAGO_EXCEDE_SALDO/)
  })

  it('sin clave (formulario antiguo) el choque de otro índice sigue siendo un error', async () => {
    h.respuestas = [{ tabla: 'ordenes_pago', op: 'insert', resp: duplicado('uq_ordenes_pago_clave') }]
    const { result } = renderHook(() => useCrearOrdenPagoMutation('c1'), { wrapper })
    await expect(result.current.mutateAsync({ input: { ...input, clave_idempotencia: null }, proveedorId: 'p1', projectId: null })).rejects.toThrow(/duplicate key/)
  })
})

describe('contraseña de pago: el reintento no repite las partidas', () => {
  const input = {
    proveedor_id: 'p1', fecha_emision: '2026-10-09', fecha_pago_programada: '2026-10-20', entregada_por: null, recibida_por: null, observaciones: null,
    clave_idempotencia: CLAVE, facturas: [{ factura_id: 'f1', monto: 100 }],
  }

  it('si la clave ya existe devuelve la contraseña previa y NO vuelve a insertar sus partidas', async () => {
    h.respuestas = [
      { tabla: 'contrasenas_pago', op: 'insert', resp: duplicado('uq_contrasenas_pago_clave') },
      { tabla: 'contrasenas_pago', op: 'select', resp: { data: [{ id: 'k-previa', clave_idempotencia: CLAVE }], error: null } },
    ]
    const { result } = renderHook(() => useCrearContrasenaMutation('c1', null), { wrapper })
    const cp = await result.current.mutateAsync(input)
    expect(cp).toMatchObject({ id: 'k-previa' })
    expect(h.insertados.filter((i) => i.tabla === 'contrasena_pago_facturas')).toHaveLength(0)
  })

  it('el primer intento sí inserta cabecera y partidas', async () => {
    h.respuestas = [{ tabla: 'contrasenas_pago', op: 'insert', resp: { data: [{ id: 'k1' }], error: null } }]
    const { result } = renderHook(() => useCrearContrasenaMutation('c1', null), { wrapper })
    await result.current.mutateAsync(input)
    expect(h.insertados.map((i) => i.tabla)).toEqual(['contrasenas_pago', 'contrasena_pago_facturas'])
  })
})

describe('orden de pago de una contraseña', () => {
  const vars = { contrasena: { id: 'k1', project_id: null, proveedor_id: 'p1', total: 100 }, metodo_pago: 'transferencia', referencia: null, notas: null, clave_idempotencia: CLAVE }

  it('el choque con la clave del mismo intento no es un error', async () => {
    h.respuestas = [{ tabla: 'ordenes_pago', op: 'insert', resp: duplicado('uq_ordenes_pago_clave') }]
    const { result } = renderHook(() => useCrearOrdenPagoDeContrasenaMutation('c1'), { wrapper })
    await expect(result.current.mutateAsync(vars)).resolves.toBeUndefined()
  })

  // El control «una orden viva por contraseña» avisa antes de que el índice de la clave actúe (VER-09).
  const yaTieneOrden: Resp = { data: null, error: { message: 'COMPRAS_CONTRASENA_YA_TIENE_ORDEN: la contraseña CP-1 ya tiene una orden de pago viva.' } }

  it('reintento: «ya tiene una orden viva» con la orden guardada con ESA clave y de ESTA contraseña no es un error', async () => {
    h.respuestas = [
      { tabla: 'ordenes_pago', op: 'insert', resp: yaTieneOrden },
      { tabla: 'ordenes_pago', op: 'select', resp: { data: [{ id: 'o-previa', contrasena_pago_id: 'k1' }], error: null } },
    ]
    const { result } = renderHook(() => useCrearOrdenPagoDeContrasenaMutation('c1'), { wrapper })
    await expect(result.current.mutateAsync(vars)).resolves.toBeUndefined()
    expect(h.llamadas).toContain(`ordenes_pago.eq(clave_idempotencia,${CLAVE})`)
  })

  it.each([
    ['la orden guardada con esa clave es de OTRA contraseña', [{ id: 'o-otra', contrasena_pago_id: 'k9' }]],
    ['no hay ninguna orden con esa clave (la viva es de otro intento)', []],
  ])('«ya tiene una orden viva» se muestra cuando %s', async (_n, previas) => {
    h.respuestas = [
      { tabla: 'ordenes_pago', op: 'insert', resp: yaTieneOrden },
      { tabla: 'ordenes_pago', op: 'select', resp: { data: previas, error: null } },
    ]
    const { result } = renderHook(() => useCrearOrdenPagoDeContrasenaMutation('c1'), { wrapper })
    await expect(result.current.mutateAsync(vars)).rejects.toThrow(/COMPRAS_CONTRASENA_YA_TIENE_ORDEN/)
  })

  it('sin clave, «ya tiene una orden viva» se muestra y no se busca por clave', async () => {
    h.respuestas = [{ tabla: 'ordenes_pago', op: 'insert', resp: yaTieneOrden }]
    const { result } = renderHook(() => useCrearOrdenPagoDeContrasenaMutation('c1'), { wrapper })
    await expect(result.current.mutateAsync({ ...vars, clave_idempotencia: null })).rejects.toThrow(/COMPRAS_CONTRASENA_YA_TIENE_ORDEN/)
    expect(h.llamadas).not.toContain('ordenes_pago.select')
  })
})
