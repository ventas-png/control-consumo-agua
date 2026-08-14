// Un fallo transitorio de get_user_permissions NO debe vaciar los permisos.
//
// Regresión: buildPermissionsSet devuelve `undefined` cuando la RPC falla (un
// usuario sin permisos devuelve un Set VACÍO, no undefined). Antes,
// refreshSessionFromSupabase colapsaba ese undefined a [] y lo comparaba con
// los 1163 permisos vigentes: lo leía como "le quitaron todo" y PERSISTÍA en
// sessionStorage una sesión sin permisos. El sidebar se vaciaba —Contabilidad
// incluida— hasta el siguiente refresh con suerte, y el refresh se dispara en
// cada visibilitychange y ante cualquier cambio en role_permissions.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  rpcError: null as { message: string } | null,
  rpcRows: [] as string[],
  rangeCalls: [] as Array<[number, number]>,
  stored: [] as unknown[],
}))

vi.mock('../../../lib/authSession', () => ({
  storeSession: (s: unknown) => { h.stored.push(s) },
}))

vi.mock('../../../lib/supabase', () => {
  const tabla = (rows: unknown) => {
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = () => c
    c.single = () => Promise.resolve({ data: rows, error: null })
    c.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null })
    return c
  }
  return {
    supabase: {
      from: (tabla_: string) => {
        if (tabla_ === 'app_users') {
          return tabla({ full_name: 'Alexander', role: 'operator', company_id: 'co1', activo: true })
        }
        if (tabla_ === 'companies') {
          return tabla({ servicio_agua: true, servicio_condominios: true, activa: true })
        }
        return tabla([])
      },
      rpc: () => {
        const c: Record<string, unknown> = {}
        c.range = (from: number, to: number) => { h.rangeCalls.push([from, to]); return c }
        c.then = (resolve: (v: unknown) => void) =>
          resolve(h.rpcError ? { data: null, error: h.rpcError } : { data: h.rpcRows, error: null })
        return c
      },
    },
  }
})

import { refreshSessionFromSupabase } from '../session'
import type { UserSession } from '../../../types'

function sesionVigente(): UserSession {
  return {
    user_id: 'u1', email: 'a@b.c', name: 'Alexander', role: 'operator',
    company_id: 'co1', login_time: '', expires_at: '2099-01-01T00:00:00Z',
    servicio_agua: true, servicio_condominios: true,
    permissions: new Set(['platform.contabilidad.view', 'platform.clientes.view']),
  } as unknown as UserSession
}

beforeEach(() => {
  h.rpcError = null
  h.rpcRows = []
  h.rangeCalls = []
  h.stored = []
})

describe('refreshSessionFromSupabase — permisos', () => {
  it('la RPC falla → conserva los permisos vigentes y no persiste una sesión vacía', async () => {
    h.rpcError = { message: 'network error' }
    const actual = sesionVigente()

    const res = await refreshSessionFromSupabase(actual, undefined)

    // Nada cambió realmente, así que no hay motivo para reescribir la sesión.
    expect(h.stored).toHaveLength(0)
    // Y si se devolviera algo, jamás con los permisos vacíos.
    if (res) expect([...(res.permissions ?? [])]).toContain('platform.contabilidad.view')
  })

  it('la RPC responde vacío de verdad → sí refleja la pérdida de permisos', async () => {
    h.rpcRows = []
    const actual = sesionVigente()

    const res = await refreshSessionFromSupabase(actual, undefined)

    expect(res).not.toBeNull()
    expect([...(res!.permissions ?? [])]).toEqual([])
    expect(h.stored).toHaveLength(1)
  })

  it('la RPC se lee paginada (SETOF text también topa con el límite de filas)', async () => {
    h.rpcRows = ['platform.contabilidad.view']
    await refreshSessionFromSupabase(sesionVigente(), undefined)
    expect(h.rangeCalls.length).toBeGreaterThan(0)
    expect(h.rangeCalls[0][0]).toBe(0)
  })
})
