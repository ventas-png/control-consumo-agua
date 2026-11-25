// Capa de autorización del recordatorio manual de rutas. El único doble es el
// cliente Supabase, a nivel de `.rpc()`: responde lo que respondería la base
// (deny explícito incluido, que llega como `false`) y permite ejercitar que la
// consulta FALLE, que es donde un fallo abierto se cuela.
import { describe, it, expect } from 'vitest'
import { autorizarRecordatorio, PERMISO_RECORDAR, type ClienteRpc, type RespuestaRpc } from '../autorizacion.ts'

const EMPRESA = 'emp-1'
const RUTA = { company_id: EMPRESA, project_id: 'proy-1' }

type Respuestas = Record<string, RespuestaRpc | (() => RespuestaRpc)>

function cliente(opciones: {
  superAdmin?: boolean
  empresa?: string | null
  proyectoOk?: boolean
  permisos?: Record<string, boolean>
  crudo?: Respuestas
}): ClienteRpc & { llamadas: Array<{ fn: string; args?: Record<string, unknown> }> } {
  const llamadas: Array<{ fn: string; args?: Record<string, unknown> }> = []
  const base: Respuestas = {
    is_super_admin: { data: opciones.superAdmin ?? false, error: null },
    get_my_company_id: { data: opciones.empresa === undefined ? EMPRESA : opciones.empresa, error: null },
    can_access_project: { data: opciones.proyectoOk ?? true, error: null },
    ...opciones.crudo,
  }
  return {
    llamadas,
    rpc(fn: string, args?: Record<string, unknown>) {
      llamadas.push({ fn, args })
      if (fn === 'user_has_permission' && !(opciones.crudo && fn in opciones.crudo)) {
        const clave = String(args?.perm_key)
        return Promise.resolve({ data: opciones.permisos?.[clave] ?? false, error: null })
      }
      const r = base[fn]
      if (!r) return Promise.resolve({ data: null, error: { message: `rpc ${fn} no doblada` } })
      return Promise.resolve(typeof r === 'function' ? r() : r)
    },
  }
}

describe('route-reminders/autorizarRecordatorio', () => {
  it('exige agua.rutas.edit, la misma clave que muestra el botón «Recordar»', () => {
    expect(PERMISO_RECORDAR).toBe('agua.rutas.edit')
  })

  it('un rol RBAC con agua.rutas.edit (p. ej. «Admin Agua», rol de plataforma operator) puede', async () => {
    const c = cliente({ permisos: { 'agua.rutas.edit': true } })
    expect(await autorizarRecordatorio(c, RUTA)).toEqual({ ok: true })
    expect(c.llamadas).toContainEqual({ fn: 'can_access_project', args: { p_project_id: 'proy-1' } })
    expect(c.llamadas).toContainEqual({ fn: 'user_has_permission', args: { perm_key: 'agua.rutas.edit' } })
  })

  it('sin agua.rutas.edit (o con un deny) no puede', async () => {
    const v = await autorizarRecordatorio(cliente({ permisos: { 'agua.rutas.view': true } }), RUTA)
    expect(v).toMatchObject({ ok: false, motivo: 'sin_permiso' })
  })

  it('una ruta de otra empresa o sin empresa se niega, tenga el permiso que tenga', async () => {
    const c = cliente({ permisos: { 'agua.rutas.edit': true } })
    expect(await autorizarRecordatorio(c, { company_id: 'otra', project_id: 'p' })).toMatchObject({ ok: false, motivo: 'otra_empresa' })
    expect(await autorizarRecordatorio(c, { company_id: null, project_id: 'p' })).toMatchObject({ ok: false, motivo: 'otra_empresa' })
  })

  it('un proyecto no asignado se niega', async () => {
    const v = await autorizarRecordatorio(cliente({ proyectoOk: false, permisos: { 'agua.rutas.edit': true } }), RUTA)
    expect(v).toMatchObject({ ok: false, motivo: 'proyecto_no_asignado' })
  })

  it('el superadmin pasa en cualquier empresa sin consultar nada más', async () => {
    const c = cliente({ superAdmin: true, empresa: 'otra' })
    expect(await autorizarRecordatorio(c, RUTA)).toEqual({ ok: true })
    expect(c.llamadas.map(l => l.fn)).toEqual(['is_super_admin'])
  })

  it('sin cliente con el JWT del usuario se niega', async () => {
    expect(await autorizarRecordatorio(null, RUTA)).toMatchObject({ ok: false, motivo: 'sin_cliente' })
  })

  it('FAIL-CLOSED: un error de consulta es error_autorizacion, nunca un permitido', async () => {
    const casos: Respuestas[] = [
      { is_super_admin: { data: null, error: { message: 'boom' } } },
      { is_super_admin: { data: null, error: null } },
      { get_my_company_id: { data: null, error: null } },
      { can_access_project: { data: 'sí', error: null } },
      { user_has_permission: { data: null, error: { message: 'timeout' } } },
      { is_super_admin: () => { throw new Error('red caída') } },
    ]
    for (const crudo of casos) {
      const v = await autorizarRecordatorio(cliente({ permisos: { 'agua.rutas.edit': true }, crudo }), RUTA)
      expect(v).toMatchObject({ ok: false, motivo: 'error_autorizacion' })
    }
  })
})
